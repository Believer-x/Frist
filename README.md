# 字幕桥 · Subtitle Bridge

Chrome / Edge Manifest V3 视频字幕翻译扩展。自动读取网页已有字幕，默认翻译成简体中文，以悬浮双语字幕显示。无需构建、无需后端即可加载扩展。

## 安装

1. 下载或克隆本仓库。
2. 打开 Chrome 的 `chrome://extensions`（Edge 为 `edge://extensions`）。
3. 开启「开发者模式」，点击「加载已解压的扩展程序」，选择仓库的 **extension** 文件夹。
4. 刷新已打开的视频页面，在播放器中开启字幕，再播放视频。
5. 点击工具栏的「字幕桥」，选择目标语言、双语模式和翻译服务，保存并应用。开关即时生效。

发布包 `subtitle-bridge.zip` 包含可直接加载的扩展文件；先解压，再选择解压目录。未发布到扩展商店。

## 功能与适配范围

- 标准 HTML5 `TextTrack` 字幕；可读取隐藏的字幕轨道，无选中轨道时尝试激活第一条字幕轨道。
- 已加入 YouTube、B站、Netflix、Prime Video、Shaka Player、Video.js、DPlayer 的网页字幕选择器。**这些属于尽力适配，尚未逐站实测**，网站改版、地区、账号或播放器版本可能使其失效。
- 自动检测原语言，8 种目标语言；原文 / 双语开关，网页全屏字幕布局。
- 内存缓存（最多 500 条）、相同请求合并、并发上限、请求超时，以及旧字幕响应丢弃，避免字幕过期后重新显示。
- 同一页面多个视频优先选取可见且正在播放的视频；支持 iframe 内的视频。

这里的「自动翻译」是读取现有字幕，不包括音频语音识别、OCR 硬字幕识别。无字幕视频、canvas 内绘制的字幕、封闭 Shadow DOM 内播放器、浏览器画中画和浏览器内部页面不支持。部分网站必须手动开启原字幕。iframe 未获得网站访问权限时也可能无法工作。

## 翻译服务与隐私

默认使用 Google 公共翻译接口 `translate.googleapis.com`：不需要密钥，但这是非正式接口，不保证稳定性或可用性，可能受到地区限制和限流。**当前云环境访问该域名被网络代理返回 403，尚未验证真实 Google 翻译请求。** 本地替代服务的完整翻译链路另行测试。

开启翻译后，识别到的字幕文本、原语言和目标语言会发往所选服务。插件不录制音视频，不发送网页地址，不保存字幕历史。设置与可选 API Key 存于本机扩展 `storage.local`，没有使用云同步；不是加密密钥库。内存翻译缓存随后台进程退出而清空。

如需自建服务，在插件设置中选择 **LibreTranslate / 自建服务**，填写 HTTPS 服务根地址或 `/translate` 地址，再保存。浏览器将询问该服务域名的访问权限。只支持 LibreTranslate 的 POST JSON 协议，不是通用 OpenAI 接口。可选 API Key 放在 POST 请求体；不会跟随重定向发到其他主机。开发时允许 `http://localhost:端口` 和 `http://127.0.0.1:端口`。

扩展读取各网站的视频字幕，因此声明了全站内容脚本权限；额外翻译服务的跨域权限按需申请。没有分析、广告或统计代码。关闭开关后停止字幕读取和新的翻译请求；已发出的网络请求可能仍完成。

## 开发与验证

运行时不依赖 npm 包。Node.js 20+ 可运行单元测试：

```sh
npm test
npm run check
```

浏览器集成测试使用 Playwright、本机 Chromium、FFmpeg（生成短视频）和临时 HTTP 翻译服务，不调用外部服务。它直接执行真实内容脚本、设置页面和后台代码，但模拟 Chrome 扩展 API：

```sh
npm ci --cache /tmp/subtitle-bridge-npm-cache
ffmpeg -hide_banner -loglevel error -f lavfi -i color=c=black:s=640x360:d=20 -an -c:v libvpx -b:v 60k /tmp/subtitle-bridge-fixture.webm -y
CHROMIUM_PATH=/usr/lib/chromium/chromium VIDEO_FIXTURE=/tmp/subtitle-bridge-fixture.webm node tests/browser.mjs
```

`CHROMIUM_PATH` 可改为本机 Chromium 可执行文件；使用支持加载扩展的 Chromium。`tests/browser.mjs` 验证标准字幕轨道、本地翻译、实际双语渲染、缓存、旧字幕响应丢弃、设置开关和持久化。

完整 MV3 扩展测试单独保留在 `tests/extension.mjs`，在允许未打包扩展的机器上运行：

```sh
CHROMIUM_PATH=/path/to/chromium VIDEO_FIXTURE=/tmp/subtitle-bridge-fixture.webm node tests/extension.mjs
```

当前云环境管理员策略禁止加载未打包扩展，因此完整扩展加载与真实域名权限申请未通过验证；备用 Chromium 下载也被网络策略阻止。上述浏览器集成测试不能替代真实扩展安装和各视频网站实测。

源码：`extension/manifest.json` 扩展入口，`content.js` 字幕读取与渲染，`background.js` 后台请求与缓存，`translation.js` 翻译协议，`popup.*` 设置界面。
