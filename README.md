# web-server

个人网页应用合集。纯静态、零依赖、开箱即用。

每个应用都是独立目录下的单文件 HTML，不依赖任何框架或构建工具。

## 应用列表

| 应用 | 说明 | 在线访问 |
|------|------|----------|
| [FLAC 歌单](flac/) | 无损歌单播放器，点击即播，歌单数据存于仓库 | [打开](https://hypodear.github.io/web-server/flac/) |

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
