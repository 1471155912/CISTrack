# CISTrack · 国网与千帆在轨追踪

一个**单文件、纯离线、零后端**的网页，用真实的公开轨道数据（NORAD 目录 / TLE）实时推算并可视化中国两个低轨互联网星座：

- **星网 / 国网（Guowang，CSCN）**
- **千帆星座（Qianfan / Thousand Sails，SpaceSail / G60）**

打开一个 HTML 文件即可，不需要服务器、不需要联网（联网时会自动拉取最新轨道要素）。

> 非官方项目。数据来自公开的 NORAD 空间目标目录与卫星百科，仅用于科普与观测参考，**不适用于轨道预报、工程或研究用途**。

![顶栏与简介](shots/v139_top.jpg)

## ✨ 它有什么

| 章节 | 内容 |
|---|---|
| **01 地图** | 每颗卫星此刻的星下点、对地可视覆盖区（最低仰角可调）、前后各半圈地面轨迹，支持固定地面观测点并高亮可见卫星 |
| **02 轨道** | 3D 地球：轨道倾角、可视区域、不同批次轨道面的分离一眼可见（高度按 2.4× 夸张显示以便区分壳层） |
| **03 轨道分布** | 横轴 = 轨道倾角，纵轴 = 半长轴 / 远地点 / 近地点；一张图看清星座分布在哪些轨道面 |
| **04 卫星表格** | 全量在轨卫星的轨道要素（批次/组、制造方、半长轴、近远地点、倾角、周期、在轨天数、RAAN、偏心率、历元），可排序、可搜索、可导出图片。制造方取自卫星百科词条，收成简称并可点击跳转 |
| **05 发射历史** | 逐次发射的批次 / 运载火箭 / 发射时间 / 发射地点 / 设计倾角，火箭与场地可跳转卫星百科，卫星名可跳转 satcat.com |

其它：中英双语、深浅主题、全屏、时间轴回放（±180 分钟）、图→表联动、PNG 导出（带模拟时间与免责声明的底栏）。

## 🌐 在线访问

仓库开启 GitHub Pages 后，托管地址为：**https://1471155912.github.io/CISTrack/**（根入口 `index.html` 会自动进入最新版主文件）。

## 🚀 快速开始

1. 下载 `CISTrack_v1.4.8.html`
2. 双击用浏览器打开（Chrome / Edge / Firefox / Safari 均可）

就这两步。首次打开会尝试联网拉取最新 TLE，失败则用内置快照，功能完全不受影响。

## 🔄 更新数据

**方式一：只改统计数字（最省事，不需要任何环境）**

页面顶部的词条计数（已发射 / 在轨 / 发射成功）支持被同目录下的 `wiki.json` 覆盖。
把这个 JSON 和 HTML 放在一起（例如一起传到 GitHub Pages），以后只要编辑 JSON 里的数字并保存，**所有访客刷新就能看到新统计**。

```json
{
  "asOf": "2026-09-30",
  "gw": { "launched": { "n": 248, "...": "..." }, "inOrbit": { "n": 244 }, "launches": "40/41" },
  "qf": { "launched": { "n": 262 }, "inOrbit": { "n": 262 }, "launches": "19/19" }
}
```

> 为什么不做成页面自动抓取？卫星百科的 WAF 对非浏览器请求返回 403，且响应不带 CORS 头，浏览器里拿不到。所以采用「托管一份 JSON」这个折中。

**方式二：完整重建（需要 Node.js 18+）**

```bash
node refresh.mjs        # 拉取最新 TLE（四路来源合并）与完整 NORAD 目录
node mkmaker.mjs        # 抓卫星百科词条的「研发机构」表（有缓存，--force 才重抓）
node mkdata.mjs         # 生成 build/satdata.json（按批次差分包）与 build/wiki.json
node build.mjs          # 组装成单文件 HTML + 复制 wiki.json 到同级目录
node smoke.mjs          # 逻辑冒烟测试（jsdom，无外部依赖）
node visual.mjs         # 可选：真浏览器布局与交互实测（需要本机 Edge + ws）
```

> `mkmaker.mjs` 需要过词条的 WAF 验证：脚本用真实浏览器打开，并轮询标题直到验证页自己过去
> （实测 20–35 秒）。结果缓存在 `data/makers.json`，日常重建不必重跑。

## 🧩 它是怎么构成的

```
template.html   # 版式与样式（含内联的 Audiowide 字体）
app.js          # 全部逻辑：SGP4 推算、绘制、交互、i18n
data/           # satellite.min.js（SGP4）、海岸线、TLE 快照、NORAD 目录
mkdata.mjs      # 数据构建：TLE 按批次差分打包 + 词条元数据
build.mjs       # 把上面几块注入 template → 单文件 HTML
```

几个值得一提的设计：

- **轨道计算全在浏览器里**：用 satellite-js 跑 SGP4（WGS-72），零 API 调用。
- **TLE 按批次差分**：同一次发射的卫星两行要素大半字符相同，因此按 COSPAR 前缀做字符级模板，`satdata.json` 因此小了约 44%。
- **多源 TLE 合并**：CelesTrak 的分组会漏掉早期试验星，所以再加「按名称前缀查询」与「按编号反查」，同一颗取历元最新的一份。
- **只拿 HTML 也能用**：联网刷新是可选增强，离线打开一切照常。

## 📊 数据来源

- [CelesTrak](https://celestrak.org/) —— NORAD 空间目标目录的公开轨道要素（TLE）
- [卫星百科](https://sat.huijiwiki.com/) —— 词条口径的发射/在轨统计、批次名称、运载火箭与发射场
- [Natural Earth](https://www.naturalearthdata.com/) —— 海岸线（公有领域）
- [satellite-js](https://github.com/shashwatak/satellite-js) —— MIT 许可的 SGP4 实现
- [Audiowide](https://fonts.google.com/specimen/Audiowide) —— SIL OFL 1.1，已以 base64 内嵌

## ⚠️ 免责声明

- 本项目**非官方**，与中国卫星网络集团有限公司、上海垣信卫星科技有限公司均无关联。
- 轨道推算基于公开 TLE，存在固有误差；界面上的位置是**模拟**结果，不代表实际情况。
- **地图仅为粗略的地球大陆海岸线轮廓示意图，不能准确代表实际投影情况。**
- 生成的图片与页面均不得用于任何形式的专业用途。

## ⚖️ 许可证

[MIT](LICENSE) —— 可自由使用、修改、分发（包括商用），保留版权与许可声明即可。

---

Made by [小橙子的宇宙Jackoraniverse](https://space.bilibili.com/455972735)，视觉风格参考 [Где «Рассветы»](https://findrassvet.ru/) by Bureau 1440。
