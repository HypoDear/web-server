# flac · 歌单播放器

FLAC 无损歌单，点击即播。

## 文件

| 文件 | 作用 |
|---|---|
| `index.html` | 播放器，读取同目录歌单并播放 |
| `playlist.json` | 歌单数据，**只存曲目标识，不含播放链接** |

## 维护歌单

改歌单只需编辑 `playlist.json`，**不用动 `index.html`**。

```json
{
  "playlist": {
    "name": "我的歌单",
    "updatedAt": "2026-10-10",
    "source": "kuwo",
    "quality": "flac",
    "tracks": [
      {
        "id": "228908",
        "title": "晴天",
        "artist": "周杰伦",
        "duration": 269,
        "album": "叶惠美",
        "bitrate": 2000
      }
    ]
  }
}
```

### 字段说明

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | **是** | 曲目标识，播放时据此实时换取链接。**只有这个字段影响播放，改错就放不出声** |
| `title` | **是** | 列表主标题 |
| `artist` | 否 | 副标题第一段 |
| `album` | 否 | 副标题第二段 |
| `duration` | 否 | 秒数，仅用于列表显示 |
| `bitrate` | 否 | 仅作标注，不参与播放逻辑 |

增删歌曲就是在 `tracks` 数组里加减条目，**数组顺序即列表顺序**。整首曲目的最小可用写法：

```json
{ "id": "228908", "title": "晴天" }
```

## 增删改歌的标准流程

### 1. 找到曲目的 id

搜索接口（返回 JSONP，可直接用浏览器打开查看）：

```
https://search.kuwo.cn/r.s?all=<关键词>&ft=music&itemset=web_2013&client=kt&pcmp4=1&vipver=1&geo=c&pn=0&rn=30&rformat=json&encoding=utf8&callback=cb
```

从返回的 `abslist` 数组里逐条看：

| 字段 | 含义 |
|---|---|
| `MUSICRID` | `MUSIC_` 后面那串数字就是 `id` |
| `SONGNAME` | 曲名，`&nbsp;` 是空格，`&apos;` 是单引号 |
| `ARTIST` | 歌手 |
| `ALBUM` | 专辑 |
| `DURATION` | 时长（秒） |
| `FORMATS` | **必须含 `ALFLAC`**，否则这首没有无损源，加进去也放不出来 |

### 2. 校验这个 id 能否取到无损直链

```
https://mobi.kuwo.cn/mobi.s?f=web&source=kwplayercar_ar_6.0.0.9_B_jiakong_vh.apk&from=PC&type=convert_url_with_sign&br=2000kflac&rid=<id>&user=<任意随机串>
```

判定标准：`code` 为 `200` **且** `data.format` 里含 `flac`。

> `code` 为 200 但 `format` 是 `aac`/`mp3` 的情况很常见——说明这首没有真无损源。此时**不要**把它加进歌单，播放器会拒绝播放并提示取源失败。

### 3. 写进 playlist.json

按上面字段格式追加一条即可。

## 播放行为

- 不预加载、不预取下一首，点哪首才取哪首
- 播放链接实时换取，不做缓存、不写本地存储
- 暂停、切歌、播完、离开页面均立即释放缓冲
- 循环模式三档：顺序播完即止 / 列表循环 / 单曲循环，另有随机播放开关

## 注意

- `id` 与上游音乐平台曲库一一对应，同一首歌的原版 / 现场 / 伴奏版 id 各不相同
- 播放链接带时效签名，某次加载失败时重新点一次即可
- 若整页提示"歌单载入失败"，先检查 `playlist.json` 的 JSON 格式是否合法（常见问题：多写了一个逗号）
