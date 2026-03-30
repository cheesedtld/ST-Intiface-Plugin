/* 
  ST-Intiface-Plugin - 原生 SillyTavern 扩展
  通过 Intiface Central 控制蓝牙玩具，支持多驱动和复杂指令并发。
*/

// 为了避免不同安装路径（原生扩展 vs 第三方安装器）带来的相对路径层级报错（404 Not Found），
// 此处我们取消写死的 ES6 import，直接在运行时动态引用 SillyTavern 暴露的全局对象。

const PLUGIN_NAME = 'IntifaceControl';
const PLUGIN_VERSION = '1.0.0';
const SETTINGS_KEY = 'intiface_plugin_settings';

const DEFAULT_SETTINGS = {
    serverAddress: 'ws://localhost:12345',
    autoConnect: false,
    enabled: true,
    tagFormat: 'xml',
    defaultDuration: 20000,
    defaultIntensity: 0.5,
    maxIntensity: 1.0,
    commandGap: 100
};

// ==================== 状态 ====================
let settings = { ...DEFAULT_SETTINGS };
let wsConnection = null;
let isConnected = false;
let devices = new Map();
let commandQueue = [];
let isProcessingQueue = false;
let messageIdCounter = 1;
let pendingResponses = new Map();

// ==================== UI 层 ====================
function initUI() {
    // 构建标准的酒馆扩展抽屉面板 (Inline Drawer)
    const panelHtml = `
    <div class="inline-drawer" id="intiface-plugin-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>玩具控制器 <span style="font-size:11px;opacity:0.5;font-weight:normal">v${PLUGIN_VERSION}</span></b>
            <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content" style="display: none;">
            <div class="if-body">
                <!-- 连接管理 -->
                <div class="if-section">
                    <div class="if-section-title">连接管理</div>
                <div class="if-connection-row">
                    <div class="if-status-dot" id="if-status-dot"></div>
                    <span class="if-status-text" id="if-status-text">未连接</span>
                </div>
                <div class="if-input-group">
                    <input type="text" class="if-input" id="if-server-address" value="${settings.serverAddress}" placeholder="ws://localhost:12345" />
                </div>
                <div class="if-btn-group">
                    <button class="if-btn if-btn-primary" id="if-connect-btn">连接</button>
                    <button class="if-btn if-btn-danger" id="if-disconnect-btn" style="display:none;">断开</button>
                </div>
            </div>

            <!-- 设备列表 -->
            <div class="if-section">
                <div class="if-section-title">已连接设备</div>
                <div id="if-device-list">
                    <div class="device-empty">暂无设备连接</div>
                </div>
            </div>

            <!-- 参数设置 -->
            <div class="if-section">
                <div class="if-section-title if-collapsible">参数设置</div>
                <div class="if-collapse-content collapsed">
                    <div class="if-setting-row">
                        <div class="if-setting-label">启用解析自动控制</div>
                        <input type="checkbox" id="if-set-enabled" ${settings.enabled ? 'checked' : ''} />
                    </div>
                    <div class="if-setting-row">
                        <div class="if-setting-label">启动时自动连接</div>
                        <input type="checkbox" id="if-set-autoconnect" ${settings.autoConnect ? 'checked' : ''} />
                    </div>
                </div>
            </div>

            <!-- 模式测试 -->
            <div class="if-section">
                <div class="if-section-title if-collapsible">模式测试</div>
                <div class="if-collapse-content collapsed">
                    <div class="pattern-grid">
                        <button class="pattern-btn" data-pattern="pulse">脉冲</button>
                        <button class="pattern-btn" data-pattern="wave">波浪</button>
                        <button class="pattern-btn" data-pattern="escalate">渐强</button>
                        <button class="pattern-btn" data-pattern="tease">挑逗</button>
                        <button class="pattern-btn" data-pattern="heartbeat">心跳</button>
                    </div>
                </div>
            </div>

            <!-- 移动端内置控制台 -->
            <div class="if-section">
                <div class="if-section-title if-collapsible">操作日志 (调试)</div>
                <div class="if-collapse-content collapsed">
                    <div id="if-debug-console" style="background: rgba(0,0,0,0.3); color: #00e676; padding: 8px; height: 120px; overflow-y: auto; font-size: 11px; font-family: monospace; border-radius: 4px; word-wrap: break-word; line-height: 1.4;">
                        <div style="color:#aaa;">[系统] 玩具控制器 v${PLUGIN_VERSION} 等待初始化...</div>
                    </div>
                </div>
            </div>

            <!-- 诊断工具 -->
            <div class="if-section">
                <div class="if-section-title if-collapsible">诊断工具</div>
                <div class="if-collapse-content collapsed">
                    <button class="if-btn if-btn-secondary" id="if-diag-parse" style="width:100%;margin-bottom:6px;">手动解析最后一条AI消息</button>
                    <button class="if-btn if-btn-secondary" id="if-diag-test" style="width:100%;">发送测试震动 (0.5, 2秒)</button>
                </div>
            </div>

            <!-- 紧急停止 -->
            <div class="if-section if-emergency" style="margin-top: 10px;">
                <button class="if-btn if-btn-danger" id="if-stop-all" style="width: 100%; font-size: 14px;">紧急停止所有设备</button>
            </div>
            </div>
        </div>
    </div>
    `;

    if (!$('#intiface-plugin-drawer').length) {
        // 插入到扩展示单列表下
        $('#extensions_settings').append(panelHtml);

        // 绑定内部设置的折叠块（不干涉主抽屉，由外部 ST 引擎统一管辖抽屉开合）
        $('.if-collapsible').off('click').on('click', function () {
            $(this).next('.if-collapse-content').toggleClass('collapsed');
        });

        $('#if-connect-btn').on('click', async () => {
            settings.serverAddress = $('#if-server-address').val().trim();
            saveSettings();
            await connectToServer();
        });

        $('#if-disconnect-btn').on('click', () => disconnectFromServer());

        $('#if-stop-all').on('click', () => stopAllDevices());

        // 诊断按钮
        $('#if-diag-parse').on('click', () => window._ifDiagParse && window._ifDiagParse());
        $('#if-diag-test').on('click', () => {
            if (!isConnected || devices.size === 0) return toastr.warning('请先连接设备');
            log('[诊断] 发送测试震动 0.5 / 2000ms');
            vibrateAllDevices(0.5, 2000);
        });

        // 设置保存绑定
        $('#if-set-enabled').on('change', function () { settings.enabled = $(this).prop('checked'); saveSettings(); });
        $('#if-set-autoconnect').on('change', function () { settings.autoConnect = $(this).prop('checked'); saveSettings(); });

        $('.pattern-btn').on('click', function () {
            const pat = $(this).data('pattern');
            if (!isConnected || devices.size === 0) return toastr.warning('请先连接蓝牙玩具设备');
            currentLoopId++; // 截断上一个任务
            executePattern(pat, settings.defaultIntensity, settings.defaultDuration, currentLoopId).catch(console.error);
        });

        // 挂载全局控制函数供 HTML 内联 onClick 使用
        window._ifTrigger = {
            vibrate: (idx, featIdx) => vibrateDevice(idx, getSliderVal('vibrate', idx, featIdx), 0, featIdx),
            suck: (idx, featIdx) => suckDevice(idx, getSliderVal('suck', idx, featIdx), 0, featIdx),
            thrust: (idx) => thrustDevice(idx, getSliderVal('thrust', idx, null), 1.0, 5000),
            stop: (idx) => stopDevice(idx)
        };
    }
}

function getSliderVal(type, devIdx, featIdx) {
    const id = featIdx !== null ? `#${type}-slider-${devIdx}-${featIdx}` : `#${type}-slider-${devIdx}`;
    return parseInt($(id).val() || 50) / 100;
}

function updateConnectionUI(connected) {
    const statusDot = $('#if-status-dot');
    const statusText = $('#if-status-text');

    if (connected) {
        statusDot.css({ background: 'linear-gradient(135deg, #00e676, #69f0ae)', boxShadow: '0 0 8px rgba(0,230,118,0.6)' });
        statusText.text('已连接');
        $('#if-connect-btn').hide();
        $('#if-disconnect-btn').show();
    } else {
        statusDot.css({ background: 'linear-gradient(135deg, #ff5252, #ff8a80)', boxShadow: '0 0 8px rgba(255,82,82,0.6)' });
        statusText.text('未连接');
        $('#if-connect-btn').show();
        $('#if-disconnect-btn').hide();
    }
}

function log(msg, type = 'info') {
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const logStr = `[${time}] ${msg}`;

    // 原生控制台兜底
    if (type === 'error') console.error(`[Intiface] ${logStr}`);
    else if (type === 'warn') console.warn(`[Intiface] ${logStr}`);
    else console.log(`[Intiface] ${logStr}`);

    // UI 显示面板输出
    const logEl = $('#if-debug-console');
    if (logEl.length) {
        let color = '#00e676'; // 默认绿
        if (type === 'error') color = '#ff5252'; // 报错红
        if (type === 'warn') color = '#ffd600';  // 警告黄
        logEl.append(`<div style="color:${color}; border-bottom:1px solid rgba(255,255,255,0.05); padding: 2px 0;">${logStr}</div>`);
        logEl.scrollTop(logEl[0].scrollHeight);
        // 限制条数防卡死
        while (logEl.children().length > 40) logEl.children().first().remove();
    }
}

function updateDevicePanel() {
    const list = $('#if-device-list');
    if (devices.size === 0) {
        list.html('<div class="device-empty">暂无设备连接。</div>');
        return;
    }

    let h = '';
    for (const [index, device] of devices) {
        const canVibrate = deviceSupportsVibrate(device);
        const canSuction = deviceSupportsSuction(device);
        const canLinear = deviceSupportsLinear(device);
        const labels = getCapabilityLabels(device);

        let vCtrl = '';
        if (canVibrate) {
            const vc = getFeatureCount(device, 'Vibrate');
            if (vc > 1) {
                for (let m = 0; m < vc; m++) {
                    vCtrl += `
                    <div class="control-row">
                        <label>震动 ${m + 1}</label>
                        <input type="range" class="slider" id="vibrate-slider-${index}-${m}" value="50" oninput="$(this).next().text(this.value+'%')" />
                        <span class="slider-value">50%</span>
                        <button class="btn-sm btn-vibrate" onclick="window._ifTrigger.vibrate(${index}, ${m})">测试</button>
                    </div>`;
                }
            } else {
                vCtrl = `
                <div class="control-row">
                    <label>震动强度</label>
                    <input type="range" class="slider" id="vibrate-slider-${index}" value="50" oninput="$(this).next().text(this.value+'%')" />
                    <span class="slider-value">50%</span>
                </div>`;
            }
        }

        let sCtrl = '';
        if (canSuction) {
            sCtrl = `
            <div class="control-row">
                <label>吮吸强度</label>
                <input type="range" class="slider" id="suck-slider-${index}" value="50" oninput="$(this).next().text(this.value+'%')" />
                <span class="slider-value">50%</span>
            </div>
            <div class="control-buttons">
                <button class="btn-sm" style="background:#e91e63;color:#fff" onclick="window._ifTrigger.suck(${index}, null)">吮吸</button>
            </div>`;
        }

        let lCtrl = '';
        if (canLinear) {
            lCtrl = `
            <div class="control-row">
                <label>伸缩速度</label>
                <input type="range" class="slider" id="thrust-slider-${index}" value="50" oninput="$(this).next().text(this.value+'%')" />
                <span class="slider-value">50%</span>
            </div>
            <div class="control-buttons">
                <button class="btn-sm" style="background:#7c4dff;color:#fff" onclick="window._ifTrigger.thrust(${index})">伸缩测试</button>
            </div>`;
        }

        h += `
        <div class="device-card">
            <div class="device-header">
                <span class="device-name">${device.DeviceName}</span>
                <span class="device-index">#${index}</span>
            </div>
            <div class="device-caps">${labels.join(' · ') || '未知'}</div>
            <div class="device-controls">
                ${vCtrl} ${sCtrl} ${lCtrl}
                <div class="control-buttons" style="margin-top:8px">
                    ${canVibrate ? `<button class="btn-sm btn-vibrate" onclick="window._ifTrigger.vibrate(${index}, null)">开始</button>` : ''}
                    <button class="btn-sm btn-stop" onclick="window._ifTrigger.stop(${index})">停止</button>
                </div>
            </div>
        </div>`;
    }
    list.html(h);
}

// ==================== 核心控制逻辑 ====================
// WebSocket 协议基于 Buttplug v3 无依赖裸写

function generateMsgId() { return messageIdCounter++; }

function sendButtplugMessage(msg) {
    if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) return Promise.reject('未连接');
    return new Promise((resolve, reject) => {
        const id = msg[Object.keys(msg)[0]].Id;
        pendingResponses.set(id, {
            resolve, reject, timeout: setTimeout(() => {
                pendingResponses.delete(id); reject('请求超时');
            }, 10000)
        });
        wsConnection.send(JSON.stringify([msg]));
    });
}

function handleServerInfo(info) {
    log(`连接成功: ${info.ServerName} (v${info.MessageVersion})`);
    toastr.success(`已连接到 Intiface Central!`);
    // 连接成功后请求设备列表
    sendButtplugMessage({ RequestDeviceList: { Id: generateMsgId() } }).catch(() => { });
    // 自动触发一次扫描，替代手动按钮
    sendButtplugMessage({ StartScanning: { Id: generateMsgId() } }).catch(() => { });
}

function handleButtplugMessage(data) {
    try {
        const messages = JSON.parse(data);
        for (const msg of messages) {
            const type = Object.keys(msg)[0];
            const content = msg[type];
            switch (type) {
                case 'ServerInfo':
                    handleServerInfo(content);
                    break;
                case 'DeviceList':
                    devices.clear();
                    if (content.Devices) {
                        for (const dev of content.Devices) devices.set(dev.DeviceIndex, dev);
                    }
                    updateDevicePanel();
                    break;
                case 'DeviceAdded':
                    devices.set(content.DeviceIndex, content);
                    toastr.info(`设备已连接: ${content.DeviceName}`);
                    updateDevicePanel();
                    break;
                case 'DeviceRemoved':
                    devices.delete(content.DeviceIndex);
                    updateDevicePanel();
                    break;
                case 'Ok':
                case 'Error':
                    const pending = pendingResponses.get(content.Id);
                    if (pending) {
                        clearTimeout(pending.timeout);
                        pendingResponses.delete(content.Id);
                        if (type === 'Ok') pending.resolve(content);
                        else pending.reject(content.ErrorMessage || '未知错误');
                    }
                    break;
            }
        }
    } catch (e) { console.error('Buttplug parse error', e); }
}

async function connectToServer() {
    if (isConnected) return;
    return new Promise((resolve, reject) => {
        try {
            wsConnection = new WebSocket(settings.serverAddress);
            wsConnection.onopen = () => {
                isConnected = true;
                const handshake = JSON.stringify([{ RequestServerInfo: { Id: generateMsgId(), ClientName: PLUGIN_NAME, MessageVersion: 3 } }]);
                wsConnection.send(handshake);
                updateConnectionUI(true);
                resolve();
            };
            wsConnection.onmessage = (e) => handleButtplugMessage(e.data);
            wsConnection.onclose = () => {
                isConnected = false; devices.clear(); pendingResponses.clear();
                updateConnectionUI(false); updateDevicePanel();
            };
            wsConnection.onerror = (err) => {
                toastr.error('Intiface 连接失败，请确保服务已启动并检查地址。');
                updateConnectionUI(false); reject(err);
            };
        } catch (e) {
            reject(e);
        }
    });
}

function disconnectFromServer() {
    if (wsConnection) {
        stopAllDevices();
        wsConnection.close();
    }
}

async function startScanning() {
    if (!isConnected) return toastr.warning('请先连接蓝牙服务器');
    try { await sendButtplugMessage({ StartScanning: { Id: generateMsgId() } }); } catch (e) { }
}
function stopScanning() {
    if (isConnected) sendButtplugMessage({ StopScanning: { Id: generateMsgId() } }).catch(() => { });
}

// ==================== 设备解析与能力 ====================

const SUCTION_TYPES = ['Constrict', 'Oscillate'];

function getDeviceCapabilities(device) {
    if (!device || !device.DeviceMessages) return [];
    const caps = [];

    const scalarFeatures = device.DeviceMessages['ScalarCmd'] || [];
    scalarFeatures.forEach((f, i) => {
        caps.push({ type: f.ActuatorType, index: i, cmdType: 'ScalarCmd' });
    });

    const linearCmd = device.DeviceMessages['LinearCmd'];
    if (linearCmd) {
        const count = Array.isArray(linearCmd) ? linearCmd.length : (linearCmd.FeatureCount || 1);
        for (let i = 0; i < count; i++) {
            caps.push({ type: 'Linear', index: i, cmdType: 'LinearCmd' });
        }
    }

    const rotateCmd = device.DeviceMessages['RotateCmd'];
    if (rotateCmd && !caps.some(c => c.type === 'Rotate')) {
        const count = Array.isArray(rotateCmd) ? rotateCmd.length : (rotateCmd.FeatureCount || 1);
        for (let i = 0; i < count; i++) {
            caps.push({ type: 'Rotate', index: i, cmdType: 'RotateCmd' });
        }
    }

    if (device.DeviceMessages['VibrateCmd'] && !caps.some(c => c.type === 'Vibrate')) {
        const count = device.DeviceMessages['VibrateCmd'].FeatureCount || 1;
        for (let i = 0; i < count; i++) {
            caps.push({ type: 'Vibrate', index: i, cmdType: 'VibrateCmd' });
        }
    }
    return caps;
}

function deviceSupportsVibrate(device) { return getDeviceCapabilities(device).some(c => c.type === 'Vibrate'); }
function deviceSupportsRotate(device) { return getDeviceCapabilities(device).some(c => c.type === 'Rotate'); }
function deviceSupportsLinear(device) { return getDeviceCapabilities(device).some(c => c.type === 'Linear'); }
function deviceSupportsSuction(device) { return getDeviceCapabilities(device).some(c => SUCTION_TYPES.includes(c.type)); }

function getFeatureCount(device, type) {
    if (type === 'Suction') return getDeviceCapabilities(device).filter(c => SUCTION_TYPES.includes(c.type)).length;
    return getDeviceCapabilities(device).filter(c => c.type === type).length;
}

function getCapabilityLabels(device) {
    const caps = getDeviceCapabilities(device);
    const labels = [];
    const vc = caps.filter(c => c.type === 'Vibrate').length;
    const sc = caps.filter(c => SUCTION_TYPES.includes(c.type)).length;
    const rc = caps.filter(c => c.type === 'Rotate').length;
    const lc = caps.filter(c => c.type === 'Linear').length;

    if (vc > 0) labels.push(`震动×${vc}`);
    if (sc > 0) labels.push(`吮吸×${sc}`);
    if (rc > 0) labels.push(`旋转×${rc}`);
    if (lc > 0) labels.push(`伸缩×${lc}`);
    return labels;
}

// ==================== 命令调用 ====================

async function vibrateDevice(deviceIndex, intensity, duration, featureIndex = null) {
    const device = devices.get(deviceIndex);
    if (!device) return;
    intensity = Math.max(0, Math.min(settings.maxIntensity, intensity));
    const vibrateCaps = getDeviceCapabilities(device).filter(c => c.type === 'Vibrate');

    if (vibrateCaps.length > 0 && vibrateCaps[0].cmdType === 'ScalarCmd') {
        const scalars = vibrateCaps.filter((_, i) => featureIndex === null || i === featureIndex)
            .map(c => ({ Index: c.index, Scalar: intensity, ActuatorType: 'Vibrate' }));
        if (scalars.length) await sendButtplugMessage({ ScalarCmd: { Id: generateMsgId(), DeviceIndex: deviceIndex, Scalars: scalars } }).catch(() => { });
    } else if (device.DeviceMessages?.['VibrateCmd']) {
        const count = device.DeviceMessages['VibrateCmd'].FeatureCount || 1;
        const speeds = [];
        for (let i = 0; i < count; i++) {
            if (featureIndex !== null && i !== featureIndex) continue;
            speeds.push({ Index: i, Speed: intensity });
        }
        await sendButtplugMessage({ VibrateCmd: { Id: generateMsgId(), DeviceIndex: deviceIndex, Speeds: speeds } }).catch(() => { });
    }

    if (duration > 0) setTimeout(() => vibrateDevice(deviceIndex, 0, 0, featureIndex), duration);
}

async function suckDevice(deviceIndex, intensity, duration, featureIndex = null) {
    const device = devices.get(deviceIndex);
    if (!device) return;
    intensity = Math.max(0, Math.min(settings.maxIntensity, intensity));
    const suctionCaps = getDeviceCapabilities(device).filter(c => SUCTION_TYPES.includes(c.type));

    if (suctionCaps.length === 0) return;
    const scalars = suctionCaps.filter((_, i) => featureIndex === null || i === featureIndex)
        .map(c => ({ Index: c.index, Scalar: intensity, ActuatorType: c.type }));

    if (scalars.length) await sendButtplugMessage({ ScalarCmd: { Id: generateMsgId(), DeviceIndex: deviceIndex, Scalars: scalars } }).catch(() => { });
    if (duration > 0) setTimeout(() => suckDevice(deviceIndex, 0, 0, featureIndex), duration);
}

async function rotateDevice(deviceIndex, speed, clockwise = true, duration, featureIndex = null) {
    const device = devices.get(deviceIndex);
    if (!device) return;
    speed = Math.max(0, Math.min(1.0, speed));
    const rotateCaps = getDeviceCapabilities(device).filter(c => c.type === 'Rotate');

    if (rotateCaps.length > 0) {
        if (rotateCaps[0].cmdType === 'ScalarCmd') {
            const scalars = rotateCaps.filter((_, i) => featureIndex === null || i === featureIndex)
                .map(c => ({ Index: c.index, Scalar: speed, ActuatorType: 'Rotate' }));
            if (scalars.length) await sendButtplugMessage({ ScalarCmd: { Id: generateMsgId(), DeviceIndex: deviceIndex, Scalars: scalars } }).catch(() => { });
        } else if (device.DeviceMessages?.['RotateCmd']) {
            const rotations = rotateCaps.filter((_, i) => featureIndex === null || i === featureIndex)
                .map(c => ({ Index: c.index, Speed: speed, Clockwise: clockwise }));
            await sendButtplugMessage({ RotateCmd: { Id: generateMsgId(), DeviceIndex: deviceIndex, Rotations: rotations } }).catch(() => { });
        }
    }
    if (duration > 0) setTimeout(() => rotateDevice(deviceIndex, 0, true, 0, featureIndex), duration);
}

async function linearDevice(deviceIndex, position, moveDuration, featureIndex = null) {
    const device = devices.get(deviceIndex);
    if (!device || !device.DeviceMessages?.['LinearCmd']) return;
    position = Math.max(0, Math.min(1.0, position));
    const caps = getDeviceCapabilities(device).filter(c => c.type === 'Linear');

    const vectors = caps.filter((_, i) => featureIndex === null || i === featureIndex)
        .map(c => ({ Index: c.index, Duration: moveDuration || 500, Position: position }));

    if (vectors.length) await sendButtplugMessage({ LinearCmd: { Id: generateMsgId(), DeviceIndex: deviceIndex, Vectors: vectors } }).catch(() => { });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function thrustDevice(deviceIndex, speed, stroke = 1.0, duration = 3000, featureIndex = null, loopId = currentLoopId) {
    const device = devices.get(deviceIndex);
    if (!device || !device.DeviceMessages?.['LinearCmd']) return;
    speed = Math.max(0.05, Math.min(1.0, speed)); stroke = Math.max(0.1, Math.min(1.0, stroke));
    const moveTime = Math.round(200 + (1 - speed) * 800);
    const posMin = Math.max(0, 0.5 - stroke / 2), posMax = Math.min(1.0, 0.5 + stroke / 2);
    const startTime = Date.now();
    let goingUp = true;
    while (Date.now() - startTime < duration && currentLoopId === loopId) {
        const targetPos = goingUp ? posMax : posMin;
        await linearDevice(deviceIndex, targetPos, moveTime, featureIndex);
        await sleep(moveTime + 50);
        goingUp = !goingUp;
    }
    await linearDevice(deviceIndex, 0.5, 300, featureIndex);
}

async function stopDevice(deviceIndex) {
    await sendButtplugMessage({ StopDeviceCmd: { Id: generateMsgId(), DeviceIndex: deviceIndex } }).catch(() => { });
}
async function stopAllDevices() {
    await sendButtplugMessage({ StopAllDevices: { Id: generateMsgId() } }).catch(() => { });
}

async function vibrateAllDevices(intensity, duration) {
    for (const [index, device] of devices) {
        if (deviceSupportsVibrate(device)) await vibrateDevice(index, intensity, duration);
    }
}

async function executePattern(pattern, intensity, duration, loopId = currentLoopId) {
    const startTime = Date.now();
    intensity = Math.max(0, Math.min(settings.maxIntensity, intensity));
    const interval = 100;

    switch (pattern) {
        case 'pulse': {
            let on = true;
            while (Date.now() - startTime < duration && currentLoopId === loopId) {
                await vibrateAllDevices(on ? intensity : intensity * 0.2);
                on = !on; await sleep(300);
            }
            break;
        }
        case 'wave': {
            const cycleTime = 2000;
            while (Date.now() - startTime < duration && currentLoopId === loopId) {
                const phase = ((Date.now() - startTime) % cycleTime) / cycleTime;
                await vibrateAllDevices(Math.max(0.05, Math.sin(phase * Math.PI) * intensity));
                await sleep(interval);
            }
            break;
        }
        case 'escalate': {
            const steps = duration / interval;
            for (let i = 0; i <= steps && Date.now() - startTime < duration && currentLoopId === loopId; i++) {
                await vibrateAllDevices(Math.max(0.05, (i / steps) * intensity));
                await sleep(interval);
            }
            break;
        }
        case 'tease': {
            while (Date.now() - startTime < duration && currentLoopId === loopId) {
                await vibrateAllDevices((Math.random() * 0.6 + 0.1) * intensity);
                await sleep(200 + Math.random() * 500);
            }
            break;
        }
        case 'heartbeat': {
            while (Date.now() - startTime < duration && currentLoopId === loopId) {
                await vibrateAllDevices(intensity); await sleep(150);
                if (currentLoopId !== loopId) break;
                await vibrateAllDevices(0); await sleep(100);
                if (currentLoopId !== loopId) break;
                await vibrateAllDevices(intensity); await sleep(150);
                if (currentLoopId !== loopId) break;
                await vibrateAllDevices(0); await sleep(600);
            }
            break;
        }
    }
    await stopAllDevices();
}

// ==================== 指令解析 ====================

function parseXMLAttributes(attrStr) {
    const attrs = {};
    const regex = /([\w]+)(?:="([^"]*)")?/g;
    let match;
    while ((match = regex.exec(attrStr)) !== null) attrs[match[1].toLowerCase()] = match[2] !== undefined ? match[2] : 'true';
    return attrs;
}

// 序列值支持：将 "0.2,0.5,0.8" 展开为多个步进命令，实现单标签内变化节奏
// duration 按步数均分，每步使用 _stepDuration 控制循环引擎等待时间，duration=0 防止设备自动停止计时器的竞态
function expandSequence(raw, type, valStr, paramKey, globalDur, deviceIndex, featureIndex, defaultVal, extraParams = {}) {
    if (typeof valStr === 'string' && valStr.includes(',')) {
        const steps = valStr.split(',').map(s => parseFloat(s.trim())).filter(v => !isNaN(v) && v >= 0);
        if (steps.length > 0) {
            const stepDur = Math.round(globalDur / steps.length);
            return steps.map(v => ({
                raw, type,
                params: { ...extraParams, [paramKey]: Math.max(0, Math.min(1.0, v)), duration: 0, _stepDuration: stepDur, featureIndex, deviceIndex }
            }));
        }
    }
    return [{ raw, type, params: { ...extraParams, [paramKey]: parseFloat(valStr) || defaultVal, duration: globalDur, featureIndex, deviceIndex } }];
}

function buildXMLCommands(attrs, raw) {
    const commands = [];
    const globalDur = parseInt(attrs.duration) || settings.defaultDuration;
    const deviceIndex = attrs.device !== undefined ? parseInt(attrs.device) : undefined;

    if ('stop' in attrs) return [{ raw, type: 'stop', params: {} }];
    if ('pattern' in attrs) return [{ raw, type: 'pattern', params: { pattern: attrs.pattern || 'pulse', intensity: parseFloat(attrs.intensity) || settings.defaultIntensity, duration: globalDur, deviceIndex } }];

    // Vibrate - 支持序列: vibrate="0.2,0.5,0.8"
    if ('vibrate' in attrs) commands.push(...expandSequence(raw, 'vibrate', attrs.vibrate, 'intensity', globalDur, deviceIndex, null, settings.defaultIntensity));
    for (let i = 1; i <= 8; i++) {
        if (`vibrate${i}` in attrs) commands.push(...expandSequence(raw, 'vibrate', attrs[`vibrate${i}`], 'intensity', globalDur, deviceIndex, i - 1, settings.defaultIntensity));
    }

    // Suck - 支持序列: suck="0.3,0.6,0.9"
    if ('suck' in attrs) commands.push(...expandSequence(raw, 'suck', attrs.suck, 'intensity', globalDur, deviceIndex, null, settings.defaultIntensity));
    for (let i = 1; i <= 4; i++) {
        if (`suck${i}` in attrs) commands.push(...expandSequence(raw, 'suck', attrs[`suck${i}`], 'intensity', globalDur, deviceIndex, i - 1, settings.defaultIntensity));
    }

    // Thrust - 支持序列: thrust="0.3,0.6,0.9"
    if ('thrust' in attrs) commands.push(...expandSequence(raw, 'thrust', attrs.thrust, 'speed', globalDur, deviceIndex, null, 0.5, { stroke: parseFloat(attrs.stroke) || 1.0 }));
    for (let i = 1; i <= 4; i++) {
        if (`thrust${i}` in attrs) commands.push(...expandSequence(raw, 'thrust', attrs[`thrust${i}`], 'speed', globalDur, deviceIndex, i - 1, 0.5, { stroke: parseFloat(attrs.stroke) || 1.0 }));
    }

    // Linear (不支持序列，单次定位)
    if ('linear' in attrs) commands.push({ raw, type: 'linear', params: { position: parseFloat(attrs.linear) || 0.5, moveDuration: parseInt(attrs.move) || 500, featureIndex: null, deviceIndex } });

    // Rotate - 支持序列: rotate="0.3,0.6,0.9"
    if ('rotate' in attrs) commands.push(...expandSequence(raw, 'rotate', attrs.rotate, 'speed', globalDur, deviceIndex, null, 0.5, { clockwise: attrs.clockwise !== 'false' }));

    return commands;
}

function buildBracketCommands(parts, raw) {
    const type = parts[0]?.toLowerCase() || 'unknown';
    const commands = [];
    switch (type) {
        case 'vibrate': {
            const dur = parseInt(parts[2]) || settings.defaultDuration;
            const featIdx = parts[3] !== undefined ? parseInt(parts[3]) : null;
            commands.push(...expandSequence(raw, 'vibrate', parts[1] || String(settings.defaultIntensity), 'intensity', dur, undefined, featIdx, settings.defaultIntensity));
            break;
        }
        case 'suck': {
            const dur = parseInt(parts[2]) || settings.defaultDuration;
            const featIdx = parts[3] !== undefined ? parseInt(parts[3]) : null;
            commands.push(...expandSequence(raw, 'suck', parts[1] || String(settings.defaultIntensity), 'intensity', dur, undefined, featIdx, settings.defaultIntensity));
            break;
        }
        case 'thrust': {
            const dur = parseInt(parts[3]) || settings.defaultDuration;
            const stroke = parseFloat(parts[2]) || 1.0;
            commands.push(...expandSequence(raw, 'thrust', parts[1] || '0.5', 'speed', dur, undefined, null, 0.5, { stroke }));
            break;
        }
        case 'linear':
            commands.push({ raw, type: 'linear', params: { position: parseFloat(parts[1]) || 0.5, moveDuration: parseInt(parts[2]) || 500 } });
            break;
        case 'rotate': {
            const dur = parseInt(parts[3]) || settings.defaultDuration;
            commands.push(...expandSequence(raw, 'rotate', parts[1] || '0.5', 'speed', dur, undefined, null, 0.5, { clockwise: parts[2] !== 'false' }));
            break;
        }
        case 'stop': commands.push({ raw, type: 'stop', params: {} }); break;
        case 'pattern': commands.push({ raw, type: 'pattern', params: { pattern: parts[1] || 'pulse', intensity: parseFloat(parts[2]) || settings.defaultIntensity, duration: parseInt(parts[3]) || 3000 } }); break;
        case 'combo': {
            const actions = (parts[1] || '').split(',');
            const duration = parseInt(parts[2]) || settings.defaultDuration;
            for (const action of actions) {
                const [act, val] = action.split('=');
                switch (act?.toLowerCase()) {
                    case 'vibrate': commands.push({ raw, type: 'vibrate', params: { intensity: parseFloat(val) || 0.5, duration } }); break;
                    case 'thrust': commands.push({ raw, type: 'thrust', params: { speed: parseFloat(val) || 0.5, stroke: 1.0, duration } }); break;
                    case 'suck': commands.push({ raw, type: 'suck', params: { intensity: parseFloat(val) || 0.5, duration } }); break;
                    case 'rotate': commands.push({ raw, type: 'rotate', params: { speed: parseFloat(val) || 0.5, clockwise: true, duration } }); break;
                }
            }
            break;
        }
    }
    return commands;
}

function parseCommands(text) {
    const commands = [];
    if (settings.tagFormat === 'xml' || settings.tagFormat === 'both') {
        const xmlRegex = /<toy\s+([^>]*?)\s*\/?>/gi;
        let match;
        while ((match = xmlRegex.exec(text)) !== null) {
            commands.push(...buildXMLCommands(parseXMLAttributes(match[1]), match[0]));
        }
    }
    if (settings.tagFormat === 'bracket' || settings.tagFormat === 'both') {
        const bracketRegex = /\[toy:([^\]]+)\]/gi;
        let match;
        while ((match = bracketRegex.exec(text)) !== null) {
            commands.push(...buildBracketCommands(match[1].split(':'), match[0]));
        }
    }
    return commands;
}

// ==================== 队列与执行 ====================

let currentLoopId = 0;
let loopCommands = [];

async function executeCommand(cmd, loopId) {
    if (!isConnected || !settings.enabled || currentLoopId !== loopId) return;
    const p = cmd.params;
    let cmdDuration = p._stepDuration || p.duration || settings.defaultDuration;
    let executed = false;

    switch (cmd.type) {
        case 'vibrate':
            if (p.deviceIndex !== undefined) {
                await vibrateDevice(p.deviceIndex, p.intensity, p.duration, p.featureIndex ?? null);
                executed = true;
            } else {
                for (const [index, device] of devices) {
                    if (deviceSupportsVibrate(device)) {
                        await vibrateDevice(index, p.intensity, p.duration, p.featureIndex ?? null);
                        executed = true;
                    }
                }
            }
            break;
        case 'suck':
            if (p.deviceIndex !== undefined) {
                await suckDevice(p.deviceIndex, p.intensity, p.duration, p.featureIndex ?? null);
                executed = true;
            } else {
                for (const [index, device] of devices) {
                    if (deviceSupportsSuction(device)) {
                        await suckDevice(index, p.intensity, p.duration, p.featureIndex ?? null);
                        executed = true;
                    }
                }
            }
            // 降级：设备不支持吮吸时，用震动代替
            if (!executed) {
                log(`[降级] 设备不支持吮吸，用震动代替 (强度=${p.intensity})`);
                for (const [index, device] of devices) {
                    if (deviceSupportsVibrate(device)) {
                        await vibrateDevice(index, p.intensity, p.duration, p.featureIndex ?? null);
                        executed = true;
                    }
                }
            }
            break;
        case 'thrust':
            const tP = [];
            for (const [index, device] of devices) {
                if (p.deviceIndex !== undefined && p.deviceIndex !== index) continue;
                if (deviceSupportsLinear(device)) {
                    tP.push(thrustDevice(index, p.speed, p.stroke, p.duration, p.featureIndex ?? null, loopId));
                    executed = true;
                }
            }
            await Promise.all(tP);
            // 降级：设备不支持伸缩时，用震动代替（speed 当 intensity 用）
            if (!executed) {
                log(`[降级] 设备不支持伸缩，用震动代替 (强度=${p.speed})`);
                for (const [index, device] of devices) {
                    if (deviceSupportsVibrate(device)) {
                        await vibrateDevice(index, p.speed, 0, p.featureIndex ?? null);
                        executed = true;
                    }
                }
            }
            break;
        case 'linear':
            for (const [index, device] of devices) {
                if (p.deviceIndex !== undefined && p.deviceIndex !== index) continue;
                if (deviceSupportsLinear(device)) {
                    await linearDevice(index, p.position, p.moveDuration, p.featureIndex ?? null);
                    executed = true;
                }
            }
            break;
        case 'rotate':
            for (const [index, device] of devices) {
                if (p.deviceIndex !== undefined && p.deviceIndex !== index) continue;
                if (deviceSupportsRotate(device)) {
                    await rotateDevice(index, p.speed, p.clockwise, p.duration, p.featureIndex ?? null);
                    executed = true;
                }
            }
            break;
        case 'stop':
            await stopAllDevices();
            executed = true;
            break;
        case 'pattern':
            await executePattern(p.pattern, p.intensity, p.duration, loopId);
            executed = true;
            break;
    }

    if (!executed) {
        log(`[执行] 指令 ${cmd.type} 未被任何设备执行（设备不支持此功能）`, 'warn');
    }

    // 等待当前指令的持续时间，再进入下一个指令
    if (cmd.type !== 'stop') {
        let elapsed = 0;
        while (elapsed < cmdDuration && currentLoopId === loopId) {
            await sleep(100);
            elapsed += 100;
        }
    }
}

async function loopEngine(loopId) {
    while (currentLoopId === loopId) {
        for (const cmd of loopCommands) {
            if (currentLoopId !== loopId) break;
            await executeCommand(cmd, loopId);
            if (currentLoopId !== loopId) break;
            await sleep(settings.commandGap);
        }
        if (currentLoopId !== loopId) break;
        // 如果命令列表为空，避免死循环打满 CPU
        if (loopCommands.length === 0) break;
        await sleep(100);
    }
}

let lastCmdFingerprint = '';

function processAIMessage(messageText) {
    if (!settings.enabled || !isConnected) return;

    // HTML 反转义（ST 可能将 <toy> 存储为 &lt;toy&gt;）
    let text = messageText;
    if (text.includes('&lt;') || text.includes('&gt;')) {
        const tmp = document.createElement('textarea');
        tmp.innerHTML = text;
        text = tmp.value;
    }

    const commands = parseCommands(text);
    const fingerprint = JSON.stringify(commands);
    if (fingerprint === lastCmdFingerprint) return;
    lastCmdFingerprint = fingerprint;

    currentLoopId++;
    const myLoopId = currentLoopId;

    if (commands.length > 0) {
        loopCommands = commands;
        const summary = commands.map(c => `${c.type}(${c.params.intensity ?? c.params.speed ?? ''})`).join(', ');
        log(`命中 ${commands.length} 条指令: ${summary} | 循环#${myLoopId}`);
        loopEngine(myLoopId);
    } else {
        loopCommands = [];
        stopAllDevices();
    }
}

// ==================== 初始化与存储 ====================

function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function loadSettings() {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (saved) {
        try {
            settings = { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
        } catch (e) { }
    }
    // 强制固化隐藏的核心参数（无视历史缓存）
    settings.defaultDuration = 20000;
    settings.defaultIntensity = 0.5;
    settings.maxIntensity = 1.0;
    settings.tagFormat = 'both';
}

// Native ST Plugin init

jQuery(async function () {
    loadSettings();
    initUI();

    // initUI 完成后 log() 函数才能写入 UI 面板
    log(`插件 v${PLUGIN_VERSION} 开始初始化...`);

    // ---- 获取酒馆核心对象 ----
    let ST_eventSource = null;
    let ST_event_types = null;
    let ST_getContext = null;

    // 第一步：获取 getContext（最可靠的入口）
    if (window.getContext) {
        ST_getContext = window.getContext;
    } else if (window.SillyTavern?.getContext) {
        ST_getContext = window.SillyTavern.getContext;
    } else {
        // 通过 import 获取 getContext
        const ctxPaths = ['../../../../extensions.js', '../../../extensions.js', '../../extensions.js'];
        for (const p of ctxPaths) {
            try {
                const mod = await import(p);
                if (mod.getContext) { ST_getContext = mod.getContext; break; }
            } catch (e) { /* 继续 */ }
        }
    }

    // 第二步：从 getContext() 获取 eventSource（这是运行时的真实实例！）
    if (ST_getContext) {
        log('getContext 已就绪');
        try {
            const ctx = ST_getContext();
            if (ctx && ctx.eventSource) {
                ST_eventSource = ctx.eventSource;
                ST_event_types = ctx.event_types;
                log('通过 getContext() 获取到运行时 eventSource（真实实例）');
            }
        } catch (e) {
            log(`getContext() 调用失败: ${e.message}`, 'warn');
        }
    }

    // 第三步：兜底 - 检查 window 全局变量
    if (!ST_eventSource && window.eventSource) {
        ST_eventSource = window.eventSource;
        ST_event_types = window.event_types;
        log('通过 window 全局对象获取到 eventSource');
    }

    // 第四步：最终兜底 - 动态 import（注意：可能拿到不同的模块实例！）
    if (!ST_eventSource) {
        const loadPaths = [
            '../../../../script.js',
            '../../../script.js',
            '../../script.js',
        ];
        for (const path of loadPaths) {
            try {
                const mod = await import(path);
                if (mod.eventSource) {
                    ST_eventSource = mod.eventSource;
                    ST_event_types = mod.event_types;
                    log(`通过 import("${path}") 获取到 eventSource (可能是独立实例!)`, 'warn');
                    break;
                }
            } catch (e) {
                log(`import("${path}") 失败: ${e.message}`, 'warn');
            }
        }
    }

    if (!ST_getContext) {
        log('getContext 未获取到', 'warn');
    }

    // ---- 辅助函数：从 chat 中取最新的 AI 消息 ----
    function getAssistantMessage() {
        if (!ST_getContext) return null;
        try {
            const chat = ST_getContext().chat;
            if (!chat || chat.length === 0) return null;
            for (let i = chat.length - 1; i >= Math.max(0, chat.length - 3); i--) {
                if (chat[i] && chat[i].is_user !== true && chat[i].mes) return chat[i];
            }
        } catch (e) { }
        return null;
    }

    // ---- 轮询引擎（500ms 检查最新消息） ----
    let lastPolledMes = '';

    setInterval(() => {
        if (!settings.enabled || !isConnected || !ST_getContext) return;
        const msg = getAssistantMessage();
        if (!msg || !msg.mes || msg.mes === lastPolledMes) return;
        lastPolledMes = msg.mes;
        processAIMessage(msg.mes);
    }, 500);

    log('轮询引擎已启动');

    // ---- 手动解析诊断函数（绕开事件系统） ----
    window._ifDiagParse = () => {
        log('--- 手动诊断开始 ---');

        if (!ST_getContext) {
            log('[诊断] getContext 不可用!', 'error');
            return;
        }

        const chat = ST_getContext().chat;
        log(`[诊断] chat 数组长度: ${chat ? chat.length : 'null'}`);

        if (!chat || chat.length === 0) {
            log('[诊断] 聊天记录为空', 'error');
            return;
        }

        let lastAI = null;
        for (let i = chat.length - 1; i >= 0; i--) {
            if (chat[i] && chat[i].is_user !== true) {
                lastAI = chat[i];
                log(`[诊断] 找到 AI 消息 #${i}, is_user=${chat[i].is_user}`);
                break;
            }
        }

        if (!lastAI) {
            log('[诊断] 未找到 AI 消息', 'error');
            return;
        }

        const rawText = lastAI.mes || '';
        log(`[诊断] 原始 mes 前200字: ${rawText.substring(0, 200).replace(/</g, '＜').replace(/>/g, '＞')}`);

        let text = rawText;
        if (text.includes('&lt;') || text.includes('&gt;')) {
            const tmp = document.createElement('textarea');
            tmp.innerHTML = text;
            text = tmp.value;
            log(`[诊断] HTML 反转义后前200字: ${text.substring(0, 200).replace(/</g, '＜').replace(/>/g, '＞')}`);
        }

        const cmds = parseCommands(text);
        log(`[诊断] 解析出 ${cmds.length} 条指令`);
        cmds.forEach((c, i) => log(`[诊断]  #${i}: ${c.type} ${JSON.stringify(c.params)}`));

        if (cmds.length > 0 && isConnected) {
            log('[诊断] 正在执行解析到的指令...');
            processAIMessage(rawText);
        } else if (!isConnected) {
            log('[诊断] 未连接设备，无法执行', 'warn');
        }

        log('--- 手动诊断结束 ---');
    };

    // 自动连接
    if (settings.autoConnect) {
        setTimeout(() => connectToServer().catch(() => { }), 2000);
    }

    log(`v${PLUGIN_VERSION} 初始化完毕`);
});
