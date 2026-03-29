/* 
  ST-Intiface-Plugin - 原生 SillyTavern 扩展
  通过 Intiface Central 控制蓝牙玩具，支持多驱动和复杂指令并发。
*/

// 为了避免不同安装路径（原生扩展 vs 第三方安装器）带来的相对路径层级报错（404 Not Found），
// 此处我们取消写死的 ES6 import，直接在运行时动态引用 SillyTavern 暴露的全局对象。

const PLUGIN_NAME = 'IntifaceControl';
const SETTINGS_KEY = 'intiface_plugin_settings';

const DEFAULT_SETTINGS = {
    serverAddress: 'ws://localhost:12345',
    autoConnect: false,
    enabled: true,
    tagFormat: 'xml',
    defaultDuration: 1000,
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
            <b>玩具控制器</b>
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
                    <button class="if-btn if-btn-secondary" id="if-scan-btn" disabled>扫描设备</button>
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
                    <div class="if-setting-row">
                        <div class="if-setting-label">标签识别格式</div>
                        <select class="if-select" id="if-set-format">
                            <option value="xml" ${settings.tagFormat === 'xml' ? 'selected' : ''}>XML 标签格式</option>
                            <option value="bracket" ${settings.tagFormat === 'bracket' ? 'selected' : ''}>方括号格式</option>
                            <option value="both" ${settings.tagFormat === 'both' ? 'selected' : ''}>全部识别</option>
                        </select>
                    </div>
                    <div class="if-setting-row">
                        <div class="if-setting-label">默认工作时长 (ms)</div>
                        <input type="number" class="if-setting-input" id="if-set-duration" value="${settings.defaultDuration}" min="100" step="100" />
                    </div>
                    <div class="if-setting-row">
                        <div class="if-setting-label">最大强度限制</div>
                        <input type="number" class="if-setting-input" id="if-set-maxint" value="${settings.maxIntensity}" min="0.1" max="1" step="0.1" />
                    </div>
                    <div class="if-setting-row">
                        <div class="if-setting-label">默认强度</div>
                        <input type="number" class="if-setting-input" id="if-set-defint" value="${settings.defaultIntensity}" min="0.1" max="1" step="0.1" />
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

        // 绑定主面板下拉展开
        $('#intiface-plugin-drawer .inline-drawer-toggle').on('click', function () {
            const content = $(this).next('.inline-drawer-content');
            const icon = $(this).find('.inline-drawer-icon');
            if (content.is(':visible')) {
                content.slideUp(200);
                icon.removeClass('up').addClass('down');
            } else {
                content.slideDown(200);
                icon.removeClass('down').addClass('up');
            }
        });

        $('.if-collapsible').on('click', function () {
            $(this).next('.if-collapse-content').toggleClass('collapsed');
        });

        $('#if-connect-btn').on('click', async () => {
            settings.serverAddress = $('#if-server-address').val().trim();
            saveSettings();
            await connectToServer();
        });

        $('#if-disconnect-btn').on('click', () => disconnectFromServer());
        $('#if-scan-btn').on('click', async () => {
            await startScanning();
            setTimeout(() => stopScanning(), 5000);
        });

        $('#if-stop-all').on('click', () => stopAllDevices());

        // 设置保存绑定
        $('#if-set-enabled').on('change', function () { settings.enabled = $(this).prop('checked'); saveSettings(); });
        $('#if-set-autoconnect').on('change', function () { settings.autoConnect = $(this).prop('checked'); saveSettings(); });
        $('#if-set-format').on('change', function () { settings.tagFormat = $(this).val(); saveSettings(); });
        $('#if-set-duration').on('change', function () { settings.defaultDuration = parseInt($(this).val()); saveSettings(); });
        $('#if-set-maxint').on('change', function () { settings.maxIntensity = parseFloat($(this).val()); saveSettings(); });
        $('#if-set-defint').on('change', function () { settings.defaultIntensity = parseFloat($(this).val()); saveSettings(); });

        $('.pattern-btn').on('click', function () {
            const pat = $(this).data('pattern');
            if (!isConnected || devices.size === 0) return toastr.warning('请先连接蓝牙玩具设备');
            executePattern(pat, settings.defaultIntensity, 3000);
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
        $('#if-scan-btn').prop('disabled', false);
    } else {
        statusDot.css({ background: 'linear-gradient(135deg, #ff5252, #ff8a80)', boxShadow: '0 0 8px rgba(255,82,82,0.6)' });
        statusText.text('未连接');
        $('#if-connect-btn').show();
        $('#if-disconnect-btn').hide();
        $('#if-scan-btn').prop('disabled', true);
    }
}

function updateDevicePanel() {
    const list = $('#if-device-list');
    if (devices.size === 0) {
        list.html('<div class="device-empty">暂无设备连接，请点击扫描。</div>');
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
                    ${canVibrate ? `<button class="btn-sm btn-vibrate" onclick="window._ifTrigger.vibrate(${index}, null)">全震</button>` : ''}
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

function handleButtplugMessage(data) {
    try {
        const messages = JSON.parse(data);
        for (const msg of messages) {
            const type = Object.keys(msg)[0];
            const content = msg[type];
            switch (type) {
                case 'ServerInfo':
                    toastr.success(`已连接到服务器: ${content.ServerName}`);
                    sendButtplugMessage({ RequestDeviceList: { Id: generateMsgId() } }).catch(() => { });
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

async function thrustDevice(deviceIndex, speed, stroke = 1.0, duration = 3000, featureIndex = null) {
    const device = devices.get(deviceIndex);
    if (!device || !device.DeviceMessages?.['LinearCmd']) return;
    speed = Math.max(0.05, Math.min(1.0, speed)); stroke = Math.max(0.1, Math.min(1.0, stroke));
    const moveTime = Math.round(200 + (1 - speed) * 800);
    const posMin = Math.max(0, 0.5 - stroke / 2), posMax = Math.min(1.0, 0.5 + stroke / 2);
    const startTime = Date.now();
    let goingUp = true;
    while (Date.now() - startTime < duration) {
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

async function executePattern(pattern, intensity, duration) {
    const startTime = Date.now();
    intensity = Math.max(0, Math.min(settings.maxIntensity, intensity));
    const interval = 100;

    switch (pattern) {
        case 'pulse': {
            let on = true;
            while (Date.now() - startTime < duration) {
                await vibrateAllDevices(on ? intensity : intensity * 0.2);
                on = !on; await sleep(300);
            }
            break;
        }
        case 'wave': {
            const cycleTime = 2000;
            while (Date.now() - startTime < duration) {
                const phase = ((Date.now() - startTime) % cycleTime) / cycleTime;
                await vibrateAllDevices(Math.max(0.05, Math.sin(phase * Math.PI) * intensity));
                await sleep(interval);
            }
            break;
        }
        case 'escalate': {
            const steps = duration / interval;
            for (let i = 0; i <= steps && Date.now() - startTime < duration; i++) {
                await vibrateAllDevices(Math.max(0.05, (i / steps) * intensity));
                await sleep(interval);
            }
            break;
        }
        case 'tease': {
            while (Date.now() - startTime < duration) {
                await vibrateAllDevices((Math.random() * 0.6 + 0.1) * intensity);
                await sleep(200 + Math.random() * 500);
            }
            break;
        }
        case 'heartbeat': {
            while (Date.now() - startTime < duration) {
                await vibrateAllDevices(intensity); await sleep(150);
                await vibrateAllDevices(0); await sleep(100);
                await vibrateAllDevices(intensity); await sleep(150);
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

function buildXMLCommands(attrs, raw) {
    const commands = [];
    const globalDur = parseInt(attrs.duration) || settings.defaultDuration;
    const deviceIndex = attrs.device !== undefined ? parseInt(attrs.device) : undefined;

    if ('stop' in attrs) return [{ raw, type: 'stop', params: {} }];
    if ('pattern' in attrs) return [{ raw, type: 'pattern', params: { pattern: attrs.pattern || 'pulse', intensity: parseFloat(attrs.intensity) || settings.defaultIntensity, duration: globalDur, deviceIndex } }];

    // Vibrate
    if ('vibrate' in attrs) commands.push({ raw, type: 'vibrate', params: { intensity: parseFloat(attrs.vibrate) || settings.defaultIntensity, duration: globalDur, featureIndex: null, deviceIndex } });
    for (let i = 1; i <= 8; i++) {
        if (`vibrate${i}` in attrs) commands.push({ raw, type: 'vibrate', params: { intensity: parseFloat(attrs[`vibrate${i}`]) || settings.defaultIntensity, duration: globalDur, featureIndex: i - 1, deviceIndex } });
    }

    // Suck
    if ('suck' in attrs) commands.push({ raw, type: 'suck', params: { intensity: parseFloat(attrs.suck) || settings.defaultIntensity, duration: globalDur, featureIndex: null, deviceIndex } });
    for (let i = 1; i <= 4; i++) {
        if (`suck${i}` in attrs) commands.push({ raw, type: 'suck', params: { intensity: parseFloat(attrs[`suck${i}`]) || settings.defaultIntensity, duration: globalDur, featureIndex: i - 1, deviceIndex } });
    }

    // Thrust
    if ('thrust' in attrs) commands.push({ raw, type: 'thrust', params: { speed: parseFloat(attrs.thrust) || 0.5, stroke: parseFloat(attrs.stroke) || 1.0, duration: globalDur, featureIndex: null, deviceIndex } });
    for (let i = 1; i <= 4; i++) {
        if (`thrust${i}` in attrs) commands.push({ raw, type: 'thrust', params: { speed: parseFloat(attrs[`thrust${i}`]) || 0.5, stroke: parseFloat(attrs.stroke) || 1.0, duration: globalDur, featureIndex: i - 1, deviceIndex } });
    }

    // Linear
    if ('linear' in attrs) commands.push({ raw, type: 'linear', params: { position: parseFloat(attrs.linear) || 0.5, moveDuration: parseInt(attrs.move) || 500, featureIndex: null, deviceIndex } });

    // Rotate
    if ('rotate' in attrs) commands.push({ raw, type: 'rotate', params: { speed: parseFloat(attrs.rotate) || 0.5, clockwise: attrs.clockwise !== 'false', duration: globalDur, featureIndex: null, deviceIndex } });

    return commands;
}

function buildBracketCommands(parts, raw) {
    const type = parts[0]?.toLowerCase() || 'unknown';
    const commands = [];
    switch (type) {
        case 'vibrate': commands.push({ raw, type: 'vibrate', params: { intensity: parseFloat(parts[1]) || settings.defaultIntensity, duration: parseInt(parts[2]) || settings.defaultDuration, featureIndex: parts[3] !== undefined ? parseInt(parts[3]) : null } }); break;
        case 'suck': commands.push({ raw, type: 'suck', params: { intensity: parseFloat(parts[1]) || settings.defaultIntensity, duration: parseInt(parts[2]) || settings.defaultDuration, featureIndex: parts[3] !== undefined ? parseInt(parts[3]) : null } }); break;
        case 'thrust': commands.push({ raw, type: 'thrust', params: { speed: parseFloat(parts[1]) || 0.5, stroke: parseFloat(parts[2]) || 1.0, duration: parseInt(parts[3]) || settings.defaultDuration } }); break;
        case 'linear': commands.push({ raw, type: 'linear', params: { position: parseFloat(parts[1]) || 0.5, moveDuration: parseInt(parts[2]) || 500 } }); break;
        case 'rotate': commands.push({ raw, type: 'rotate', params: { speed: parseFloat(parts[1]) || 0.5, clockwise: parts[2] !== 'false', duration: parseInt(parts[3]) || settings.defaultDuration } }); break;
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

async function executeCommand(cmd) {
    if (!isConnected || !settings.enabled) return;
    const p = cmd.params;
    switch (cmd.type) {
        case 'vibrate':
            if (p.deviceIndex !== undefined) await vibrateDevice(p.deviceIndex, p.intensity, p.duration, p.featureIndex ?? null);
            else for (const [index, device] of devices) if (deviceSupportsVibrate(device)) await vibrateDevice(index, p.intensity, p.duration, p.featureIndex ?? null);
            break;
        case 'suck':
            if (p.deviceIndex !== undefined) await suckDevice(p.deviceIndex, p.intensity, p.duration, p.featureIndex ?? null);
            else for (const [index, device] of devices) if (deviceSupportsSuction(device)) await suckDevice(index, p.intensity, p.duration, p.featureIndex ?? null);
            break;
        case 'thrust':
            const tP = [];
            for (const [index, device] of devices) {
                if (p.deviceIndex !== undefined && p.deviceIndex !== index) continue;
                if (deviceSupportsLinear(device)) tP.push(thrustDevice(index, p.speed, p.stroke, p.duration, p.featureIndex ?? null));
            }
            await Promise.all(tP);
            break;
        case 'linear':
            for (const [index, device] of devices) {
                if (p.deviceIndex !== undefined && p.deviceIndex !== index) continue;
                if (deviceSupportsLinear(device)) await linearDevice(index, p.position, p.moveDuration, p.featureIndex ?? null);
            }
            break;
        case 'rotate':
            for (const [index, device] of devices) {
                if (p.deviceIndex !== undefined && p.deviceIndex !== index) continue;
                if (deviceSupportsRotate(device)) await rotateDevice(index, p.speed, p.clockwise, p.duration, p.featureIndex ?? null);
            }
            break;
        case 'stop': await stopAllDevices(); break;
        case 'pattern': await executePattern(p.pattern, p.intensity, p.duration); break;
    }
}

async function processCommandQueue() {
    if (isProcessingQueue || commandQueue.length === 0) return;
    isProcessingQueue = true;
    while (commandQueue.length > 0) {
        const batch = [commandQueue.shift()];
        while (commandQueue.length > 0 && commandQueue[0].raw === batch[0].raw) batch.push(commandQueue.shift());

        if (batch.length === 1) await executeCommand(batch[0]);
        else await Promise.all(batch.map(cmd => executeCommand(cmd)));

        if (commandQueue.length > 0) await sleep(settings.commandGap);
    }
    isProcessingQueue = false;
}

function processAIMessage(messageText) {
    if (!settings.enabled || !isConnected) return;
    const commands = parseCommands(messageText);
    if (commands.length > 0) {
        commandQueue.push(...commands);
        processCommandQueue();
    }
}

// ==================== 初始化与存储 ====================

function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function loadSettings() {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (saved) {
        try { settings = { ...DEFAULT_SETTINGS, ...JSON.parse(saved) }; } catch (e) { }
    }
}

// Native ST Plugin init

// 根级别日志：只要酒馆加载了这个 JS 文件，这句话就必须会出现
console.log('%c[玩具控制器] %c插件脚本核心已成功载入内存！等待酒馆 DOM 准备就绪...', 'color: #00e676; font-weight: bold;', 'color: #aaa;');

jQuery(async function () {
    console.log('%c[玩具控制器] %c开始初始化界面和事件监听...', 'color: #00e676; font-weight: bold;', 'color: #fff;');
    loadSettings();
    initUI();

    // 动态获取全局对象，防止被包裹在严格模块作用域中导致 ReferenceError
    const ST_eventSource = window.eventSource;
    const ST_event_types = window.event_types;
    const ST_getContext = window.getContext;

    if (!ST_eventSource || !ST_event_types) {
        console.error('%c[玩具控制器] %c找不到酒馆全局变量 eventSource，插件无法正常接收消息事件！请检查安装方式。', 'color: #ff5252; font-weight: bold;', 'color: #ff5252;');
    } else {
        // 监听原生 ST 事件
        ST_eventSource.on(ST_event_types.MESSAGE_RECEIVED, async (messageId) => {
            try {
                if (!ST_getContext) return;
                const chat = ST_getContext().chat;
                const message = chat.find(m => m.mes === messageId || m._id === messageId || m.uid === messageId) || chat[chat.length - 1]; // Fallback to last message
                if (message && message.is_user !== true) { // Assistant 消息
                    processAIMessage(message.mes);
                }
            } catch (e) {
                console.error('[玩具控制器] handler error:', e);
            }
        });

        ST_eventSource.on(ST_event_types.MESSAGE_EDITED, (messageId) => {
            try {
                if (!ST_getContext) return;
                const chat = ST_getContext().chat;
                const message = chat.find(m => m.mes === messageId || m._id === messageId || m.uid === messageId);
                if (message && message.is_user !== true) processAIMessage(message.mes);
            } catch (e) {
                console.error('[玩具控制器] edit handler error:', e);
            }
        });
    }

    if (settings.autoConnect) {
        setTimeout(() => connectToServer().catch(() => { }), 2000);
    }

    console.log('%c[玩具控制器] %c插件初始化完成！你现在可以进入[扩展]菜单面板中打开玩具控制面板。', 'color: #00e676; font-weight: bold;', 'color: #fff;');
});
