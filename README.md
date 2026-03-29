# Intiface 玩具控制器 - SillyTavern 原生扩展插件

这是一个用于 SillyTavern (酒馆) 的 **原生** 扩展插件。它的主要功能是通过连接本地或远程的 Intiface Central 软件，让 AI 角色能够实现在聊天中输出代码来控制你的蓝牙互动玩具。

> ⚠️ 该插件已完全重写为 **SillyTavern 原生扩展引擎**，不再依赖原先的 IFRAME 或者 JS-Slash-Runner，完美兼容最新的 UI 布局并集成到顶部控制栏。

## 功能特性
- 💬 **无缝融入**：在顶部菜单栏添加一个独立的玩具控制面板(横条菜单按钮 `🎮`)，无需进入复杂的设置菜单。
- 🔄 **直连底层通信**：使用 WebSocket 原生实现 Buttplug.io 协议，丢弃原先容易报错的 CDN 库。
- 🕹️ **强大多设备支持**：支持同时控制多个设备，而且完美解析具有多马达（如双震动马达）、多驱动形式（震动、伸缩、吮吸、旋转同时存在）的复杂功能。
- 🎭 **多种模式预设**：不仅能够发送强度的信号，更内置包含 `脉冲`、`波浪`、`渐强`、`挑逗`、`心跳` 在内的高级震动节奏控制。

## 安装步骤

1. 把整个 `ST-Intiface-Plugin` 文件夹复制或移动到你酒馆所在目录下的 `public/extensions/` 文件夹中。
   目录结构应该是这样的：
   ```
   SillyTavern
   └── public
       └── extensions
           └── ST-Intiface-Plugin
               ├── index.js
               ├── style.css
               └── config.yaml
   ```
2. 重启 SillyTavern 服务器。
3. 刷新浏览器页面后，你会在顶部的控制按钮栏看到一个新的像游戏手柄 `🎮` 的按钮。

## 使用说明

1. 确保在系统上已经运行了。 [Intiface Central](https://intiface.com/central/)
2. 在 Intiface Central 中**启动服务器 (Start Server)**
3. 在 SillyTavern 中点击顶部图标 `🎮` 呼出面板。
4. 默认连接地址为 `ws://localhost:12345`，点击 **连接** 按钮。
5. 连接上之后，打开蓝牙玩具电源，点击 **扫描设备** 即可配对。
6. 进入设置（或者编辑角色卡），把 `prompt_injection.md` 中的自然语言控制指令复制在**作者注释 (Author's Note)** 或者 **系统提示** 中。

Enjoy interactions!
