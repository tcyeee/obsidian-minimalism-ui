# TODO

## 左侧边栏布局：OUTLINE 上 + PROPERTIES 下

### 目标

开启「极简侧边栏」后，左侧边栏仅显示两个面板：

- **OUTLINE**（大纲）在上方，占据剩余空间
- **PROPERTIES**（文件属性）在下方，高度随其中 items 数量动态变化（不固定高度）

两者同时可见，不是 Tab 切换关系。

---

### 已知信息

1. PROPERTIES窗口的div,其中的`view-content`是真正显示内容,其他层级可能在Obsidian用于其他目的,比如用户手动调整高度之类

2. class='workspace-tabs'的div后面有 style=""

```html
<div class="workspace-tabs" style="flex-grow: 31.9575;"><hr class="workspace-leaf-resize-handle"><div class="workspace-tab-header-container"><div class="workspace-tab-header-container-inner" style="--animation-dur: 250ms;"><div class="workspace-tab-header tappable is-active" draggable="true" aria-label="File properties for README" data-tooltip-delay="300" data-type="file-properties" style=""><div class="workspace-tab-header-inner"><div class="workspace-tab-header-inner-icon"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-info"><circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path></svg></div><div class="workspace-tab-header-inner-title">File properties for README</div><div class="workspace-tab-header-status-container"></div><div class="workspace-tab-header-inner-close-button" aria-label="Close"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-x"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg></div></div></div></div><div class="workspace-tab-header-new-tab"><span class="clickable-icon" aria-label="New tab"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-plus"><path d="M5 12h14"></path><path d="M12 5v14"></path></svg></span></div><div class="workspace-tab-header-spacer"></div><div class="workspace-tab-header-tab-list"><span class="clickable-icon"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-chevron-down"><path d="m6 9 6 6 6-6"></path></svg></span></div></div><div class="workspace-tab-container"><div class="workspace-leaf"><hr class="workspace-leaf-resize-handle"><div class="workspace-leaf-content" data-type="file-properties"><div class="view-header"><div class="view-header-left"><div class="view-header-nav-buttons"><button class="clickable-icon" aria-disabled="true" aria-label="Navigate back"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-arrow-left"><path d="m12 19-7-7 7-7"></path><path d="M19 12H5"></path></svg></button><button class="clickable-icon" aria-disabled="true" aria-label="Navigate forward"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-arrow-right"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg></button></div></div><div class="view-header-title-container mod-at-start mod-fade mod-at-end"><div class="view-header-title-parent"></div><div class="view-header-title">File properties for README</div></div><div class="view-actions"><button class="clickable-icon view-action" aria-label="More options"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-more-vertical"><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="19" r="1"></circle></svg></button></div></div><div class="view-content"><div class="metadata-container" tabindex="-1" data-property-count="2" style=""><div class="metadata-error-container" style="display: none;"></div><div class="metadata-properties-heading" tabindex="0"><div class="collapse-indicator collapse-icon"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon right-triangle"><path d="M3 8L12 17L21 8"></path></svg></div><div class="metadata-properties-title">Properties</div></div><div class="metadata-content"><div class="metadata-properties"><div class="metadata-property" tabindex="0" data-property-key="aliases"><div class="metadata-property-key"><span class="metadata-property-icon" aria-disabled="false"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-forward"><path d="m15 17 5-5-5-5"></path><path d="M4 18v-2a4 4 0 0 1 4-4h12"></path></svg></span><input class="metadata-property-key-input" autocapitalize="none" enterkeyhint="next" type="text" aria-label="aliases"></div><div class="metadata-property-value" data-property-type="aliases"><div class="multi-select-container" tabindex="-1"><div class="multi-select-pill" tabindex="0"><div class="multi-select-pill-content">README</div><div class="multi-select-pill-remove-button"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-x"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg></div></div><div class="multi-select-input" contenteditable="true" tabindex="0" placeholder=""></div></div></div><div class="clickable-icon metadata-property-warning-icon" aria-label="Type mismatch, expected Aliases" style="display: none;"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-alert-triangle"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path></svg></div></div><div class="metadata-property" tabindex="0" data-property-key="describe"><div class="metadata-property-key"><span class="metadata-property-icon" aria-disabled="false"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-text"><path d="M21 5H3"></path><path d="M15 12H3"></path><path d="M17 19H3"></path></svg></span><input class="metadata-property-key-input" autocapitalize="none" enterkeyhint="next" type="text" aria-label="describe"></div><div class="metadata-property-value" data-property-type="text"><div class="metadata-input-longtext" placeholder="Empty" contenteditable="true" spellcheck="true" tabindex="0">Obsidian 的门户</div></div><div class="clickable-icon metadata-property-warning-icon" aria-label="Type mismatch, expected Text" style="display: none;"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-alert-triangle"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path></svg></div></div></div><div class="metadata-add-button text-icon-button" tabindex="0"><span class="text-button-icon"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-plus"><path d="M5 12h14"></path><path d="M12 5v14"></path></svg></span><span class="text-button-label">Add property</span></div></div></div><div class="pane-empty" style="display: none;">No properties found.</div></div></div></div></div></div>
```


### 实现历程与踩坑记录

#### 尝试一：直接 DOM 移动（当前代码）

思路：
1. `clearLeftSidebar()` 清空左侧边栏
2. `getLeftLeaf(false)` 创建 Outline leaf
3. `getLeftLeaf(true)` 创建 Properties leaf（`true` = 新建 split）
4. 等待 50ms，用 `document.querySelector` 找到 Properties 的 `.workspace-leaf`，`appendChild` 到 Outline 的 `.workspace-tab-container`，设置 `flex / column / space-between`

**坑 1**：Properties 面板默认不是 WorkspaceLeaf
Properties 默认以 inline 形式嵌在编辑器顶部，不是独立的侧边栏 leaf。`document.querySelector('[data-type="file-properties"]')` 返回 null，因为它根本不在 DOM 里。
→ 解决：改用 `setViewState({ type: 'file-properties' })` 主动创建。

**坑 2**：`clearLeftSidebar()` 会把 Properties leaf 一起清掉
如果 Properties 之前在左侧边栏，`clearLeftSidebar()` 会 detach 掉它，之后 querySelector 找不到。
→ 暂时绕过：每次 apply 时重新创建。

**坑 3**：`getLeftLeaf(true)` 会创建新的 workspace-tabs split
`getLeftLeaf(true)` 的语义是「新建一个 split」，导致左侧边栏出现两个 `workspace-tabs` 容器：
- 上方：包含 Outline（Properties 被 DOM 移入后也在这里）
- 下方：空的 workspace-tabs 外框，占据了侧边栏下半部分

Properties leaf 的 DOM 被移走，但它原来所在的 `workspace-tabs` 容器还留着，造成下半部分空白。

**当前状态**：卡在坑 3，尚未解决。

---

### 尝试二：getLeftLeaf(false) × 2，不移动 DOM（当前代码）

思路：
1. `clearLeftSidebar()` 清空左侧边栏
2. `getLeftLeaf(false)` 创建 Outline leaf
3. **再次** `getLeftLeaf(false)` 创建 Properties leaf
   - `false` 语义：「加入已有的 workspace-tabs 组，不新建 split」
   - 两次调用预期落在同一个 `workspace-tab-container`，无需 DOM 移动
4. 等待 50ms，对该 container 应用：
   - `display: flex / flex-direction: column`
   - Outline：`flex: 1 1 0`（拉伸填满剩余空间）
   - Properties：`flex: 0 0 auto`（自然高度，随 items 动态变化）
5. 若两个 leaf 意外落在不同 container，仍兜底 `appendChild` 移入

**结论（坑 4）**：`getLeftLeaf(false)` 第二次调用返回的是**同一个 leaf**（Obsidian 复用 active leaf），导致 `setViewState({ type: 'file-properties' })` 覆盖不成功，或者即使成功也只有一个 leaf 在 DOM 里。用户只看到 OUTLINE，Properties 根本不存在于 DOM 中（querySelector 返回 null）。

---

### 尝试三：getLeftLeaf(true) 强制新建 + 清理空容器 + CSS 强制双显（当前代码）

思路：
1. `getLeftLeaf(false)` 创建 Outline leaf
2. `getLeftLeaf(true)` 强制创建一个新的 leaf（会落在新的 workspace-tabs split 里）
3. 等待 50ms 后 `mergePropertiesIntoOutlineContainer()`：
   - 把 Properties leaf `appendChild` 到 Outline 的 `workspace-tab-container` 里
   - 找到遗留的空 `workspace-tab-container`，将其父级 `workspace-tabs` 设为 `display: none`（清理空壳）
   - 设置 Outline `flex: 1 1 0`，Properties `flex: 0 0 auto`
4. CSS 层 (`styles.css`) 用 `:has()` 强制两个 leaf 同时可见，覆盖 Obsidian tab 系统对 inactive leaf 的隐藏

**待验证**：`getLeftLeaf(true)` 创建的 Properties leaf 是否能被 `querySelector('[data-type="file-properties"]')` 找到。

---

### 尝试四：两次 getLeftLeaf + 纯 CSS（当前代码）

**核心洞察**：前三次尝试的根本错误是——明明 `getLeftLeaf(true)` 已经把两个 workspace-tabs 竖向排好了，却还要手动移动 DOM，反而造成了空壳问题。

思路：
1. `clearLeftSidebar()` 清空左侧边栏
2. `getLeftLeaf(false)` → `setViewState({ type: 'outline' })` → 落入第一个 workspace-tabs（上方）
3. `getLeftLeaf(true)` → `setViewState({ type: 'file-properties' })` → 落入第二个 workspace-tabs（下方）
   - Obsidian 已自动将两个 workspace-tabs 竖向排列，不需要任何 DOM 移动
   - 每个 workspace-tabs 里只有一个 leaf，始终处于 active 状态，无需强制显示
4. 纯 CSS 控制高度分配：
   - `.workspace-tabs:has([data-type="outline"])` → `flex: 1 1 0`（撑满剩余空间）
   - `.workspace-tabs:has([data-type="file-properties"])` → `flex: 0 0 auto`（随内容高度）

**TS 改动**（`SidebarLayoutManager.ts`）：仅新增 4 行，创建 propsLeaf 并 setViewState。

**CSS 改动**（`styles.css`）：删除旧的 `.minimalism-ui-props-outline-container`，改为两条 `:has()` 规则。

**验证结果（坑 5）**：`active: false` 导致 file-properties 无法初始化。

`file-properties` 视图需要绑定当前激活文件才能初始化内容。`active: false` 使视图无法完成初始化，Obsidian 随后自动清理了空 leaf，第二个 workspace-tabs 消失。结果：只剩 Outline，Properties 根本不在 DOM 里。

→ 修复：将 Properties leaf 的 `setViewState` 改为 `active: true`。

**已知信息（来自 Properties DOM 结构）**：
- Properties `workspace-tabs` 有 Obsidian 注入的 inline style `flex-grow: 31.9575`
- 我们的 CSS `flex: 0 0 auto !important` 因为有 `!important`，会正确覆盖这个 inline style
- Properties 视图 data-type 确认为 `"file-properties"`

**尝试四最终结论**：即使 `active: true`，仍无法稳定显示 Properties（同坑 5 本质相同）。

---

### 尝试五：注入 .metadata-content DOM 节点（当前代码）

**核心洞察**：之前所有尝试都在和 Obsidian 的 workspace 层面打架（leaf、split、workspace-tabs）。
实际上 `.metadata-content` 只是一个纯展示 div，Obsidian 的 workspace 系统根本不追踪它。
只需要把这个 div 移到 Outline leaf 内部，用 CSS flex 控制上下布局即可。

思路：
1. `getLeftLeaf(false)` → outline（上方）
2. `getLeftLeaf(true)` → file-properties（下方），`active: true` 确保初始化
3. 等待 100ms，等 Obsidian 渲染完成
4. 从 Properties leaf 中提取 `.metadata-container > .metadata-content`（避免匹配嵌套的同名节点）
5. `appendChild` 到 Outline 的 `.workspace-leaf-content[data-type="outline"]` 内部
   - 注入后，`.metadata-content` 成为 flex 列中 `.view-content` 的兄弟节点
6. 将空的 Properties workspace-tabs shell `display: none`
7. CSS：
   - `.workspace-leaf-content[data-type="outline"]` → `display: flex; flex-direction: column`
   - `.view-content`（outline 树）→ `flex: 1 1 0; overflow-y: auto`（独立滚动）
   - `.metadata-content`（注入的 properties）→ `flex: 0 0 auto`（随内容高度）

**为什么 .metadata-content 移动后仍会响应文件切换**：
Obsidian 的 Properties 视图 JS 持有对该 DOM 节点的直接引用，不依赖节点在 DOM 树中的位置。
移动节点不会断开这个引用，切换文件时内容依然更新。

**验证结果：✅ 成功**

- `.metadata-container > .metadata-content` 选择器准确定位到目标节点
- 注入后 flex 布局正确：Outline 撑满上方，Properties 固定在底部，独立滚动
- 切换笔记后 Properties 内容实时更新（Obsidian JS 持有节点引用，不受位置影响）

**最终方案总结**：
不要与框架的组件生命周期对抗。找到最内层的纯展示节点，直接移动它，让框架的
响应式逻辑继续在后台工作。CSS flex 处理布局，框架感知不到节点已被移走。
