# CISTrack · 星网与千帆在轨追踪

![version](https://img.shields.io/badge/version-1.9.0-ff6b6b?style=flat-square)
![license](https://img.shields.io/badge/license-MIT-4dabf7?style=flat-square)
![single file](https://img.shields.io/badge/single--file-offline-4dabf7?style=flat-square)
![星网](https://img.shields.io/badge/%E6%98%9F%E7%BD%91-CSCN-ff6b6b?style=flat-square)
![千帆](https://img.shields.io/badge/%E5%8D%83%E5%B8%86-G60-4dabf7?style=flat-square)

> **项目主页**：https://github.com/1471155912/CISTrack
> **固定在线地址**：https://1471155912.github.io/CISTrack/CISTrack.html （不带版本号，更新后不变）
> 顶栏左上角的 **CISTrack** 标志可直接点击跳转到项目主页。


一个**单文件、纯离线、零后端**的网页，用真实的公开轨道数据（NORAD 目录 / TLE）实时推算并可视化中国两个低轨互联网星座：

- **星网（国网 / GW / GuoWang / SatNet，代号 CSCN）** —— 中国卫星网络集团
- **千帆星座（千帆 / Qianfan / Thousand Sails / SpaceSail，G60）** —— 上海垣信卫星

打开一个 HTML 文件即可，不需要服务器、不需要联网（联网时会自动拉取最新轨道要素）。

> 非官方项目。数据来自公开的 NORAD 空间目标目录与卫星百科，仅用于科普与观测参考，**不适用于轨道预报、工程或研究用途**。

---

A **single-file, fully offline, zero-backend** web page that uses real public orbit data (the NORAD catalogue / TLEs) to compute and visualise, in real time, two Chinese low-Earth-orbit internet constellations:

- **GuoWang / SatNet (CSCN)** — China Satellite Network Group
- **Qianfan / Thousand Sails (SpaceSail, G60)** — Shanghai Yuanxin Satellite

Just open the HTML file — no server, no network needed (when online it fetches the latest orbital elements by itself).

> Unofficial project. Data comes from the public NORAD space-object catalogue and the satellite wiki; it is intended for outreach and observation reference only and **must not be used for orbit prediction, engineering, or research**.


![顶栏与简介](shots/v139_top.jpg)

## ✨ 它有什么

| 章节 | 内容 |
|---|---|
| **01 地图** | 每颗卫星此刻的星下点、对地可视覆盖区（最低仰角可调）、前后各半圈地面轨迹，支持固定地面观测点并高亮可见卫星 |
| **02 轨道** | 3D 地球：轨道倾角、可视区域、不同批次轨道面的分离一眼可见（高度按 2.4× 夸张显示以便区分壳层） |
| **03 倾角分布** | 横轴 = 轨道倾角，纵轴 = 半长轴 / 远地点 / 近地点；一张图看清星座分布在哪些轨道面 |
| **04 变轨情况** | 每颗卫星从入轨到工作轨道的**半长轴变化曲线**（自建历史轨道数据库驱动，选中批次/单星即画；已再入的卫星标红）。升轨速度 = ±2 天窗口最小二乘；纵轴 0~2000 km；支持半长轴/升轨速度两种口径、导出图片带升轨速度列、与全局选中双向联动 |
| **05 组网进度** | 两条累计曲线随时间（横轴按周、标注为对应日期）看星座建设节奏：**发射量** = 累计发射颗数（扣掉搭车星与同批 R/B），**在轨数量** = 已有 TLE 的颗数 |
| **06 卫星表格** | 全量在轨卫星的轨道要素（批次/组、制造方、**在轨状态**、半长轴、近远地点、倾角、周期、在轨天数、RAAN、偏心率、历元），可排序、可搜索、可导出图片。制造方取自卫星百科词条，收成简称并可点击跳转 |
| **07 发射历史** | 逐次发射的批次 / 运载火箭 / 发射时间 / 发射地点 / 设计倾角 / 任务结果，火箭与场地可跳转卫星百科，卫星名可跳转 satcat.com |

其它：中英双语、深浅主题、全屏（手机端自动横屏 + 常亮）、时间轴回放（±180 分钟，地图 / 轨道两章 × 星网 / 千帆四个组合各自独立，支持非线性平滑动画；实时态下「实时」按钮用**主题色填充并呼吸闪烁**、文字取主题前景色，被推离实时后转为**固定黄色状态灯**）、图→表联动、PNG 导出（带模拟时间与免责声明的底栏）。

## 🔎 搜索（V1.5.0 起）

四个搜索框（顶栏 / 表格 / 两张图的全屏小窗）互相同步，实时联想，支持：

| 搜什么 | 可以这样输 |
|---|---|
| **卫星名 / NORAD** | 中英文名、NORAD 编号；输入数字时按顺序联想：名称含该数字 → 批次号含该数字 → COSPAR 序号对应火箭发射的全部卫星 → NORAD 含该数字 |
| **运载火箭** | 中英文全称/简称/别名/拼音均可，如 `长征八号甲`、`长八甲`、`CZ-8A`、`CZ8A`、`LongMarch-8A`、`Changzheng8jia`；后接遥号可精确到某枚火箭：`长八甲Y10`、`长征八号甲遥十`、`CZ8AY10` |
| **发射设施** | 发射场、工位、发射船、海域，中英文与拼音均可，分隔符随意：`酒泉 LC-96A`、`酒泉，LC-96A`、`酒泉卫星发射中心96A`、`JSLC`、`Jiuquan`、`东方航天港`、`HOS`、`南海`、`South China Sea` |
| **制造商** | 中英文全称/简称/别名/拼音：`上海微小`、`微小卫星创新研究院`、`Microsat`、`Histarlink`；**支持同时搜多个制造商**：`Histarlink hangtianeryuan` = 同时有氦星光联与航天二院的卫星 |

- 结果按「接近度 → 新到旧」排序，卫星名后用括号标出命中的字段（关键词加粗，过长自动省略）
- 点击输入框但还没打字时，显示本次打开后**该星座最近 6 条**浏览记录（星网/千帆各自独立、中英共享，刷新即清空）
- 输入内容与选中的卫星在进出全屏、切语言、开关控件后都保留，不会丢



## 🚀 快速开始

1. 下载 `CISTrack_v1.9.0.html`（或 Release 里的同名附件；仓库内的 `index.html` 会自动跳到最新版）
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

**方式一之二：用脚本自动更新 `wiki.json`（零依赖，V1.7.0 二轮起）**

```bash
node scripts/fetch_wiki.mjs        # 起一个本机 Edge/Chrome 过 WAF → 解析统计 → 有变才写 wiki.json
```

- **零依赖**：只用 Node 自带能力（`child_process` + 内置 `fetch` + 内置 `WebSocket` 走 CDP），
  不再需要 `playwright`——所以在本机计划任务那种没有 `node_modules` 的环境里也能跑。
- 浏览器可执行文件自动在常见路径里找；也可以用环境变量 `CISTRACK_EDGE` 指定（兼容旧名 `EDGE_PATH`）。
- 数字没变化时**不写文件**（便于 `git` 判断是否要提交）。
- 抓不到（WAF 不过 / 解析失败）会以**非零退出码**结束，方便计划任务与 CI 标红。
- **隐私**：只访问 `sat.huijiwiki.com` 的两个公开词条页，用的是通用桌面 Chrome UA，
  不发送任何本机信息；产出只有一份公开统计数字。

> 如果用 Windows 计划任务自动运行这个脚本：任务里必须允许「用电池时启动」（`DisallowStartIfOnBatteries = false`），
> 否则笔记本一旦没插电，任务会被系统直接拒绝、静默不跑。

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

## 🔄 数据从哪来 · 怎么更新

**一句话结论**：轨道要素（TLE）由**访客自己的浏览器**在打开页面时现拉，所以在线访客看到的永远是最新；其余数据（卫星百科的统计与元数据、逐次发射的任务结果、海岸线、SGP4 实现）都在**构建时**抓取或打包进单文件。GitHub Pages 没有数据库，只能把仓库里的文件原样发出去，所以"网站数据更新"只有这两条路。

| 数据源 | 用来做什么 | 怎么更新 | 需要本地任务吗 |
|---|---|---|---|
| **CelesTrak / NORAD 轨道要素（TLE）** | 卫星此刻位置、地面覆盖、轨道形状 | **访客打开页面时在他自己浏览器里现拉**（多路查询 + 公共代理兜底 + 30 分钟会话缓存） | **不需要**（在线访客永远是最新） |
| **Space-Track GP 历史要素集** | **04 变轨情况**的半长轴爬升曲线（历史轨道数据库） | 构建时批量拉取（登录 + `gp_history` 查询，`format=tle`）注入 `data/history/`；`refresh.mjs` 日常追加当天要素；`mkdata.mjs` 采样打包成 `history/` 发布分片 | 本机任务（配额限制，不适合放 CI） |
| **卫星百科「星网 / 千帆星座」词条** | 页面顶部三个统计数字（已发射 / 在轨 / 发射成功） | 构建时抓一次打包；另可用计划任务定时运行 `scripts/fetch_wiki.mjs`（零依赖）自动抓取并提交 | 可选（只针对顶部数字） |
| **卫星百科「引导页:发射记录」年度页** | 发射历史章的「任务结果」列、05 组网进度的纵向口径 | 构建时运行 `scripts/fetch_launch_results.mjs` 抓取，写入 `wiki_launches.json` 后由 `mkdata.mjs` 合并 | 可选（建议与 TLE 任务一起跑） |
| **Natural Earth 海岸线** | 地图陆地轮廓 | 构建时下载并打包 | 不需要 |
| **satellite-js（SGP4）** | 从 TLE 推算位置 | 构建时打包 | 不需要 |

`data/ct_*.tle` 只是**离线兜底快照**，可以用 `refresh.mjs` 定期刷新。

**自动化（V1.8.0 起采用 A＋B 双轨）**

- **A · 本机计划任务**：`update_tle.bat` / `update_wiki.bat` 负责 `refresh → mkdata → build → build_release → git push`。
  - 每一步都查退出码，**失败自动重试最多 3 次**（间隔 90 s），全过程追加到 `logs/tle_refresh.log` / `logs/wiki_refresh.log`；
  - 两个任务**共用 `logs/git.lock` 互斥**（都在 00:00 与 12:00 触发），避免同时提交打架；锁超过 5 分钟视为陈旧并自动清除；
  - 推送前先 `git pull --rebase --autostash`（云端可能刚推过）；
  - 任务本身设了「错过就尽快补跑」，并把超时放宽到 TLE 2 h / 卫星百科 45 min，避免重试途中被硬杀。
- **B · TLE 链路搬上 GitHub Actions**（`.github/workflows/update-tle.yml`）：每 12 小时在云端跑一次
  TLE 刷新与重新打包（CelesTrak 不拦数据中心 IP）。**卫星百科那部分仍留在本机** —— 它要过
  Cloudflare 的 WAF，数据中心 IP 拿不到（`update-wiki.yml` 因此只保留手动触发）。
- 这样即使本机长时间关机，在线页面仍能拿到较新的 TLE；而词条统计与发射任务结果由本机补全。
- 访客打开页面时本来就会自己现拉最新 TLE，所以这两条链路保障的是**离线兜底快照**的新鲜度
  （最多旧半天），而不是在线访客所看到的。


## ⭐ 两个星座各自保存状态

切到另一个星座再切回来，**你在这个星座里选中的卫星、各章节的开关与倾角、观测点、时间进度、
地图/轨道的缩放与平移、表格页码都会原样还在**；两个星座互不干扰、也各自持久化。

## ✨ 非线性动效（V1.6.1 起）

- **切换星座**：反色块平滑滑动 + 页面内容水平顶出 + 顶栏主题色扫过 + 章节药丸边框先灭后亮，
  四者同时开始、同时结束（520ms）。
- **切换语言**：顶栏整体「向上收起 → 向下展开」，页面自下而上擦除后又长出，两者同步（620ms）。
- **切换明暗**：从右上角按钮扩散的圆形遮罩（560ms，与语言同款缓动）。
- **联想区**：展开与收起都是非线性过渡；点空白、再点输入框或失焦都会收起。
- **时间条**：点击 / 键盘跳转 / 「实时」归位按距离做 120–520ms 非线性补间（含章节「默认设置」把时间条补间回实时）；拖拽即时跟手（V1.7.3）。
- **开关与画布同步**（V1.8.0）：显示名称 / 显示轨道 / 可视锥 / 可见倾角四个开关切换瞬间，
  画布侧对应元素做 520ms 透明度补间，按钮底色同步过渡，同一时间常数起止。
- **配色模式插值**（V1.8.0）：在「按星座 / 按批次 / 按倾角」之间切换时，点的颜色逐帧插值过渡，
  而不是整块跳变。
- **观测点进出**（V1.8.0）：进入 / 退出观测点模式时，覆盖区与可见卫星做淡入淡出。
- **表格翻页**（V1.8.0）：切换页码时旧内容先「淡消失」、换页完成后再「淡出现」（260ms），
  而不是内容瞬间替换。
- 缓动："先慢后快" `cubic-bezier(.92,.02,.98,.46)`；"先快后慢" `cubic-bezier(.02,.72,.16,1)`。

## 📱 全屏与手势（V1.5.3）

- 手机进入全屏**自动横屏**（全屏生效后重试锁定，确保生效）；退出时先锁回竖屏并回到进入前的位置。
- 全屏顶部三件套（×、居中搜索框、右侧时间药丸）等高同线；搜索框在窄屏自动收窄，不与时间药丸相撞。


- **进入全屏**：手机上自动转为横屏；退出时先锁回竖屏，并回到进入全屏前的页面位置。
- **地图全屏**：保持 1325:620 比例、上下左右居中，宽高里哪一边先占满就先占满；滚轮/双指放大时
  内容按比例自然长进留空区域，直到填满（与手机相册看照片的手感一致）。
- **左上三键**：× 退出全屏、△ 展开/收起控件抽屉（部分章节有）、重置视图；右上为搜索框与时间药丸，
  同一水平线等高。
- **控件抽屉**：按内容自适应高度（不铺满屏幕），内部不再重复放搜索框。
  展开与收起都是 **520ms「先慢后快」的非线性滑动**（与星座切换同一套曲线），双向对称。
- **搜索框位置**：01 地图 / 02 轨道这两章，全屏搜索框固定在**视口顶部**、与 × 和时钟药丸同一行；
  03 倾角分布这一章的搜索框是**内联在顶部控件行里**（随控件一起换行）。
  两处行为不同是**有意设计**（第三章那一行本身控件就多，单独一行放搜索框会挤掉画布），不是 bug。
- **真全屏被系统拒绝**时（部分浏览器/系统策略），会退化为「页面内满屏」并给一次提示；
  此时内容仍然铺满视口，但手机状态栏/浏览器工具条可能保留一条。

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

## 🗄️ 历史轨道数据库（V1.9.0 起）

**04 变轨情况**章的曲线由一份自建的历史轨道数据库驱动。设计目标是：随两个星座从几千颗涨到**数万、数十万颗**仍然可用，且能作为开源项目的一部分直接托管在 GitHub 上。

**数据从哪来**：Space-Track.org 的 **GP 历史要素集**（`class/gp_history`）——18 SDS 对每颗卫星逐日重发的多组轨道要素。脚本用官方账号登录后批量查询（10 颗/请求、按年分窗、`format=tle`），解析 TLE 的历元与平均运动，按**布劳威尔模型**反算半长轴（与页面 / SGP4 同一口径），每颗星从它发射后的第一条要素开始存。**只存布劳威尔半长轴**——一种模型、一个值，不混口径。

**结构（两层）**：

| 层 | 位置 | 格式 | 谁写 / 谁读 |
|---|---|---|---|
| 源库 | `data/history/<批次>.json` | v1 三元组 `[norad, 毫秒历元, 半长轴]`，每天 ≤2 条 | `refresh.mjs` 每天追加（幂等，按 (norad, 历元) 去重） |
| 发布库 | `history/index-*.json` + `history/<批次>-<链接号>.json` | v2 紧凑编码：norad 只存一次、天数相对化（`t0` + 偏移数组）、半长轴定点数（`base`+`prec` 写入分片头，防两端失配） | `mkdata.mjs` 采样打包；页面**按需加载**（首屏只取索引，选中批次才取分片，LRU 缓存 24 片） |

页面加载有**三级降级**：外挂发布分片 → 内置 60 天精简兜底（离线打开也有图）→「暂无历史数据」。

**容量为什么扛得住数万颗**：核心认识是「卫星到工作轨道后每天存点是纯浪费」。采样策略为**变化驱动 + 分层 + 稳定期配额**——升轨期（日变化 ≥0.05 km）密采，稳定期每月 1~2 点且每星最多 24 点。实测单星 1 年 244 点、**20 年只有 39 点**，每星约 440 字节；**10 万颗 × 20 年 ≈ 42 MB**（朴素逐日方案要 2.26 GB，缩 54 倍）。单个分片上限 4 MB，浏览器加载无压力。

**日常维护**：不需要人工干预——

1. `refresh.mjs`（本机计划任务每 12 小时）拉最新 TLE 时顺手把当天要素追加进源库；
2. `mkdata.mjs`（构建时）把源库采样打包成发布分片，随 `build.mjs` 一起复制到产物目录；
3. 源库有容量治理兜底（每星 ≤3000 点、单库 24 MB），永不无限膨胀；
4. 新批次发射后自动出现在索引里，无需改代码。

## 📊 数据来源

- [CelesTrak](https://celestrak.org/) —— NORAD 空间目标目录的公开轨道要素（TLE）
- [Space-Track.org](https://www.space-track.org/) —— 18 SDS 的 GP 历史要素集（历史轨道数据库的来源）
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

本页面由 [小橙子的宇宙Jackoraniverse](https://space.bilibili.com/455972735) 使用 AI 工具生成，灵感与最初版本来自于跟踪俄罗斯**[「黎明」星座](https://sat.huijiwiki.com/wiki/%E9%BB%8E%E6%98%8E%E6%98%9F%E5%BA%A7)**（Rassvet）态势的网站**[findrassvet.ru](https://findrassvet.ru/)**。


## 仓库结构

```
CISTrack.html           ★ 最新版（不带版本号）—— 固定链接就用它：
                          https://1471155912.github.io/CISTrack/CISTrack.html
CISTrack_v1.9.0.html    当前版本快照（回滚 / 对照用）
CISTrack_v1.5.2 … v1.8.0.html
                        更早的历史快照（v1.5.2 / v1.5.3 / v1.6.3 / v1.7.0 /
                        v1.7.1 / v1.7.2 / v1.7.3 / v1.8.0，同样用于回滚与对照）
index.html              入口页（自动跳转到 CISTrack.html）
history/                历史轨道数据库发布分片（04 变轨情况的数据，按需加载；详见「历史轨道数据库」）
app.js / template.html  源码（单文件产物 = 这两者 + data/ 由 build.mjs 打包）
data/                   卫星数据（含制造商研发机构、离线兜底的 TLE 快照、历史轨道源库 data/history/）
wiki.json               卫星百科统计缓存（顶部「发射 / 在轨 / 发射次数」的来源；页面运行时读它）
wiki_launches.json      星网/千帆逐次发射的任务结果（发射历史「任务结果」列 + 05 组网进度口径）
scripts/fetch_wiki.mjs          抓取并更新 wiki.json（零依赖，详见「更新数据」）
scripts/fetch_launch_results.mjs 抓取卫星百科年度发射记录页 → wiki_launches.json（零依赖）
scripts/fetch_history.mjs       历史 TLE 批量拉取（灌库 / 补数用，日常维护不需要；详见「历史轨道数据库」）
scripts/histstore.mjs           历史源库读写与容量治理（mergeInto / pruneRecords）
scripts/histpack.mjs            历史发布分片打包（v2 编码 + 变化驱动采样）
smoke.mjs / visual.mjs  测试：逻辑与源码断言 / 真实浏览器布局实测
i18n.mjs                中英文案审计（静态四查 + 运行时四遍）
build.mjs / mk*.mjs     构建脚本（把源码打包成单文件 HTML）
release.mjs             路径无关的产物同步（CISTrack.html + CISTrack_v<版本>.html + package.json 版本）
.github/workflows/      云端自动化：update-tle.yml 每 12 小时刷新 TLE 并重新打包
```

> **不进仓库的文件**（见 `.gitignore`）：`PROCESS.md` 与逐轮的「任务清单 / 验收检查清单」属内部过程
> 文档（含本机路径与工作笔记）；`archive/` 是本地版本快照；`build/`、`data/satcat.csv`、
> `data/wiki_cache/` 属可再生的中间产物；`junk/` 是一次性产物暂存区。

> **关于链接**：GitHub Pages 的地址规则是 `https://<用户名>.github.io/<仓库>/<文件名>`，
> 所以只要仓库里有一份 **`CISTrack.html`**，链接就永远是
> `https://1471155912.github.io/CISTrack/CISTrack.html` —— **以后更新版本，这个链接不用变**。
> 带版本号的 `CISTrack_vX.Y.Z.html` 只是历史快照，用于回滚与对照。

> 构建与测试脚本（`build.mjs` / `mk*.mjs` / `smoke.mjs` / `visual.mjs` / `scripts/*.mjs`）
> **随仓库一起维护**，方便任何人本地重建与复测；运行测试需要 `jsdom` 与 `ws`
> （`npm i -D jsdom ws`）。构建本身只需要 Node 与 `data/`。
