# Debug: Local Graph 注入后无法点击

## 问题描述

将 Local Graph 的 `.view-content` 注入到 Outline leaf 后，graph 无法响应鼠标点击（拖拽、缩放、节点点击均失效）。

## DOM 结构

注入后 `.minimalism-ui-injected-graph` 内部结构：

```
.view-content.minimalism-ui-injected-graph   (position: relative, padding-top: 30px)
  ├── div.minimalism-ui-graph-bg             (position: absolute, background: #e8edf2, pointer-events: none)
  ├── canvas  ← canvas-A，交互层             (position: absolute, z-index: auto, pointer-events: auto)
  └── iframe  ← 真正的渲染层                 (内含独立 html/body/canvas)
```

## 实测坐标（getBoundingClientRect）

| 元素       | top    | height  | 说明                        |
|----------|--------|---------|-----------------------------|
| container | 816.0  | 254.0   | 含 30px padding-top          |
| canvas-A  | 816.0  | 254.0   | 从容器顶部开始，覆盖全高        |
| iframe    | 846.0  | 224.0   | 从 30px 处开始，比 canvas 矮 30px |

**结论：canvas-A 与 iframe 存在 30px 的垂直错位。**

## canvas-A 的作用

canvas-A 是交互透明层，原理：
- 捕获用户鼠标事件（点击、拖拽、滚轮）
- 将事件坐标转换后转发给 iframe 内的 graph renderer
- iframe 负责实际渲染，canvas-A 负责交互代理

## 已确认的信息

| 项目 | 结果 |
|------|------|
| `iframe.contentWindow` 可访问 | ✅ |
| `canvas-A` pointer-events | auto（正常） |
| `canvas-A` position | absolute |
| `canvas-A` z-index | auto |
| 背景 div 是否导致点击失效 | ❌ 删除背景后依然无法点击 |
| `iframe.contentWindow.dispatchEvent(new Event('resize'))` | 返回 true，但 graph 不响应 |
| `graphLeaf.view.onResize()` | ✅ 可触发 graph 重绘 |

## 已尝试的修复

1. **canvas-A 向下偏移 30px**（`top: 30px !important; height: calc(100% - 30px) !important`）
   - 目的：让 canvas-A 与 iframe 坐标对齐
   - 结果：仍然无法点击

2. **z-index 调整**（canvas z-index:2, iframe z-index:1）
   - 目的：确保 canvas-A 在 iframe 上方
   - 结果：导致白屏（背景遮挡），且点击仍无效，已回滚

3. **向 iframe.contentWindow 派发 resize 事件**
   - 结果：返回 true，但无效果

## 核心假设（待验证）

1. **canvas-A 的坐标系是基于注入前的容器尺寸初始化的**，移动 DOM 后坐标系没有更新，导致事件坐标映射错误。

2. **canvas-A 向 iframe 转发事件的机制**可能不是通过 DOM 事件，而是通过共享内存或 Obsidian 内部通信，移动 DOM 后通信通道断裂。

3. canvas-A 本身通过 `postMessage` 或其他机制与 iframe 通信，iframe origin 或 context 在 DOM 移动后发生变化。

## 待验证的方向

- [ ] 检查 canvas-A 实际的 `width` / `height` attribute 与 iframe 的渲染尺寸是否一致
- [ ] 在 canvas-A 上监听 `mousedown` 事件，确认事件是否能到达 canvas-A
- [ ] 检查 iframe 是否监听了 `postMessage`，以及 canvas-A 是否在向 iframe 发送消息
- [ ] 考虑完全放弃注入 `.view-content` 的方式，改为只注入 iframe 本身
