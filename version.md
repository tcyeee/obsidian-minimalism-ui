# Minimalism UI

> 将 Obsidian 改造为极简 macOS 风格的写作环境。
> Transform Obsidian into a minimal, macOS-native writing environment.

---

## Version 1.3.29

- Fixed: a same-leaf file swap (e.g. clicking a link from the home page) could briefly leave a view with no file but its old view type intact, which was mistaken for a genuine file-less view (graph, search, etc.) — this no longer pollutes the breadcrumb or corrupts back/forward navigation
- Added: a new pinnable note-card sidebar panel that displays a single chosen note, with a note picker and an action to unbind it
- Fixed: the note-card sidebar panel no longer flashes blank on re-render, and switching between home/diary/other profiles now reuses the same panel instance instead of rebuilding it from scratch
- Fixed: embedded Bases card views in the dark sidebar no longer show as solid white tiles — the card background now matches the sidebar
- Fixed: stacked left-sidebar panels no longer each get the extra top padding meant only for the topmost panel
- Fixed: the right sidebar floating button setting, which had been accidentally disabled, works again
- Fixed: the dynamic width row in the status bar popover is now hidden when Obsidian's readable line length setting is off, since dynamic width only makes sense as an override of it

- 修复：同一标签页内切换文件（例如从首页点击链接）可能短暂地留下一个没有文件但仍保留旧视图类型的视图，被误判为真正的无文件视图（关系图、搜索等）——现在不再污染面包屑或破坏前进后退导航
- 新增：新增可固定的笔记卡片侧栏面板，可选定并显示单篇笔记，附带笔记选择器和取消绑定操作
- 修复：笔记卡片侧栏面板重新渲染时不再闪烁空白，切换首页/日记/其他场景时复用同一面板实例，而不是每次重新构建
- 修复：深色侧栏中嵌入的 Bases 卡片视图不再显示为纯白色块——卡片背景现在与侧栏保持一致
- 修复：堆叠的左侧栏面板不再各自叠加原本只应用于最上层面板的顶部留白
- 修复：右侧栏悬浮按钮设置项此前被意外禁用，现已恢复可用
- 修复：状态栏弹出面板中的动态宽度行，在 Obsidian 的可读行宽设置关闭时不再显示，因为动态宽度本来就只是对该设置的覆盖

---

## Version 1.3.28

- Fixed: in Single-Page Mode, redirecting an existing tab to a different file or view (e.g. via "open in same tab" links) bypassed the usual navigation handling, causing duplicate leaves and breadcrumb/back-forward desync — `openFile`/`setViewState` on managed root leaves are now patched so in-place redirects go through the same dedup and history recording as normal navigation
- Added: the left sidebar can now use independent panel layouts for the home note, daily notes, and all other notes — configure each "profile" separately from settings, with contextual hints when the home page or Daily notes core plugin isn't set up yet
- Changed: left sidebar panel settings got a more compact "add panel" control — an icon button inline with the panel list instead of a separate full-width button above it
- Fixed: the Local Graph panel's built-in settings controls no longer pop open and cover the graph canvas every time the panel (re)builds — e.g. on startup, or when switching between home/diary/default sidebar profiles

- 修复：单页模式下，将已有标签页重定向到另一篇笔记或视图（例如通过"在当前标签页打开"类链接）会绕过正常的导航处理，导致出现重复标签页及面包屑/前进后退历史错乱——现在对受管理的根标签页持久化 patch `openFile`/`setViewState`，使这类原地重定向也走与正常导航相同的去重与历史记录逻辑
- 新增：左侧边栏现在可以为首页、日记笔记、以及其他笔记分别配置独立的面板布局——在设置中按"场景"单独配置，首页未设置或日记核心插件未启用时会有相应提示
- 变更：左侧边栏面板设置的"添加面板"控件更紧凑——改为与面板列表同行的图标按钮，而不是列表上方单独的整行按钮
- 修复：关系图面板自带的设置控件不再在每次面板（重新）构建时（如启动时，或切换首页/日记/默认侧栏场景时）自动展开并遮挡关系图画布

---

## Version 1.3.27

- Changed: **minAppVersion raised to 1.13.0** — the settings tab now uses Obsidian's declarative `getSettingDefinitions()` API so its settings appear in Obsidian's in-app settings search; this is a breaking change for Obsidian versions older than 1.13.0, which will no longer receive plugin updates
- Internal: fixed three remaining lint findings ahead of submission review — an unused `WorkspaceLeaf` import, a redundant `unknown | null` union type, and a `text-underline-offset` CSS property flagged as only partially supported by Obsidian's bundled Electron version

- 变更：**minAppVersion 提升到 1.13.0**——设置页改用 Obsidian 声明式的 `getSettingDefinitions()` API，使设置项能被 Obsidian 内置设置搜索索引到；这是一次破坏性变更，低于 1.13.0 的 Obsidian 版本将不再收到插件更新
- 内部修复：发布审核前修复了三处剩余的 lint 问题——一个未使用的 `WorkspaceLeaf` 导入、一个冗余的 `unknown | null` 联合类型，以及一个被判定为浏览器部分不支持的 `text-underline-offset` CSS 属性

---

## Version 1.3.26

- Fixed: in edit mode (Live Preview / source), Obsidian 1.14.x's core readable-line-width rule outranked the dynamic-width rule, silently pinning text to a fixed 700px column — dynamic-width selectors now include `.mod-cm6` to match the core rule's specificity again, so the edit view width follows the setting as intended

- 修复：编辑模式（Live Preview / source mode）下，Obsidian 1.14.x 的核心可读行宽规则优先级高于动态宽度规则，导致文字被悄悄固定在 700px 列宽——动态宽度选择器补上 `.mod-cm6`，恢复与核心规则相同的优先级，编辑视图宽度重新按设置生效

---

## Version 1.3.25

- Fixed: dynamic width only narrowed `.cm-sizer` in Live Preview/source mode, leaving `.cm-content` and `.cm-line` full-width so text still stretched edge to edge — now mirrors Obsidian core's own readable-line-width rule, constraining all three layers in the edit view, with a HyperMD table-row exemption so tables aren't squeezed

- 修复：动态宽度此前在编辑模式（Live Preview / source mode）下只收窄了 `.cm-sizer`，`.cm-content` 与 `.cm-line` 仍是满宽，导致文字依然贴边铺满——现在仿照 Obsidian 原生可读行宽规则，同时约束编辑视图中的三层容器，并对 HyperMD 表格行保留豁免，避免表格被压窄

---

## Version 1.3.24

- Fixed: the embedded left ribbon panel silently stopped engaging (and the native ribbon stayed visible) on recent Obsidian versions, because the ribbon's side class is now computed dynamically (`mod-primary`/`mod-secondary`) instead of the old fixed `mod-left`/`mod-right` literals — all affected selectors now match either class
- Internal: fixed three lint findings ahead of submission review — unhandled promises in three settings-panel event listeners now use fire-and-forget `void`, and two further dependency vulnerabilities in the dev toolchain (`js-yaml`, `brace-expansion`) were patched; all dev-only, no effect on the shipped plugin

- 修复：近期 Obsidian 版本中，左侧嵌入式 ribbon 面板会静默失效（原生 ribbon 也不会被隐藏），原因是 ribbon 的方位 class 改为动态计算（`mod-primary`/`mod-secondary`），不再是旧的固定 `mod-left`/`mod-right`——现在所有相关选择器都同时匹配两种 class
- 内部修复：发布审核前修复了三处 lint 问题——设置面板中三个事件监听器里悬空的 Promise 改为显式 `void` 的 fire-and-forget 写法，并修复了开发工具链中另外两处依赖漏洞（`js-yaml`、`brace-expansion`）；均仅影响开发工具链，不影响已发布插件

---

## Version 1.3.23

- Added: the left sidebar is now built from native Obsidian stacked leaves with up to four configurable panel slots — add, remove, and reorder panels from settings, with an empty-state hint that links straight to the "左侧边栏样式" section, and panel heights that persist across reloads via a draggable dashed separator between stacked panels
- Changed: the Local Graph panel in the left sidebar now lives as a native stacked leaf instead of being DOM-injected into the outline leaf, matching the new panel architecture and removing a source of layout fragility
- Added: the right sidebar panel gained an "在主区打开" button that opens its currently mounted view as a real tab in the main editor area, copying the view state without disturbing the original sidebar leaf
- Added: the status bar menu gained a "动态宽度" toggle that widens a note's text column on wide screens by writing a marker into its frontmatter — now works independently of Obsidian's own "Readable line length" setting rather than silently doing nothing when it's off
- Fixed: in the Forest and Newspaper themes, reading view forced horizontal scrolling on code blocks with no language tag (or tagged `text`/`txt`) instead of wrapping like other code blocks

- 新增：左侧边栏改为基于 Obsidian 原生 stacked leaf 构建，最多支持 4 个可配置面板槽位——可在设置中添加、删除、拖拽排序面板，空侧栏会提示直接跳转到"左侧边栏样式"分区，面板之间的虚线分隔条可拖拽调整高度，并在重启后保持
- 变更：左侧边栏中的关系图面板现在作为原生 stacked leaf 存在，不再 DOM 注入到大纲面板中，与新的面板架构保持一致，并消除了一类布局脆弱性
- 新增：右侧栏面板新增"在主区打开"按钮，可将面板当前展示的视图克隆为主编辑区的真实标签页，且不影响原侧栏面板本身
- 新增：状态栏菜单新增"动态宽度"开关，通过写入笔记 frontmatter 标记来在宽屏上拓宽正文列宽——现在不再依赖 Obsidian 自身的"可读行长度"设置，该设置关闭时开关也能正常生效（此前会静默失效）
- 修复：Forest 与 Newspaper 主题下，阅读视图中未标注语言（或标注为 `text`/`txt`）的代码块会被强制横向滚动，而不是像其他代码块一样正常换行

---

## Version 1.3.22

- Added: the status bar menu gained a "Plugin settings" entry for quick access to the plugin's configuration
- Fixed: the status bar menu's left/right sidebar toggles could enter an infinite recursion loop when their displayed state was refreshed programmatically — flipping a toggle triggered its `onChange`, which fired the sidebar collapse/expand, which triggered another refresh, and so on
- Fixed: in the plugin's settings tab, collapsing a section heading left its content still visible below it instead of hiding it

- 新增：状态栏菜单新增"插件设置"入口，可快速打开插件配置
- 修复：状态栏菜单中左右侧栏开关在程序化刷新显示状态时可能陷入无限递归——切换开关触发其 `onChange`，进而触发侧边栏折叠/展开，又触发一次刷新，如此循环
- 修复：插件设置页中折叠某个分区标题后，其下方内容仍然可见，未被一并隐藏

---

## Version 1.3.21

- Fixed: in Single-Page Mode, closing the tab holding the visible slot could race Obsidian's own auto-selection of a neighboring tab — losing the race jumped to an unrelated tab outside the breadcrumb and corrupted navigation history. Closing a tab now synchronously hands the visible slot to its deterministic successor before calling `detach()`, so Obsidian never gets the chance to pick one itself
- Changed: on startup, the home note no longer briefly flashes in before Obsidian's own restored note/view is shown — Single-Page Mode now only opens the home note when nothing was actually restored, otherwise it just seeds the breadcrumb trail with it
- Fixed: in the Forest theme's dark sidebar, hovering or focusing a Properties field could paint a light-theme white patch instead of the intended translucent-white hover state; also added a touch of spacing below the Outline/Properties section headers for clearer separation
- Fixed: the left sidebar's collapsed/expanded state could invert itself on startup — a closed sidebar was forced open, or an open one ended up closed — because Obsidian asynchronously auto-collapses an emptied split after the sidebar rebuild's synchronous state check ran
- Internal: patched a high-severity dependency vulnerability (`js-yaml` quadratic CPU consumption in `!!omap` resolution, CVE-2026-59870) in the dev toolchain — dev-only, no effect on the shipped plugin

- 修复：单页模式下关闭占着可视位的标签页时，可能与 Obsidian 自身的相邻标签页自动选择产生竞态——输掉竞态会跳转到面包屑之外的无关标签页，并破坏导航历史。现在关闭标签页会在调用 `detach()` 之前，同步把可视位交接给确定的接替者，Obsidian 不再有机会自行挑选
- 变更：启动时首页笔记不再在 Obsidian 自身恢复的笔记/视图显示前短暂闪现——单页模式现在只在确实没有恢复任何内容时才打开首页，否则只是把首页写入面包屑轨迹
- 修复：Forest 主题深色侧边栏中，鼠标悬停或聚焦 Properties 字段时可能出现浅色主题的白色色块，而不是预期的半透明白色悬停效果；同时为 Outline/Properties 分区标题下方增加了少量间距以获得更清晰的视觉分隔
- 修复：左侧栏的折叠/展开状态在启动时可能自我反转——原本折叠的侧边栏被强制展开，或原本展开的最终变成折叠——原因是侧边栏重建的同步状态检查跑完后，Obsidian 又异步地对被清空的分栏做了自动折叠
- 内部修复：修复了一处高危依赖漏洞（`js-yaml` 在 `!!omap` 解析中的二次方 CPU 消耗，CVE-2026-59870），仅影响开发工具链，不影响已发布插件

---

## Version 1.3.19

- Fixed: on Obsidian 1.13+, changing any setting while the Settings window was open applied the change to the *Settings* window instead of the main window — Obsidian now opens Settings as a separate window and repoints the global `activeWindow`/`activeDocument` at it for as long as it stays open, which is exactly when the plugin re-applies its settings. Symptoms: the floating bottom-right button was injected into the Settings window (and vanished from the main window once Settings closed), CSS-driven toggles (hide tab bar, hide the bottom user-settings area, Single-Page Mode appearance) looked like they did nothing until a restart, and DOM-injection features silently failed because workspace nodes couldn't be found. All plugin DOM access now resolves the main window explicitly; the same bug applied when a note popout window had focus
- Fixed: the Local Graph panel in the merged left sidebar could go permanently blank after collapsing and re-expanding the sidebar — the WebGL canvas was being resized to zero height during the collapse animation and, unlike DOM panels, a dead WebGL context does not recover on the next valid resize. The size guard now measures the element the graph renderer actually measures (previously it measured an outer container that included the injected 28px header, leaving a window where the container passed the check but the content area was already at zero), and intermediate sidebar widths reported mid-animation are ignored instead of being converted into a sub-header-height panel

- 修复：在 Obsidian 1.13+ 上，设置窗口开着时修改任何设置，改动都会作用到**设置窗口**而不是主窗口——Obsidian 现在把「设置」放在独立窗口中打开，并在该窗口存在期间把全局 `activeWindow`/`activeDocument` 整个改指向它，而这恰恰是插件重新应用设置的时刻。表现为：右下角悬浮按钮被注入到设置窗口（设置一关就彻底消失），纯 CSS 驱动的开关（隐藏标签栏、隐藏底部用户设置区域、单页模式外观）改了像没反应、要重启才生效，依赖 DOM 注入的功能因找不到工作区节点而静默失效。现在插件所有 DOM 操作都显式解析到主窗口；焦点在笔记弹出窗口时同样会踩这个坑，已一并修复
- 修复：合并式左侧栏中的关系图面板在折叠再展开侧边栏后可能永久变空白——折叠动画期间 WebGL canvas 被 resize 到 0 高度，而与 DOM 面板不同，WebGL 上下文一旦失效不会在下一次有效 resize 时自行恢复。现在尺寸保护判定的是关系图渲染器真正测量的那个元素（此前测量的是外层容器，它还额外包着注入的 28px 标题栏，存在一段「容器通过检查、内容区实际已为 0」的窗口），并且忽略动画过程中报出的中间宽度值，不再据此折算出小于标题栏高度的面板高度

---

## Version 1.3.18

- Fixed: in Single-Page Mode, creating a new note could jump to the home note before the note actually finished being created, scrambling the breadcrumb and navigation history — the plugin now waits for the on-disk creation signal before deciding a pending tab is really blank
- Fixed: the 30-tab LRU cap in Single-Page Mode could silently stop evicting anything once a single leaf failed to detach, letting background tabs accumulate unbounded and slow the app down over extended use
- Fixed: closing a tab in Single-Page Mode could reopen an already-dead history entry, handing control to Obsidian's native tab-picking behavior and polluting the breadcrumb with an unrelated tab
- Added: drag-and-drop reordering for the right sidebar's icon stack, with visual feedback for dragging and stowed icons
- Internal: patched two high-severity dependency vulnerabilities (`brace-expansion` DoS) in the dev toolchain — dev-only, no effect on the shipped plugin

- 修复：单页模式下新建笔记时，可能在笔记真正创建完成前就跳转到首页，导致面包屑和导航历史错乱——现在会等待磁盘落盘信号确认后，才判定一个待定标签页确实为空白页
- 修复：单页模式的 30 个标签页 LRU 上限在某个标签页分离失败后可能静默失效，导致后台标签页无限增长，长时间使用后拖慢应用
- 修复：单页模式下关闭标签页时，可能重新打开一条已失效的历史记录，导致控制权被交给 Obsidian 原生的标签页选择行为，并在面包屑中混入无关标签页
- 新增：右侧栏图标堆叠支持拖拽排序，并为拖拽和收起状态提供了视觉反馈
- 内部修复：修复了两处高危依赖漏洞（`brace-expansion` 的 DoS），仅影响开发工具链，不影响已发布插件

---

## Version 1.3.17

- **1.3.16 was rejected by Obsidian's plugin review** and never went out through official channels — this release supersedes it with compliant fixes for the same two review items
- Fixed: reverted the 1.3.16 declarative settings API experiment — Obsidian's review flags any reference to the new `getSettingDefinitions()`/`update()`/`refreshDomState()` APIs as a blocking error when `minAppVersion` is below `1.13.0`, even when the call is behind a runtime version check; the settings tab is back to the `display()` API only (same as 1.3.15), and this plugin will keep accepting the "settings search indexing" recommendation as a permanent, non-blocking known item rather than raising the minimum Obsidian version again
- Fixed: theme CSS is no longer injected at runtime as a `<style>` element (creating/attaching `<style>` elements is banned outright by Obsidian's review, regardless of which DOM API creates them) — each theme's CSS is now compiled directly into `styles.css` at build time, and switching themes only toggles a body class to select which theme's (already-scoped) rules apply

- **1.3.16 未通过 Obsidian 插件审核**，从未通过官方渠道正式发布——本次版本针对同样两项审核意见提供了合规修复
- 修复：回退了 1.3.16 中试验性的声明式设置 API——当 `minAppVersion` 低于 `1.13.0` 时，Obsidian 审核会把任何引用新版 `getSettingDefinitions()`/`update()`/`refreshDomState()` API 的代码都判定为阻断性错误，即使调用被运行时版本判断包裹也一样；设置页面已改回只使用 `display()` API（与 1.3.15 相同），本插件后续会将"设置项可被搜索索引"这条审核建议作为长期保留、不再修复的已知事项，而不是再次提高最低 Obsidian 版本要求
- 修复：主题 CSS 不再在运行时以 `<style>` 元素的形式注入（Obsidian 审核明确禁止在运行时创建/挂载任何 `<style>` 元素，无论用哪个 DOM API 创建）——各主题的 CSS 现在会在构建期直接编译进 `styles.css`，切换主题时只切换一个 body 类名来选中对应主题（已作用域隔离）的规则生效

---

## Version 1.3.16

- Fixed: the settings tab now also implements Obsidian's new declarative `getSettingDefinitions()` API, so it's indexed by Obsidian's built-in settings search on 1.13+ — unlike the reverted 1.3.14 attempt, this does **not** raise the minimum Obsidian version; the old `display()` API is kept fully working side by side for users on 1.7.2–1.12.x
- Internal: the injected theme `<style>` element now uses Obsidian's own DOM helper instead of raw `document.createElement`, per plugin-review feedback

- 修复：设置页面现在同时实现了 Obsidian 新的声明式 `getSettingDefinitions()` API，因此可以被 Obsidian 内置的设置搜索索引（1.13 及以上版本）——与被回退的 1.3.14 不同，这次**不会**提升最低 Obsidian 版本要求，旧的 `display()` API 会与新 API 并存，继续为 1.7.2–1.12.x 版本的用户提供完整支持
- 内部修复：根据插件审核反馈，注入的主题 `<style>` 元素改用 Obsidian 自带的 DOM 辅助方法创建，不再使用原生 `document.createElement`

---

## Version 1.3.15

- **Reverted the 1.3.14 minimum-version bump — Obsidian 1.7.2 is supported again** (settings tab is back on the imperative `display()` API instead of the new declarative one, which required 1.13.0)
- Fixed: the status bar's lock indicator is now a plain state icon shown only in reading mode, instead of a clickable mode-toggle with a misleading aria-label
- Fixed: the Local Graph panel could render broken/blank right after the sidebar first mounts or a pane is resized to a near-zero width, before ever being shown at a real size
- Internal: closed several lifecycle/leak edge cases — a disabled plugin could get ghost-reapplied if a layout callback fired after unload, a mid-flight settings change to the sidebar layout could get silently dropped, Mermaid zoom now follows popout windows opening/closing, and a leaf detached immediately after creation could be missed by cleanup; the right sidebar's last-selected panel is now restored after a restart
- Internal: patched a high-severity dependency vulnerability (ReDoS in `brace-expansion`, pulled in via the eslint toolchain) — dev-only, no effect on the shipped plugin

- **回退了 1.3.14 引入的最低版本要求，重新支持 Obsidian 1.7.2**（设置页面改回使用命令式的 `display()` API，不再依赖需要 1.13.0 的新声明式 API）
- 修复：状态栏的锁定图标现在只是一个纯状态展示，仅在阅读模式下显示，不再是带有误导性 aria-label 的可点击模式切换按钮
- 修复：本地关系图面板在侧边栏刚挂载或窗格被缩放到接近零宽度后、尚未获得真实尺寸前，可能渲染异常或空白
- 内部修复：修复了若干生命周期/内存泄漏边界情况——布局回调在插件卸载后才触发时，禁用的插件可能被"幽灵式"重新应用；侧边栏布局中途收到设置变更时可能被静默丢弃；Mermaid 缩放功能现在会跟随弹出窗口的打开/关闭；紧接创建后就被分离的标签页此前可能未被正确清理；右侧栏现在会在重启后恢复上次选中的面板
- 内部修复：修复了一处高危依赖漏洞（`brace-expansion` 的 ReDoS，通过 eslint 工具链引入）——仅影响开发依赖，不影响已发布插件

---

## Version 1.3.14

- **Requires Obsidian 1.13.0 or later** (up from 1.7.2) — the settings tab now uses Obsidian's new declarative settings API
- Fixed: the home note could occasionally drop out of your back-navigation history, or appear duplicated in it, after closing tabs or navigating back and forth; it now stays reliably pinned as the anchor at the start of your history
- Fixed: reopening a history entry that had been closed or evicted from the tab cache now reuses an existing blank tab instead of always opening a new one
- Internal: minor type-safety cleanups (removed unnecessary non-null assertions and a redundant type union) — no user-visible behavior change

- **需要 Obsidian 1.13.0 或以上版本**（原为 1.7.2）——设置页面已迁移至 Obsidian 新的声明式设置 API
- 修复：关闭标签页或反复前进/后退后，首页笔记偶尔会从后退历史中丢失，或在其中重复出现；现在首页会稳定固定在历史记录起点
- 修复：重新打开一个已被关闭或从标签缓存中淘汰的历史记录条目时，现在会复用已有的空白标签页，而非总是新开一个
- 内部修复：若干类型安全清理（移除多余的非空断言与冗余类型联合）——无用户可见行为变化

---

## Version 1.3.13

- Fixed: renaming or deleting a note from the status bar's actions menu now shows an error notice instead of failing silently if the operation can't complete (e.g. a name collision or a locked file)
- Fixed: the actions menu's Locked/Edit/Source switcher and its rename/delete/export/open rows are now reachable and operable via keyboard (Tab, Enter/Space), restoring accessibility lost when the native menu was replaced with a custom popover
- Internal: fixed a rare ordering bug where two features intercepting the same internal Obsidian command hook could leave a stale, broken wrapper installed after the plugin unloads; the shared interception logic is now consolidated in one place
- Internal: switching note mode no longer rebuilds the entire actions menu on every click; a note with no explicit view-state now defaults to highlighting "Edit" instead of leaving all three modes unhighlighted

- 修复：状态栏操作菜单中重命名或删除笔记失败时（如文件名冲突、文件被占用），现在会弹出错误提示，而不是静默失败
- 修复：操作菜单的锁定/编辑/源码切换及重命名/删除/导出/默认打开各项，现已支持键盘操作（Tab 切换、回车/空格激活），弥补了原生菜单被自绘悬浮面板替换后缺失的无障碍访问能力
- 内部修复：修复了一处偶发的顺序错误——两个功能各自拦截同一个 Obsidian 内部命令钩子时，插件卸载后可能残留一个失效的包装函数；相关拦截逻辑已合并到统一模块
- 内部修复：切换笔记模式不再整体重建操作菜单；笔记视图状态缺失显式标记时，默认高亮显示"编辑"而非不高亮任何选项

---

## Version 1.3.12

- Added back/forward navigation buttons to the top drag bar, next to the breadcrumb — jump through your cross-tab history without reaching for the keyboard
- Added a new "actions menu" icon in the status bar: switch the active note between locked (reading), edit (live preview), and source mode; rename or delete the note; export to PDF; open the file with your system's default app; and toggle the left/right sidebars — all from one popover
- Internal: fixed a moderate dependency vulnerability in a build tool (js-yaml) and removed an unnecessary type cast in the new status bar code — no user-visible behavior change

- 拖拽栏面包屑旁新增前进/后退导航按钮，无需键盘即可在跨标签页历史记录中跳转
- 状态栏新增"操作菜单"图标：可在锁定（阅读）/编辑（实时预览）/源码三种模式间切换当前笔记，重命名或删除笔记，导出为 PDF，用系统默认程序打开文件，以及开关左右侧边栏——均整合在同一个悬浮面板中
- 内部修复：修复了一处构建工具（js-yaml）的中等风险依赖漏洞，并移除了新增状态栏代码中一处多余的类型转换——无用户可见行为变化

---

## Version 1.3.11

- The right sidebar's floating icon stack now supports drag-to-reorder, and a new collapse ("stow") toggle lets you hide icons you rarely use behind a chevron — both the order and the collapse boundary persist across restarts
- Internal: fixed a direct inline-style assignment in the new drag-reorder code, replaced with `setCssStyles()` to match Obsidian's plugin review guidelines — no user-visible behavior change

- 右侧栏悬浮图标堆叠现已支持拖拽重新排序，并新增"收纳"折叠开关（点击箭头图标），可将不常用的图标隐藏起来——排序与收纳分界均跨重启保留
- 内部修复：新增的拖拽排序代码中一处直接内联样式赋值，已替换为 `setCssStyles()` 以符合 Obsidian 插件审核规范——无用户可见行为变化

---

## Version 1.3.10

- Fixed a TypeScript build-config gap flagged by Obsidian's plugin review: `tsconfig.json`'s target library was one version short of what the code actually relied on (`Array.prototype.includes`), which only worked locally by accident; no functional change

- 修复 Obsidian 插件审核指出的 TypeScript 构建配置问题：`tsconfig.json` 的目标库版本比代码实际依赖的（`Array.prototype.includes`）低了一版，此前只是本地环境凑巧能跑通；无功能变化

---

## Version 1.3.9

- Added a "Skip tutorial" button to the getting-started onboarding panel, so it can be dismissed at any point instead of only after completing every task

- 新手引导面板新增"跳过教程"按钮，无需完成全部任务即可随时关闭引导

---

## Version 1.3.8

- Fixed: the right sidebar panel (backlinks, outgoing links, etc.) no longer closes itself when any other setting is saved — its open/pinned state is now preserved across the panel's internal rebuild
- CI: releases are now published directly instead of landing as an unpublished draft, so the plugin's manifest version always has a matching downloadable release

- 修复：保存任意其他设置时右侧栏面板（反向链接、出链等）不再被意外关闭——重建面板 DOM 时会保留其展开/固定状态
- CI：发布流程改为直接发布正式版本，不再停留在未发布的草稿状态，确保插件清单版本始终对应一个可下载的正式发布

---

## Version 1.3.7

- Added a right sidebar panel: a floating button expands/collapses a panel that hosts your right-side leaves (backlinks, outgoing links, etc.), with a stack of switchable icons, resizing, and a pin toggle to keep it open across sessions
- Status bar reading/editing indicator visibility improved; ribbon panel now moves its actions container as a whole for better sync with dynamically added icons; deferred leaves now render correctly when switched to
- Internal cleanup: removed temporary DOM-mutation tracing scaffolding used while debugging the right sidebar panel, and replaced a direct inline style assignment with `setCssStyles()` — no user-visible behavior change

- 新增右侧栏面板：悬浮按钮展开/收起一个承载右侧 leaf（反向链接、出链等）的面板，支持图标堆叠切换、拖拽调整大小，并可固定钉住以在会话间保持展开
- 优化状态栏阅读/编辑模式指示器的显隐；功能区面板改为整体移动其操作容器，与动态新增的图标更好同步；修复切换到延迟加载视图时的渲染问题
- 内部清理：移除此前为排查右侧栏面板问题而加入的临时 DOM 变更追踪代码，并将一处直接内联样式赋值替换为 `setCssStyles()`——无用户可见行为变化

---

## Version 1.3.6

- CI only: fixed the release workflow silently falling back to the tagged commit's subject line instead of the changelog content written into the tag annotation, by force-fetching the real annotated tag object before reading it — no plugin code change

- 仅 CI：修复发布流程在读取标签时静默回退为提交信息而非标注中写入的更新日志内容的问题，方式是在读取前强制重新拉取真实的标注标签对象——插件代码无变化

---

## Version 1.3.5

- Internal cleanup: replaced a direct innerHTML assignment and inline style writes with safer DOM/class-based equivalents, removed redundant type casts, and dropped a `!important` CSS override in favor of higher selector specificity — no user-visible behavior change

- 内部清理：将直接的 innerHTML 赋值与内联样式写入替换为更安全的 DOM/class 方式，移除多余的类型强转，并以更高选择器优先级取代一处 `!important` 覆盖——无用户可见行为变化

---

## Version 1.3.4

- Added a status bar lock icon that shows and toggles between reading and editing mode
- Ribbon panel icons are now wrapped in a dedicated container for cleaner layout, with the original side-dock actions hidden
- Newspaper theme: live-preview horizontal rules are now scoped correctly so source mode keeps its plain `---` text; selection color is fixed in live preview; task list checkbox indent is halved consistently across reading and live-preview views; the local graph settings panel background now matches the sidebar in both light and dark variants

- 状态栏新增锁形图标，用于显示并切换阅读/编辑模式
- 功能区面板图标改为包裹在专用容器中以获得更整洁的布局，原生的侧边停靠操作已隐藏
- Newspaper 主题：修复实时预览下分割线的作用域（源码模式下 `---` 保持纯文本）；修复实时预览选区颜色；统一阅读与实时预览下任务列表复选框的缩进（减半）；侧边栏局部关系图设置面板背景在深浅色下均与侧栏底色一致

---

## Version 1.3.3

- Added a collapsible ribbon panel embedded in the left sidebar — ribbon icons now live inside the sidebar instead of the standalone ribbon bar, and can be expanded or collapsed via a toggle at the top of the panel
- Removed the separate "Show ribbon" setting; ribbon visibility is now controlled entirely through the sidebar panel
- Fixed Forest theme styling in editor mode (live preview and source) — layout and colors now render correctly in all editing contexts

- 新增可折叠的功能区侧栏面板——Ribbon 图标嵌入左侧栏，通过面板顶部切换展开/折叠，取代原有独立功能区
- 移除单独的「显示功能区」设置项，功能区显隐改由侧栏面板统一控制
- 修复 Forest 主题在编辑模式（实时预览与源码模式）下的布局和颜色渲染问题

---

## Version 1.3.2

- Ribbon visibility now follows Obsidian's native ribbon config, so show/hide is reliable across reloads
- Single-Page Mode handles restored and merged tabs more reliably — de-duplication and the tab cap now account for tabs recreated on startup or by dragging
- Code blocks wrap long lines in edit view and scroll horizontally in reading view, in both Forest and Newspaper themes
- Forest dark mode: dedicated code-block and content-area backgrounds for better contrast, and Mermaid diagrams now render inside a framed, padded box that adapts to light/dark
- Cleaner Outline sidebar: removed the indentation guide lines under headings

- 功能区显隐改为跟随 Obsidian 原生配置，重载后状态稳定可靠
- 单页模式更可靠地处理恢复和合并的标签——去重与标签上限现在会正确计入启动重建或拖拽产生的标签
- 代码块在编辑视图折行显示超长行、在阅读视图横向滚动，Forest 与 Newspaper 主题均生效
- Forest 暗色模式：为代码块与正文区设置专用背景以提升对比度，Mermaid 图表改为带边框内边距的框体并自动适配深浅模式
- 大纲侧栏更简洁：移除各标题下方的层级缩进引导线

---

## Version 1.3.1

- Added responsive left sidebar: it auto-collapses when the window gets too narrow to keep the note at its readable line width, and re-expands once there's room again
- Added a draggable resizer for the Properties key column in the merged sidebar
- Improved code block styling for better readability and smoother horizontal scrolling; removed code-block line numbers

- 新增左侧栏自适应：当窗口太窄、正文无法保持可读行宽时自动收起，窗口变宽后再自动展开
- 新增合并侧栏中 Properties 键列的可拖拽宽度调节
- 优化代码块样式，提升可读性与横向滚动体验；移除代码块行号

---

## Version 1.3.0

- Added a first-run onboarding checklist that guides new users through the core features and dismisses itself once completed
- Single-Page Mode now keeps the main area to a single tab group, automatically collapsing any tabs or splits created by dragging
- Changing the home note in Settings now resets the main area to just the home tab
- New defaults turn most features on out of the box (Local Graph, hidden tab bar, Single-Page Mode, navigation animation); the new ribbon toggle and manual filename prefix stay off, and advanced sections start collapsed
- Existing users keep their current layout untouched on upgrade

- 新增首次启用引导清单，带新用户熟悉核心功能，完成后自动隐藏
- 单页模式现在将主区域保持为单一标签组，自动收拢拖拽产生的多余标签或分屏
- 在设置中更换首页后，主区域会自动收拢为只剩首页一个标签
- 调整默认值，多数功能开箱即用（局部关系图、隐藏标签栏、单页模式、导航动画）；新增的功能区开关与手动文件名前缀默认关闭，高级区块默认折叠
- 老用户升级时保持现有布局不变

---

## Version 1.2.9

- Improved single-page navigation to use the most recently active leaf for more reliable behavior
- Fixed collapsible sections in Settings not hiding content correctly in all cases
- Minor internal improvements: type declarations for theme assets, translation string consistency

- 优化单页模式导航，使用最近激活的标签以提升可靠性
- 修复设置面板折叠分组在部分情况下内容未正确隐藏的问题
- 内部改进：主题资源类型声明、翻译字符串一致性优化

---

## Version 1.2.8

- Added collapsible sections to the Settings panel for better organization
- Fixed single-page navigation getting stuck when navigating back through fileless views (e.g., global graph)
- Fixed breadcrumb home icon color not inheriting from surrounding items
- Theme fonts and styles are now fully embedded in the plugin bundle, ensuring they load correctly after marketplace installation

- 为设置面板添加可折叠分组，浏览更清晰
- 修复单页模式下后退经过无文件视图（如全局图谱）时导航被卡住的问题
- 修复面包屑主页图标颜色未跟随周围图标颜色的问题
- 主题字体与样式现已完整内嵌于插件包，从插件市场安装后可正确加载

---

## Version 1.2.7

- Added a home icon to the breadcrumb and improved home page detection
- Improved Forest theme styling for Bases tables, with better alignment and readability
- Fixed graph colors not always reapplying when the graph is reopened
- Fixed the single-page forward/back entrance animation occasionally not being visible

- 在面包屑导航新增主页图标，并改进主页检测
- 优化森林主题 Bases 表格样式，对齐与可读性更好
- 修复重新打开图谱时颜色不总是重新应用的问题
- 修复单页模式前进/后退入场动画极小概率才可见的问题

---

## Version 1.2.6

- Added Newspaper theme styling for Bases tables, canvas, and sidebar with a paper-like look
- Improved Forest and Newspaper sidebar and chrome colors for a more cohesive theme look
- Improved single-page navigation animations and state handling
- Improved left sidebar resize behavior and width handling
- Changed defaults so the local graph and vault profile are shown out of the box

- 为报纸主题新增 Bases 表格、白板与侧边栏的纸感样式
- 优化森林与报纸主题的侧边栏与边框配色，整体观感更统一
- 优化单页模式的导航动画与状态处理
- 优化左侧边栏的拖拽缩放行为与宽度处理
- 调整默认设置，开箱即默认显示本地图谱与仓库简介

---

## Version 1.2.5

- Added Forest theme with dynamic theme switching
- Added a "Go to home" button on Obsidian's empty view
- Added table drag-handle styling and fixed table content clipping on overflow
- Changed drag-bar tab indicator from a count number to a small dot
- Fixed single-page navigation: home note now opens reliably on rapid CMD+W close, and the page transition animation no longer triggers from the wrong tab

- 新增森林主题，支持动态切换主题
- 在 Obsidian 空页面新增回到主页按钮
- 新增表格拖拽手柄样式，修复表格内容溢出时被裁切的问题
- 拖拽栏标签页指示从数字改为小圆点
- 修复单页模式导航问题：快速 CMD+W 关闭时主页能稳定打开，页面切换动画不再由错误的标签页触发

---

## Version 1.2.1

- Fixed navigation history retaining stale entries after closing tabs
- Fixed navigation history not updating when a file is renamed
- Fixed navigation history not seeding correctly when plugin is enabled mid-session

- 修复关闭标签页后导航历史残留失效条目的问题
- 修复文件重命名后导航历史未同步更新的问题
- 修复插件在 Obsidian 运行中途启用时导航历史未正确初始化的问题

---

## Version 1.2.0

- Added breadcrumb row in the drag bar showing recent navigation history
- Added setting to strip filename timestamp prefix from breadcrumb display
- Added language toggle setting (Chinese / English)
- Added tab count indicator in the drag bar
- Fixed breadcrumb overflow detection crashing on zero-width container
- Fixed stale leaves with no file leaking into breadcrumb history
- Improved graph node label visibility in the local graph panel

- 拖拽栏新增面包屑行，展示最近导航历史
- 新增文件名前缀剥离设置，在面包屑中隐藏时间戳前缀
- 新增语言切换设置（中文 / 英文）
- 拖拽栏新增当前打开的标签页数量显示
- 修复面包屑溢出检测在容器宽度为零时崩溃的问题
- 修复无文件的失效 leaf 泄漏进面包屑历史的问题
- 优化本地图谱节点标签的可见性

---

## Version 1.1.2

### Installation

1. Download `minimalism-ui.zip` from the [Releases](../../releases) page
2. Unzip it directly into your vault's `.obsidian/plugins/` directory
3. In Obsidian: **Settings → Community Plugins → enable Minimalism UI**

The zip extracts to an `obsidian-minimalism-ui/` folder that includes `main.js`, `manifest.json`, `styles.css`, and the bundled `fonts/` directory — no extra steps needed.

### 安装

1. 在 [Releases](../../releases) 页面下载 `minimalism-ui.zip`
2. 将压缩包直接解压到库的 `.obsidian/plugins/` 目录中
3. 在 Obsidian 中：**设置 → 第三方插件 → 启用 Minimalism UI**

压缩包解压后得到 `obsidian-minimalism-ui/` 文件夹，已包含 `main.js`、`manifest.json`、`styles.css` 及 `fonts/` 目录，无需额外操作。

---

### What's New / 新增功能

- Added local graph panel to sidebar with dark color theme, resizable layout, and header controls
- Added option to show Properties panel in sidebar
- Added zoom support for Mermaid diagrams
- Increased tab cache size from 10 to 30

- 侧边栏新增本地图谱面板，支持暗色主题、动态缩放与顶部控制栏
- 新增在侧边栏显示属性面板的选项
- Mermaid 图表新增缩放功能
- 标签页缓存上限从 10 提升至 30

### Bug Fixes / 问题修复

- Fixed animation listener accumulation during rapid navigation
- Improved font rendering and line height in note style

- 修复快速导航时动画监听器堆积的问题
- 优化笔记样式的字体渲染与行高

---

## Version 1.1.1

### Installation

1. Download `minimalism-ui.zip` from the [Releases](../../releases) page
2. Unzip it directly into your vault's `.obsidian/plugins/` directory
3. In Obsidian: **Settings → Community Plugins → enable Minimalism UI**

The zip extracts to an `obsidian-minimalism-ui/` folder that includes `main.js`, `manifest.json`, `styles.css`, and the bundled `fonts/` directory — no extra steps needed.

### 安装

1. 在 [Releases](../../releases) 页面下载 `minimalism-ui.zip`
2. 将压缩包直接解压到库的 `.obsidian/plugins/` 目录中
3. 在 Obsidian 中：**设置 → 第三方插件 → 启用 Minimalism UI**

压缩包解压后得到 `obsidian-minimalism-ui/` 文件夹，已包含 `main.js`、`manifest.json`、`styles.css` 及 `fonts/` 目录，无需额外操作。

---

### What's New / 新增功能

- Removed outline-jump smooth scroll (unstable behavior on long-distance navigation, feature dropped entirely)

- 移除大纲跳转平滑滚动功能（行为在长距离跳转时不稳定，已整体下线）

### Bug Fixes / 问题修复

- Fixed callout losing its container div and breaking styles when selected in Live Preview
- Fixed missing outer border on tables in edit mode

- 修复编辑模式下 callout 被选中时外层容器消失、样式崩塌的问题
- 修复编辑模式下表格缺少外边框的问题

---

## Version 1.0.0

### Installation

1. Download `minimalism-ui.zip` from the [Releases](../../releases) page
2. Unzip it directly into your vault's `.obsidian/plugins/` directory
3. In Obsidian: **Settings → Community Plugins → enable Minimalism UI**

The zip extracts to an `obsidian-minimalism-ui/` folder that includes `main.js`, `manifest.json`, `styles.css`, and the bundled `fonts/` directory — no extra steps needed.

### 安装

1. 在 [Releases](../../releases) 页面下载 `minimalism-ui.zip`
2. 将压缩包直接解压到库的 `.obsidian/plugins/` 目录中
3. 在 Obsidian 中：**设置 → 第三方插件 → 启用 Minimalism UI**

压缩包解压后得到 `obsidian-minimalism-ui/` 文件夹，已包含 `main.js`、`manifest.json`、`styles.css` 及 `fonts/` 目录，无需额外操作。

---

### What's New / 新增功能

- **Minimal Sidebar** — Typora-style left sidebar with fixed Outline (top) and Properties (bottom).
- **Minimal Info Bar** — Hides all secondary sidebar panels (file list, search, bookmarks, etc.).
- **Note Style** — Source Han Sans for Chinese, JetBrains Mono for code/numbers; redesigned blockquotes, tables, code blocks; rounded corners with deep-blue accent.
- **Home Note** — Auto-opens a specified note on startup and returns to it when all tabs are closed.
- **Single-Page Mode** — One note at a time with smart cache (up to 30 notes) and independent navigation history (back / forward).
- **Page Transition (Beta)** — Slide-in animation when navigating: left for back, right for forward.

- **极简侧边栏** — Typora 风格左侧边栏，固定显示大纲（上）和笔记属性（下）。
- **极简信息栏** — 隐藏所有侧边栏二级面板（文件列表、搜索、书签等）。
- **笔记样式** — 中文使用思源黑体，代码/数字使用 JetBrains Mono；引用块、表格、代码块视觉重构；整体圆角，深蓝主色调。
- **笔记首页** — 启动时自动打开指定笔记，所有标签页关闭后自动跳回。
- **单页模式** — 一次只看一篇笔记，智能缓存最多 30 篇，维护独立的前进/后退导航历史。
- **页面加载动画（Beta）** — 前进/后退切换时内容区滑入动画：后退左滑，前进右滑。
