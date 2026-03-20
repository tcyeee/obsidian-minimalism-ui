# TODO: 笔记页面的缓存功能

## 目标

在「极简导航栏」模式下，用户每次点击链接或文件时，后台保留最近访问过的 N 个页面（leaf），
切换回已访问页面无需重新加载，同时 back/forward 按钮的体验与单页浏览器一致。

---

## 已尝试的实现路径

### 路径 1：事件监听 + 被动淘汰（失败）

- 监听 `layout-change`，维护一个 LRU 队列，超出 N 个就关闭最旧的 leaf
- 监听 `file-open`，若目标文件已在某个 leaf 中，激活它并关闭重复的新 leaf
- **根本缺陷**：这套逻辑只能管理「已存在的多个 leaf」。
  正常导航（点击文件浏览器、点击笔记内链接）Obsidian 会在当前 leaf 原地替换文件，
  始终只有 1 个 leaf，缓存永远为空，功能完全无效。

### 路径 2：异步后台 leaf（失败）

- 在 `file-open` 事件中检测「同一 leaf 内发生了文件替换」
- 检测到后，异步创建一个新 leaf 并打开旧文件，再把焦点还给当前 leaf
- **问题**：
  - `getLeaf('tab')` 会短暂切换到新 leaf，导致内容区域闪烁
  - 异步时序复杂，`isBuildingCache` 守卫难以覆盖全部竞态情况

### 路径 3：拦截 `workspace.getLeaf`（失败）

- Monkey-patch `workspace.getLeaf(false)`：把所有「在当前 leaf 打开」的调用改为「新开 tab」
- 配合 LRU 淘汰（`tabLimitHandler`）和去重复用（`leafReuseHandler`）
- Back/Forward 拦截：patch 每个 leaf 的 `history.back()` / `history.forward()`，
  改为在跨 tab 导航历史栈（`navHistory` / `navFuture`）中移动
- **根本缺陷**：两个严重竞态问题：
  1. `tabLimitHandler` 同时监听 `layout-change` 和 `active-leaf-change`；
     `oldest.detach()` 会同步触发这两个事件，导致 handler 在 `while` 循环内重入，
     `leafQueue` 被意外修改，淘汰逻辑不可预测
  2. `leafReuseHandler` 监听 `file-open`，此时文件已渲染进新 tab；
     去重逻辑运行时 `tabLimitHandler` 已先将这个"重复 tab"加入 LRU，
     导致淘汰和去重相互干扰，且有明显内容闪烁

### 路径 4：`getLeaf` + 一次性 `openFile` 拦截器（当前方案）

- 在 `getLeaf` patch 中，对每个新建空 leaf 注入一次性 `openFile` 拦截器（`interceptLeafOpenFile`）
- 拦截器在文件**实际加载前**检查缓存：若已有相同文件的 leaf，立即激活它并丢弃空 leaf，零闪烁
- `tabLimitHandler` 改为仅监听 `active-leaf-change`（去掉 `layout-change`），
  并加 `isEvicting` 布尔守卫，防止 `detach()` 触发的事件引发重入
- **验证结果**：返回（back）功能正常；前进（forward）功能失效

#### ⚠️ 已知 BUG：前进功能失效

**根因**：`isNavJumping` 布尔守卫存在时序漏洞。

`navigateBack()` 中的代码：

```typescript
this.isNavJumping = true;
this.app.workspace.setActiveLeaf(prev, { focus: true });
this.isNavJumping = false;  // ← 同步立即重置
```

`setActiveLeaf` 触发 `active-leaf-change` 事件是**异步**的（Obsidian 内部将该事件推迟到下一个 microtask/frame 执行）。因此当 `navTrackHandler` 实际收到事件时，`isNavJumping` 已经是 `false`：

```typescript
navTrackHandler = (leaf) => {
    if (!leaf || this.isNavJumping) return;  // ← 此时 isNavJumping 已是 false，守卫失效
    this.navFuture = [];  // ← forward 历史被清空！
    this.navHistory.push(leaf);
};
```

结果：每次 back 导航后，`navFuture` 被清空，forward 无法找到目标。

**修复方案**：用 `navJumpTarget: WorkspaceLeaf | null` 替代 `isNavJumping` 布尔值。
在 `navigateBack/Forward` 中，将目标 leaf 赋给 `navJumpTarget`，
`navTrackHandler` 按引用比较而非依赖时序：

```typescript
// navigateBack 中
this.navJumpTarget = prev;
this.app.workspace.setActiveLeaf(prev, { focus: true });
// 不再需要 isNavJumping = false

// navTrackHandler 中
if (leaf === this.navJumpTarget) {
    this.navJumpTarget = null;
    return;  // 这是 back/forward 跳转，不清空 navFuture
}
this.navFuture = [];
```

- **状态**：已实现，待验证

#### ⚠️ 已知 BUG：前进快捷键无响应

**根因**：Obsidian 在执行 forward 命令前会先调用 `leaf.history.canGoForward()` 检查是否可前进。
每个 tab 只有单文件，内置 canGoForward() 永远返回 false，命令被拦截，
`navigateForward()` 根本不会被调用。

**修复**：在 `patchLeafHistory` 中同时 patch `canGoBack` 和 `canGoForward`，
让它们返回我们自己导航栈的状态（`navHistory.length >= 2` / `navFuture.length > 0`），
并在 `unpatchAllLeafHistories` 中一并恢复。

- **状态**：已实现，待验证

---

## ⚠️ 已知高风险 BUG

### 「极简导航栏」开关的破坏性行为

`applyTabLimit()` 在被调用时（插件加载 / 每次保存设置），会先执行 `removeTabLimitHandler()`，
其中包含 `this.leafQueue = []`，**清空了缓存队列**。

更严重的是旧版逻辑（路径 1 的初始实现）中，`tabLimitHandler` 的行为是：

```typescript
// 旧逻辑：强制只保留当前一个 tab，其余全部关闭
for (const leaf of rootLeaves) {
    if (leaf !== active) leaf.detach();
}
```

这意味着：**只要「极简导航栏」开关处于开启状态，每次 `layout-change` 触发，
就会把除当前 tab 以外的所有 tab 全部关闭**，缓存完全不可能积累。

当前版本已将此逻辑替换为 LRU 队列，但如果将来修改 `applyTabLimit()` 时
不注意，极容易回退到「只留一个 tab」的行为。

**建议**：任何修改 `tabLimitHandler` 的场景，都需确认逻辑是「淘汰最旧的超出部分」，
而非「只保留当前活跃 leaf」。
