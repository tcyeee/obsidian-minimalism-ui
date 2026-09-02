# 左侧栏架构重写：DOM 注入 → 原生 split

> 状态：**规划中，未动工**
> 创建：2026-09-01
> 目标分支：`feature/sydney` → PR base `main`

## 0. 决策

把左侧栏从当前的「DOM 注入」架构（`SidebarLayoutManager` 把 `.metadata-content`、
localgraph 的 `containerEl` 搬进 outline leaf）**整体改为 Obsidian 原生 split（stacked leaves）**。

**为什么**：目标形态是「最多 4 个可配置面板：任意已注册 view + 拖拽排序 + 手动调高」。
DOM 注入方式要自己接管尺寸测量 / 虚拟滚动触发 / 生命周期 / 还原，这些 hack
（`notifyResize` 假宽度、deferred 手动物化、`restoreMounted` try/catch 兜底、
关系图近零保护）是架构的结构性成本，且随「支持多少种任意 view」线性增长。
原生 split 免费拿到 resize handle、正确的尺寸测量、deferred 加载、view 生命周期、多窗口。

**代价（可控）**：原生 split 有两个布局事实源 —— Obsidian 自己在 workspace.json 存侧栏结构，
插件又要从 settings 控制。解法是启动 / 设置变更时 diff `leftSidebarSlots` 与实际 split 再 reconcile，
加一个类似 `SingleTabGroupGuard` 的守卫把用户误拖回弹。

**旁证**：`styles.css:87-97` 现存 CSS 已在隐藏左侧栏嵌套 split 之间的 `.workspace-leaf-resize-handle`
—— 侧栏历史上就是 split 结构，本次是「回到 split，但让 resize handle 可见可用」。

**关系图特例**：关系图 slot 只参与开关 + 排序，那一段 **phase 1 不可手动拖**，
保持现有 4:3 ResizeObserver 自动高度逻辑；无论哪种架构它都是单独一条路径。

---

## 1. 当前架构盘点（改造前必须读）

### 直接相关（要重写 / 大改）

| 文件 | 行数 | 现在做什么 | 改造后 |
|---|---|---|---|
| `src/layout/SidebarLayoutManager.ts` | 497 | DOM 注入：建 outline host leaf；抽 `.metadata-container > .metadata-content` 内层 div 注入；搬整个 localgraph `.workspace-leaf-content`；并发守卫（`applyRun`/`rerunRequested`）；`clearLeftSidebar` 三策略清空；关系图 4:3 `ResizeObserver` + `onResize` monkey-patch + `testCSS` 颜色重探 | **重写**为 `LeftSidebarManager`：按 `leftSidebarSlots` 构造 / reconcile 原生纵向 split；不再搬 DOM |
| `src/core/settings.ts` | — | `showProperties` / `showLocalGraph` / `showVaultProfile` / `propertyKeyWidth` 布尔 + 数值 | 新增 `leftSidebarSlots: SlotConfig[]`；`loadSettings` 迁移旧布尔 |
| `src/SettingTab.ts` | `configureShowProperties` / `configureShowLocalGraph`（167-186 附近）、`display()` 271-272 | 两个开关 toggle，改后调 `applyMacSidebarLayout()` | 换成「可拖拽排序的 ≤4 slot 列表」：每行 = 开关 + view 下拉（名字用 `leaf.getDisplayText()`，不自维护映射） + 拖拽手柄 + 「添加 slot」按钮 |
| `styles.css` | 66-97, 259-296, 344-520 | 大量 `body.minimalism-ui-mac-sidebar .workspace-leaf-content[data-type="outline"] ...` 假设 outline 是 host；87-97 隐藏嵌套 split resize handle；`.metadata-content` / `.minimalism-ui-injected-graph` / `.minimalism-ui-graph-header` 注入专属样式 | 重写为按 slot 通用的 `.workspace-split.mod-left-split .workspace-leaf` 规则；**让 resize handle 显示**（删/改 87-92）；section 标题改用原生 `.view-header` 或每个 leaf 的 tab-header |
| `src/right-sidebar/RightSidebarViewStack.ts` | 523 | `MANAGED_LEFT_VIEW_TYPES = {outline, localgraph, file-properties}` 硬编码避让左侧栏；`collectSwitchableLeaves` 用它过滤；`allRegisteredToolViewTypes` 也用它 | 改成向 `LeftSidebarManager` 动态查询「当前占用的 view type」——两模块单一事实源 |

### 可复用（抽共享服务）

`RightSidebarViewStack` 里这些是 view-type 无关的通用能力，抽成 `src/core/LeafMountService.ts`（或类似），
右侧栏改成消费方：

- `allRegisteredToolViewTypes()` —— 读 `app.viewRegistry.viewByType`，排除 `DOCUMENT_VIEW_TYPES`
- `ensureAllToolViewsExist()` / find-or-create leaf —— 为没有 leaf 的 view type 静默建 leaf（共享 tab 组、逐个 try/catch）
- `materializeDeferredLeaves()` —— deferred leaf 物化 + 竞态守卫
- `notifyResize(leaf)` —— 虚拟滚动视图（文件树 / 搜索 / 标签 / 反链）的宽度骗术
- `DOCUMENT_VIEW_TYPES` 常量

> 注意：原生 split 方案下，左侧栏本身**不需要** `showLeaf` / `restoreMounted` 那套 containerEl 搬迁
> ——那是注入方案专属。右侧栏悬浮窗仍然需要（它本质是 overlay），所以共享服务只抽「枚举 / 建 leaf /
> deferred / resize」，搬迁留在右侧栏。

### 不受影响 / 只需回归验证

| 文件 | 说明 |
|---|---|
| `src/layout/DragBarManager.ts` | 顶部拖拽栏。`observeLeftSplit()` 监听 `leftSplit.containerEl` 宽度做 macOS 交通灯让位 + 面包屑。只关心侧栏**宽度**不关心内部结构 → 不动，回归验证。 |
| `src/layout/ResponsiveSidebarManager.ts` | 窄窗口自动收起 `leftSplit`。操作 `leftSplit.collapsed` → 不动。 |
| `src/single-page/GraphSidebarManager.ts` | 进全局关系图 / canvas 时收起 `leftSplit`（由 `SinglePageEngine` 持有）。操作 `collapsed` → 不动。`SidebarLayoutManager.ts:316-343` 里为它加的关系图近零 `onResize` 守卫要迁进新的关系图 slot 逻辑。 |
| `src/layout/PropertyKeyResizer.ts` | 拖 `.metadata-content` 的 key 列宽，写 `--minimalism-ui-prop-key-width`。属性面板改回原生 leaf 后 `.metadata-content` 选择器仍在 → 应该照常工作，回归验证。 |
| `src/layout/SidebarSuggestFocusTracker.ts` | 焦点落入左栏属性值时给 body 加 class 供主题着色。选择器基于 `.workspace-split.mod-left-split` → 不动，回归验证。 |
| `src/layout/RibbonPanelManager.ts` | 把 `.side-dock-actions` 搬进 vault-profile 折叠面板。**完全独立、永远最底、只开关** → 不动。 |

### body class / i18n

- body class：`minimalism-ui-mac-sidebar`（`BodyClassController.ts:7,30`）、`minimalism-ui-hide-tab-bar`、
  `minimalism-ui-hide-vault-profile`、`minimalism-ui-simplify-panel` —— 审查每一条对应的 CSS 是否假设 outline host。
- i18n（`src/core/i18n.ts`）：`showProperties` / `showLocalGraph` / `localGraph` 现有 key；
  新增 slot 列表 UI 文案（「左侧栏面板」「添加面板」「选择视图」等，zh + en）。

---

## 2. 目标数据模型

```ts
// src/core/settings.ts
interface SidebarSlot {
  id: string;            // 稳定 id（`slot-<时间戳>`），供设置页列表渲染 / 拖拽排序做 key
  viewType: string;      // 任意已注册工具类 view，含 'localgraph' / 'outline' / 'file-properties' / 'backlink' …
  enabled: boolean;      // 预留：列表里每一项都视为启用（添加即启用、移除即删除），新增项恒 true
  height: number | null; // flex-grow 数值（用户拖 resize handle 写入，Phase 2）；null = 等分 / 自适应
}

interface MinimalismUISettings {
  // ...
  leftSidebarSlots: SidebarSlot[];   // 用户添加的面板列表，整表上限 4（MAX_LEFT_SIDEBAR_SLOTS）
  // 废弃：showProperties / showLocalGraph —— 仅 loadSettings 迁移时读一次旧值
}

// 2026-09-02 决策：左侧栏默认**完全空白**，改「添加 / 删除」语义（无固定三面板、无 per-row 开关）。
const MAX_LEFT_SIDEBAR_SLOTS = 4;
const DEFAULT_LEFT_SIDEBAR_SLOTS: SidebarSlot[] = [];
```

**迁移**（`loadSettings`）：旧 `data.json` 无 `leftSidebarSlots` 字段 → 置 `[]`，并把旧的
`showProperties` / `showLocalGraph` 归零。老用户升级后左侧栏也一并清空（用户拍板）。

---

## 3. 分阶段任务

### Phase 0 — 抽共享服务（独立可验证，无行为变化）✅ 2026-09-01 完成

- [x] 新建 `src/core/LeafMountService.ts`，从 `RightSidebarViewStack` 迁出：
  `allRegisteredToolViewTypes` / `ensureAllToolViewsExist`（find-or-create）/
  `materializeDeferredLeaves` / `notifyResize` / `DOCUMENT_VIEW_TYPES`
- [x] `RightSidebarViewStack` 改成消费 `LeafMountService`，删掉重复实现
- [x] `MANAGED_LEFT_VIEW_TYPES` 暂时保留常量（现 `DEFAULT_MANAGED_LEFT_VIEW_TYPES`），改为
  `setManagedLeftViewTypesProvider()` 可覆盖的形式；Phase 1 已接线到 `LeftSidebarManager.getOwnedViewTypes()`
- [x] 回归：`tsc` + `esbuild` 全绿；右侧栏逻辑未改行为（仅委托实现）
- 实际：与 Phase 1 一起交付

### Phase 1 — `LeftSidebarManager` + 原生 split 构造 ✅ 2026-09-01 完成

- [x] 新建 `src/layout/LeftSidebarManager.ts` 替代并删除 `SidebarLayoutManager`
- [x] `apply()`：读 `leftSidebarSlots`（enabled、≤4）→ 用 `getLeftLeaf(true)` 确保每个 viewType 有 leaf
  → 在 `workspace.leftSplit` 里把这些 leaf 排成单一纵向堆叠，顺序 = slot 顺序
  - **spike 结论**（实机 CDP 验证，见 `project-configurable-left-sidebar-slots` 记忆）：
    左侧栏纵向堆叠 = `leftSplit.direction === 'horizontal'`（反直觉：Obsidian 的 'horizontal'/
    'vertical' 命名对应 resize handle 朝向，不是排列方向）；`getLeftLeaf(true)` 在末尾新建
    `WorkspaceTabs` 包一个新 leaf 且不改 activeLeaf；重排用 `removeChild` + `insertChild(index)`
    （会同步 DOM 与触发 `onLayoutChange`）；`createLeafInParent` 会建裸 leaf 且调
    `setActiveLeaf`，弃用。
  - 目标 DOM 已用实机验证：`.workspace-split.mod-left-split.mod-horizontal` 直接持有 N 个
    `.workspace-tabs`（各含 1 leaf）+ 原生 resize handle（当前仍被 styles.css 隐藏，Phase 2 处理）
- [x] **reconcile 而非重建**：`doReconcile()` diff 期望 slot 列表与当前 `leftSplit.children`，
  只增删 / 移动变化的 tab 组；实机验证并发 `apply()` 两次不产生重复 leaf，禁用/重排/重新启用
  均正确增删而不动未变化的 leaf
- [x] 保留并发守卫（`applyRun` / `rerunRequested`）
- [x] 折叠状态快照 / 还原；实机验证收起态下 `apply()` 不会强制展开
- [x] 0 个 enabled slot 的边界：不清空 `leftSplit`（清空会连 sidedock 一起被 Obsidian 摘掉），只
  collapse；实机验证 sidedock 存活、children 不变
- [x] `remove()`：仅还原 `testCSS` patch，split 结构保留（多 stacked leaf 是 Obsidian 合法状态）——
  「收拢成单 leaf」留作 §7 开放问题，未强制处理
- [x] `loadSettings` 迁移旧布尔 → `leftSidebarSlots`（`saved.leftSidebarSlots` 缺失时按
  `showProperties`/`showLocalGraph` 生成默认三 slot）
- [x] `main.ts` 全部接线；`SettingTab` 的两个旧开关过渡期直接改对应 slot 的 `enabled`
  （Phase 3 前占位，避免开关看起来失效）
- [x] 实机验证关系图：native leaf 切换文件后 canvas 正确重绘（未空白）——对 R4/blank-bug 是
  积极信号，但非详尽复现测试，Phase 4 仍需专项回归
- 实际：约 0.5d（含实机 spike + 验证），未触及的：Phase 2 高度持久化、Phase 3 slot UI、
  Phase 4 styles.css 重写与关系图 4:3 迁移

### Phase 2 — resize handle + 高度持久化

- [ ] 让原生 `.workspace-leaf-resize-handle` 在左侧栏嵌套 split 里**显示**（改 `styles.css:87-92`）
- [ ] 监听拖拽结束（Obsidian 内部会更新 leaf `dimension`；或自己在 handle 上挂 pointerup）
  → 把结果高度写回对应 `slot.height`，防抖 `saveSettings`
- [ ] `apply()` 时按 `slot.height` 恢复各 leaf 高度（写 Obsidian 的 split 尺寸 API 或 flex-basis）
- [ ] 双击 handle 复位到 `null`（默认高度）
- [ ] 每次拖拽后对受影响 leaf 调 `LeafMountService.notifyResize`（虚拟滚动视图）
- [ ] 关系图 slot：**不**给它上下的 handle 绑高度写回；它的高度仍由迁移过来的 4:3 逻辑管
- 估计 1–1.5d

### Phase 3 — SettingTab slot 列表 UI ✅ 2026-09-02 完成

- [x] `configureShowProperties` / `configureShowLocalGraph` / `setSlotEnabled` 删除，
  `display()` 换成 `configureLeftSidebarSlots(appearanceEl)`
- [x] 模型改「添加 / 删除」语义：`leftSidebarSlots` 就是用户添加的列表，整表上限 4
  （`MAX_LEFT_SIDEBAR_SLOTS`），无 per-row 开关；`SidebarSlot.enabled` 保留恒 true 兼容
  `LeftSidebarManager` 的过滤。`DEFAULT_LEFT_SIDEBAR_SLOTS = []`，迁移也置 `[]`。
- [x] 渲染 ≤4 行：拖拽手柄（HTML5 DnD）+ view 下拉 + 删除按钮；下拉选项 =
  `plugin.listSidebarViewOptions()`（`leafMount.allRegisteredToolViewTypes()` + 标签优先取
  已打开同类型 leaf 的 `getDisplayText()`，否则 humanize），已被别的行占用的 type 从下拉里排除
- [x] 「添加面板」按钮：`slots.length < 4` 且有未占用 type 时可用，默认选中优先经典三面板
- [x] 增删改 / 拖拽后：`saveSettings` → `applyMacSidebarLayout` → `this.display()` 重渲染
- [x] i18n 文案 zh + en（`leftSidebarPanels*` / `addPanel` / `removePanel` / `dragToReorder`）
- [x] `LeftSidebarManager` 清场逻辑升级：leftSplit 里任何不在当前 slot 列表的**工具类** leaf
  （删掉的旧 slot、Obsidian 默认的文件浏览器 / 搜索 / 书签）一律摘掉，文档类不碰，始终留 ≥1
  子节点；0 slot 时也清到只剩 1 个再 collapse
- styles.css 加了 `.minimalism-ui-slot-*` 行样式（仅此列表，非 Phase 4 的全面重写）
- 实际：约 0.5d，未做：per-slot resize（Phase 2）、关系图 4:3 迁移 + styles.css 全面重写（Phase 4）

### Phase 4 — 跨模块归属 + 关系图接入 + QA

- [ ] `RightSidebarViewStack` 的 `MANAGED_LEFT_VIEW_TYPES` 改为
  `() => leftSidebarManager.getOwnedViewTypes()`（返回当前 enabled slot 的 viewType 集合）
  —— 同一 view type 不能同时在左栏 slot 和右栏堆叠里
- [ ] 关系图 4:3 `ResizeObserver` + `onResize` monkey-patch + `testCSS` 颜色重探
  从旧 `SidebarLayoutManager` 迁进新的「关系图 slot」子逻辑，验证 canvas 不空白
- [ ] `styles.css` 全面重写：删 outline-host 假设、section 标题样式、scrollbar 样式按 slot 通用化
- [ ] 回归矩阵（见 §5）
- 估计 1.5–2d

**总计 ~7–9d**

---

## 4. 关键 API / 技术未知（Phase 1 先 spike）

- [ ] **能否用 Obsidian API 在 leftSplit 里程序化构造一个指定顺序的纵向 split？**
  `createLeafInParent(parent, index)` + `parent` 取 leftSplit 的子 split？还是 `leaf.split(leaf, 'horizontal')`？
  spike：手动在 UI 里把 3 个面板拖成上下排列，dump `.workspace-split.mod-left-split` 的 DOM +
  `workspace.leftSplit` 的 children 树结构，照着构造。
- [ ] **Obsidian 的 workspace.json 布局恢复 vs 插件构造的时序**：`onLayoutReady` 后 Obsidian 已恢复
  一份侧栏布局，插件的 reconcile 要在其之上做 diff，不能盲目重建（否则每次启动闪 + 丢用户拖的宽度）。
- [ ] **leaf 高度 / dimension 的读写 API**：`WorkspaceLeaf` / `WorkspaceItem` 上的 `dimension` 字段？
  `setDimension`？还是只能靠 resize handle 模拟拖拽 / 直接写 flex？
- [ ] **卸载还原**：`remove()` 后如果留下一个多 leaf 的侧栏 split，禁用插件的用户会看到一堆 tab；
  需要 collapse 成单 leaf 或接受这个状态（记录到风险）。

---

## 5. 回归验证矩阵

- [ ] 各 slot 组合：0 / 1 / 2 / 3 / 4 个 enabled；含与不含 outline / localgraph
- [ ] 拖拽排序后重启 Obsidian，顺序 + 高度保持
- [ ] 拖 resize handle 调高，重启保持
- [ ] 切换笔记：outline / properties / backlinks 等跟随当前文件更新
- [ ] 关系图：Advanced URI / 外部链接打开笔记后不空白（旧 BUG，见记忆 `project-sidebar-local-graph-rewrite`）
- [ ] 关系图 canvas 在侧栏折叠 / 展开动画中不永久空白
- [ ] 进全局关系图 / canvas 文件：`GraphSidebarManager` 正常收起 / 恢复侧栏
- [ ] 窄窗口：`ResponsiveSidebarManager` 正常自动收起 / 展开
- [ ] macOS：顶部拖拽栏面包屑随侧栏宽度让位交通灯（`DragBarManager`）
- [ ] 属性 key 列宽拖拽（`PropertyKeyResizer`）仍工作
- [ ] 属性值输入时建议下拉配色（`SidebarSuggestFocusTracker`）
- [ ] 右侧栏悬浮窗：不再显示已被左栏占用的 view type；其余视图正常
- [ ] ribbon 折叠面板（`RibbonPanelManager`）在最底、开关正常
- [ ] 隐藏 tab 栏 / 隐藏 vault profile / simplify panel 三个 body class 对应 CSS 正常
- [ ] 主题切换后关系图 canvas 颜色跟随（`applyTheme` → 关系图 slot 颜色重探）
- [ ] 多窗口（弹出窗口）：左侧栏逻辑只作用主窗口，不误伤弹窗
- [ ] 插件禁用 / 卸载：侧栏还原到无残留、Obsidian 可接受的状态

---

## 6. 风险登记

| # | 风险 | 缓解 |
|---|---|---|
| R1 | 两个布局事实源（workspace.json vs settings）打架，启动闪 / 丢拖拽尺寸 | reconcile diff 而非重建；spike 时序 |
| R2 | 用户手动拖动 / 关闭侧栏 leaf 破坏插件构造的 split | 类 `SingleTabGroupGuard` 的守卫监听 `layout-change` 回弹 |
| R3 | 程序化构造指定顺序纵向 split 的 API 不存在 / 不稳定 | Phase 1 先 spike，失败则退回「注入 + 自定义 resize handle」方案（见 §0 备选） |
| R4 | 关系图 canvas 在 split 里仍会空白（旧 BUG 根因在 Obsidian 内部） | 迁移现有近零守卫 + `onResize` patch；spike 时先手动放原生 localgraph leaf 复现测试 |
| R5 | 卸载后残留多 leaf 侧栏 | `remove()` 收拢成单 leaf；或文档说明 |
| R6 | 某些第三方 view 在无文件上下文 / 竖直小高度下报错 | `LeafMountService` 的 try/catch 探测（右侧栏已验证）+ 回归矩阵覆盖核心 view |
| R7 | `styles.css` 大量 outline-host 假设遗漏一条 → 视觉回归 | Phase 4 全面重写而非增量改 |

## 7. 开放问题

- [ ] `remove()`（卸载）后侧栏留多 leaf split 是否可接受？还是必须收拢单 leaf？
- [ ] slot 的 section 标题：用原生 tab-header（用户能点切换）还是原生 `.view-header`（纯标题）还是隐藏？
- [ ] `disabled` 的 slot 是否在 settings 里保留（供切回），还是删除即丢？（建议保留）
- [ ] 关系图 slot 的 4:3 自动高度，与用户给相邻 slot 拖的高度冲突时谁让谁？
