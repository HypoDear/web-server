# web-server

个人网页应用合集。纯静态、零依赖、开箱即用。

每个应用都是独立目录下的单文件 HTML，不依赖任何框架或构建工具。

## 应用列表

| 应用 | 说明 | 在线访问 |
|------|------|----------|
| [FLAC 歌单](flac/) | 无损歌单播放器，点击即播，歌单数据存于仓库 | [打开](https://hypodear.github.io/web-server/flac/) |
| [脚本合集](userscripts/) | 用户脚本列表，点开即装到 Userscripts | [打开](https://hypodear.github.io/web-server/userscripts/) |

## 用户脚本

`userscripts/` 目录下的 `.user.js` 会**自动**出现在[脚本合集](https://hypodear.github.io/web-server/userscripts/)页面，
无需改动任何 HTML —— 页面运行时读取目录清单并解析每个脚本的元数据。

新增脚本：把 `.user.js` 丢进 `userscripts/` 即可。建议带上 `@version` 与 `@updateURL`：

```javascript
// @version      1.0
// @updateURL    https://raw.githubusercontent.com/HypoDear/web-server/main/userscripts/xxx.user.js
// @downloadURL  https://raw.githubusercontent.com/HypoDear/web-server/main/userscripts/xxx.user.js
```

> `@updateURL` 指向 `.user.js` 本身即可（Userscripts 的实现会直接解析它的元数据块），
> 不必像官方文档所说额外维护一个 `.meta.js`。改完脚本记得**递增 `@version`**，否则不会被识别为新版本。

iOS 上安装：装好 Userscripts App → 设置里开启 Safari 扩展 → 打开脚本合集页 → 点「安装」→
点地址栏扩展图标确认。自动更新默认关闭，需在 App 设置里把 **Scripts Update Check Interval** 设为非 0。

## 在线地址

https://hypodear.github.io/web-server/

## 本地运行

部分应用需要读取同目录下的数据文件，建议起一个静态服务而非直接双击打开：

```bash
python3 -m http.server 8000
# 访问 http://localhost:8000
```

## 新增应用

1. 在根目录新建一个应用目录，放入 `index.html`
2. 在根目录 `index.html` 的卡片列表里追加一条入口
3. 在本文件的应用列表里追加一行
