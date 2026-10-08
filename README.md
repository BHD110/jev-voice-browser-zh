# Jev 中文语音浏览器

**说中文或输入中文，让 AI 操作浏览器。** 页面会显示 Jev 的判断、耗时和实际操作的浏览器画面。

https://github.com/user-attachments/assets/975da89d-2d3b-4df9-915d-28ee8664d9c4

[点击播放完整未剪辑演示](docs/demo-uncut.mp4) · [下载视频原片的轻压缩版](docs/demo-uncut.mp4)

> 本项目基于 [moritzkremb/jev-voice-browser](https://github.com/moritzkremb/jev-voice-browser) 二次开发，沿用原项目的 MIT 许可。主要改动是中文界面、中文语音识别与中文文字指令、浏览器画面预览，以及每位使用者自行输入 Jev API Key 的独立会话。Jev 的决策与页面操作仍分别由 TypeSafe SDK 和 Playwright 完成。

## 在线体验

[打开 Jev 中文语音浏览器](https://lcgf.xyz/jev-voice-cn/)

1. 在 [TypeSafe 控制台](https://console.typesafe.ai/keys) 获取自己的 Jev API Key，在页面输入。Key 通过当前页面的 WebSocket 连接交给服务端，只用于这个连接的 Jev 调用；刷新或断开后需要重新输入。请只在你信任的部署实例上输入 Key。
2. 在 Chrome 或 Edge 中点击「开启麦克风」，允许权限后说中文；也可以直接在输入框写中文指令并回车。
3. 右侧可以看到受控浏览器的画面。遇到有风险的操作，页面会要求确认。

例如：「打开维基百科」「搜索北京天气」「点击第一个结果」「向下滚动一页」「返回上一页」。语音识别默认选 `zh-CN`，也能切换英语。

## 如何运行

需要 Node.js 20+、npm 和 Playwright Chromium。官方 Jev API Key 由使用者在网页填写，**无需在 `.env`、命令行或源码里放 Key**。

### Windows

```powershell
git clone https://github.com/BHD110/jev-voice-browser-zh.git
cd jev-voice-browser-zh
npm ci
npx playwright install chromium
.\start-windows.ps1
```

然后打开 `http://127.0.0.1:8789/`。也可双击 `start-voice-browser.cmd`。默认端口 8789 是为了保留原版项目的 8787；需要换端口时使用 `node src/server.js --port 9000`。

### Linux / macOS

```bash
git clone https://github.com/BHD110/jev-voice-browser-zh.git
cd jev-voice-browser-zh
npm ci
npx playwright install chromium
node src/server.js --headless --port 8789
```

访问 `http://127.0.0.1:8789/`。Linux 缺少浏览器系统库时，按 Playwright 提示安装依赖。服务器部署应通过 HTTPS 反向代理访问，以便浏览器申请麦克风权限和使用加密的 WebSocket。

### 服务器部署

服务端以独立浏览器会话运行，访问者的页面和 Key 不混用。示例运行命令：

```bash
npm ci --omit=dev
npx playwright install chromium
node src/server.js --headless --host 127.0.0.1 --port 5024
```

将 `/jev-voice-cn/` 反向代理到 `http://127.0.0.1:5024/`，并转发 WebSocket 的 `Upgrade`、`Connection` 请求头。服务端不配置共享的 `TYPESAFE_API_KEY`。默认最多三个同时使用的浏览器会话，可设置 `VOICE_BROWSER_MAX_SESSIONS=1` 降低小内存服务器的负担；闲置 30 分钟会释放。公网会话阻止浏览器访问本机和内网地址。

可选环境变量见 [.env.example](.env.example)。不要将自己的 Key 写进公开仓库。当前服务端部署的应用源码与 WebP 图片包小于 2 MB；仓库另存放完整时长的演示视频，视频不参与服务端部署。

## 它如何工作

```text
中文语音（浏览器 Web Speech API）或中文文字
                    ↓
             当前页面元素快照
                    ↓
       Jev 一次并行回答多个决策问题
       意图、目标元素、是否完整、是否危险等
                    ↓
          置信度门槛和确认规则
                    ↓
       Playwright 操作独立 Chromium
                    ↓
         浏览器画面和决策结果回传
```

Jev 负责判断要做什么、选哪个页面元素；操作规则负责等待、澄清和危险操作确认；Playwright 执行点击、输入、滚动和导航。语音的中间识别结果也会送去判断，因此某些明确指令可以在说完前开始执行。**演示中的约 300 ms 是一次 Jev 决策的示例耗时，不是每次操作的保证值**；网络、语音识别、页面加载都会影响整体速度。

<details>
<summary>jev商业定制、技术场景交流欢迎联系，请注明来意</summary>

<p align="center"><img src="docs/wechat-qr.webp" alt="微信联系二维码" width="240"></p>

</details>

## 开发与验证

```bash
npm test
```

单元测试不调用 Jev API。真实 Jev 的效果依赖你的 Key、网页状态和网络环境。Chrome/Edge 的语音识别由浏览器提供，识别服务可能会处理音频；不想使用麦克风时可直接输入中文文字。

## 许可与来源

原项目：[moritzkremb/jev-voice-browser](https://github.com/moritzkremb/jev-voice-browser)。本仓库保留 [MIT License](LICENSE)，感谢原作者的 Jev 浏览器控制实现。

---

**jev商业定制、技术场景交流欢迎联系，请注明来意**

<img src="docs/wechat-qr.webp" alt="微信联系二维码" width="130">
