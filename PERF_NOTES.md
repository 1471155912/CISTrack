# 参考站点性能实测：`findrassvet.ru` 为什么流畅

本文是对 <https://findrassvet.ru/>（Где «Рассветы»，Bureau 1440 的星座追踪页，也是本项目视觉与结构的参考源）
的实测分析，用于决定本项目要不要跟着改。

**最关键的结论**：它流畅的原因不是「用了什么高级优化技巧」，而是**每帧要做的事少得多**。
它的 CSS 里 **没有** `will-change`、`transform: translate3d`、`contain`、`backface-visibility` ——
一点合成层技巧都没用；真正的差别在**渲染架构**上。

---

## 一、实测到的 6 件事（都有代码或运行数据支撑）

### 1. 三张图不靠手绘，交给 Chart.js

它加载 `/vendor/chart.umd.min.js`，`app.js` 里只有 **1 处 `new Chart()`、1 处 `getContext()`**，
函数表里**没有 `drawMap` / `drawGlobe` / `drawChart`** 这类自绘函数，只有 `render()` 与 `buildDatasets()`。

创建图表时的关键选项：

```js
new Chart(ctx, {
  type: 'line',
  options: {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,      // 不做入场动画
    parsing: false,        // 跳过内部数据解析（数据已是内部格式）
    normalized: true,      // 声明数据已排序规整，省掉每次的检查
    interaction: { mode: '...' }   // 交互命中模式也限定
  }
})
```

`parsing: false` + `normalized: true` 是 Chart.js 处理大数据集的标准做法：
**只在数据变化时重画一次**，而不是每帧重走一遍解析。

### 2. 全站没有常驻帧循环

整个 `app.js`（64 KB）里 `requestAnimationFrame` 只出现 **2 次**，两处都在侧边导航：

```js
window.addEventListener('scroll', () => { sideNavShow(); requestAnimationFrame(sideNavProgress); }, { passive: true });
window.addEventListener('resize', () => requestAnimationFrame(sideNavProgress));
```

**没有 `loop()` / `tick()` 那种每帧跑的动画主循环** —— 页面不动的时候，浏览器几乎不做事。

### 3. 画布完全不用 `devicePixelRatio`

`app.js` 里 `devicePixelRatio` 出现 **0 次**。也就是说画布按 CSS 像素 1:1 渲染，
不做 HiDPI 采样。在 dpr=2 的屏幕上，它的画布像素量只有「按 dpr 渲染」的 **1/4**。

### 4. 重活全部懒加载，且串行下载

`index.html` 里的内联脚本：

```js
var srcs = ['/vendor/satellite.min.js', '/vendor/coast.js', '/live.js'];
(function next(i) {
  if (i >= srcs.length) return;
  var s = document.createElement('script');
  s.src = srcs[i];
  s.onload = function () { next(i + 1); };     // 串行：一个一个来
  document.head.appendChild(s);
})(0);

var target = document.getElementById('sec-map');
var io = new IntersectionObserver(function (entries) { if (...) start(); });
// 滚到地图章节才真正开始加载 SGP4 / 海岸线 / live.js
```

首屏因此很轻；SGP4 与海岸线只在用户**真的要看地图**时才下载，而且串行加载不会一次性造成长任务。

### 5. 实时更新是独立模块（`/live.js`），且不靠高帧率动画

它把「实时位置更新」单独拆成一个文件，配合 `setTimeout` / `setInterval` 低频推进，
而不是每帧插值。卫星点位置的变化频率远低于 60fps。

### 6. 毛玻璃用得很少

它的 CSS 里 `backdrop-filter` 只出现 **2 处**；`@keyframes` 与 `animation:` **各 0 处**。

---

## 二、逐条对照：本项目现状与可选措施

| # | 参考站做法 | 本项目现状 | 采用建议 | 预期效果 | 副作用 / 代价 |
|---|---|---|---|---|---|
| 1 | 图表交给 Chart.js，`animation:false` + `parsing:false` + `normalized:true` | 三张图全部手绘 canvas，每帧全量重画 | **不建议整体换** —— 手绘是本项目能画覆盖区、轨迹、地球自转、时间轴回放的基础，Chart.js 画不了这些。但**可以借鉴它的选项思路**：把每帧重复计算的量（覆盖区半角、颜色、批次分组）预计算缓存 | 中 | 改造集中在绘制函数内部，风险可控 |
| 2 | **没有常驻帧循环**，事件驱动重绘 | `loop()` 每帧跑，地球自转 + 卫星插值 | **建议**：① 自转默认关闭（改为「用户点开才转」）；② 即使转，也把帧率限制到 **30fps**（自转不需要 60） | **高** | 自转默认静止（可接受，甚至更省电）；30fps 下自转略微不如 60 顺 |
| 3 | **画布不用 DPR**（1x） | 桌面 1.5x、触屏 2x | **部分采用**：桌面已从 2 降到 1.5。再降到 **1.25** 可再省约 30% 像素，但线条会略软 —— 建议**先看 1.5 的实际观感**再决定 | 中高 | 文字/细线变糊，尤其高分屏 |
| 4 | 重活懒加载 + IntersectionObserver | 已内联全部代码（单文件目标），且用 IntersectionObserver 判断可见性 | **部分借鉴**：单文件不能拆分文件，但可以**延迟初始化**：首屏只初始化当前可见章节的画布，其余滚到再初始化（现在可能已有类似逻辑，可强化） | 中 | 首屏更快；首次滚动到新章节时有一次初始化小卡顿 |
| 5 | 实时更新独立、低频 | 每帧插值（60fps） | **建议**：把「卫星位置刷新」降到 **15–20Hz**（位置本来也不会肉眼可辨地变），只有用户拖动/缩放时才即时重绘 | 中高 | 卫星移动的连贯性略降（肉眼很难看出） |
| 6 | 毛玻璃只用 2 处 | 顶栏 + 时钟药丸 + 跳转药丸 + 弹窗遮罩等处 | **建议**：滚动时**临时摘掉毛玻璃**（`backdrop-filter` 在滚动时每帧都要重新模糊，是滚动卡顿的常见来源），停下 150ms 再恢复 | 中 | 滚动瞬间顶栏透明感略变 |
| 7 | （额外）`passive: true` 的滚动监听 | 部分监听未标 passive | **建议**：凡是只读不 `preventDefault` 的 `scroll`/`touch` 监听都加 `{passive:true}` | 低中 | 无 |
| 8 | （额外）动画帧内避免布局抖动 | `getBoundingClientRect()` 在绘制路径里被调用多次 | **建议**：把每帧要用的尺寸/矩形缓存起来，只在 resize 时更新 | 中 | 需注意 resize / 全屏切换时刷新缓存 |

---

## 二·补、本项目自己的 CPU 采样结果（1440×900）

用 CDP 采样器（`Profiler.start/stop`，0.2ms 采样间隔）跑了一遍「加载 + 连续滚动」：

| 项目 | 结果 |
|---|---|
| 总 CPU 时间 | 约 6.45 秒（其中 **91.9% 是 idle，6.2% 是浏览器内部**） |
| JS 热点 | `drawGlobe` 18ms、`getBoundingClientRect` 17ms、`stroke` 6ms、`measureText` 5ms |
| 滚动帧间隔 | 中位数 **17ms**、p90 18ms、p99 **19ms**、最大 19ms |
| 超过 33ms 的帧 | **0** |
| 长任务（>50ms） | **0** |

**结论：JS 与布局完全不是瓶颈** —— 滚动稳定 60fps、零长任务。

所以「电脑上卡」的来源几乎肯定在**渲染合成层**，而本轮实测里能确认的最大嫌疑是：

- 页面上有 **7 个元素带 `backdrop-filter`**，其中包括**固定定位、横跨整个视口宽度的顶栏**
  （`blur(20px) saturate(160%)`）。滚动时顶栏下方的内容每帧变化，浏览器就得**每帧重新采样并模糊一次**，
  这是桌面端滚动卡顿最经典的来源。
- 而 V1.4.1 为了「让毛玻璃真的透」，把 blur 从 8px 提到 **20px** 并加了 `saturate` ——
  这项开销比当初**高了一倍以上**，时间上也正好对得上用户开始反馈「变卡」的节点。
- 注意：**软件渲染环境（headless + disable-gpu）测不出这部分开销**，这也是上表看起来「完全不卡」的原因。

### 一行命令自己验证是不是它

在浏览器控制台执行，再滚一遍页面对比：

```js
document.querySelectorAll('*').forEach(el => { el.style.backdropFilter = 'none'; });
```

如果滚动立刻变顺，就确认是毛玻璃的问题。

## 三、如果只做三件事

按性价比排序，我建议：

1. **自转默认关 + 帧率上限 30fps**（措施 2）—— 改动小、立竿见影，是本项目「每帧都在重绘」这个根本差异的直接解法。
2. **卫星位置刷新降到 15–20Hz**（措施 5）—— 位置数据本来就不需要 60Hz。
3. **滚动时临时关闭毛玻璃**（措施 6）—— 专治「滚动时卡」。

措施 3（DPR 再降）留给观感决定；措施 1（换 Chart.js）不建议 —— 会丢掉本项目区别于参考站的核心能力。

---

*实测方式：直接抓取该站的 `index.html` / `app.js` / `style.css` 做静态分析，
并用真实浏览器加载确认 3 个 canvas（`#chart` / `#map` / `#globe`）与 5 个 section 的结构。*
