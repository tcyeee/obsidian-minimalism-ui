# BUG：侧栏 LOCAL GRAPH 在 Advanced URI 打开笔记后永久变空白

状态：**根因链已定性，只差“iframe 被谁 unload”这一步没抓到调用栈**。
交接给后续 Agent 继续定位 + 修复。

---

## 1. 现象

- 合并式左侧栏底部的 **LOCAL GRAPH** 面板，在某些跳转后变成**空白**（面板框还在、标题还在，就是不画图），且**不会自行恢复**，除非在插件设置里把「本地关系图 / Local Graph」开关关掉再打开（=重建整个侧栏）。
- 最初以为“每次切页 100% 复现”，后经复测修正为：**普通点击链接跳转不会触发**；用 `obsidian://adv-uri`（Advanced URI，实际由 `terminal` 插件转发）打开笔记时会触发。
- 用户观察到的相关性：目标是「**没有任何双链关联的笔记**（如空笔记）」时更容易出现。此相关性**未完全证实**，可能掺杂时机因素（有一次复现时 omnisearch 正在建索引）。

复现用例：`obsidian://adv-uri?filepath=src/202511261650-temporary.md` → 由 terminal 插件收到并转 adv-uri → Advanced URI 打开该文件。

环境：Obsidian 1.13.7，macOS，桌面端。插件 `minimalism-ui` 1.3.21，单页模式（`disableNoteTabs`）开启，`showLocalGraph: true`，Forest 主题。

---

## 2. 已确认的根因链（含实测证据）

### 2.1 不是尺寸 / resize 问题（排除 1.3.19 那类假设）

控制台实测（切换前 / 切换后各取一次
`app.workspace.getLeavesOfType('localgraph')[0].view.renderer`）：

```
切换前  {w: 506, h: 242, pixiAlive: true,  viewContent: '506x242', panX: 506}
切换后  {w: 506, h: 242, pixiAlive: false, viewContent: '506x242', panX: 506}
```

`.view-content` 尺寸、`renderer.width/height`、`panX` **全程不变且正常**。唯一变化：`renderer.px` 从 PIXI.Application 对象变成 `null`（`pixiAlive: !!renderer.px`）。

### 2.2 leaf / view / renderer / DOM 节点都没被重建、没被重新注入

复现后对比对象身份：

```json
{
  "localgraphLeafCount": 1,
  "sameLeaf": true, "sameView": true, "sameRenderer": true, "sameContentEl": true,
  "oldRendererPxAlive": false, "newRendererPxAlive": false,
  "oldContentElConnected": true,
  "newContentEl_inOutline": true, "newContentEl_inHiddenShell": false,
  "newContentEl_size": "506x242", "newLeafInLeftSplit": true
}
```

复现过程中 **没有** 触发 `leaf.rebuildView` / `leaf.setViewState`（对侧栏 graph leaf 打了点）。
所以：不是「view 被 Obsidian 重建」，也不是「插件的侧栏注入被顶掉后重跑」。

### 2.3 `renderer.px` 被 `destroyGraphics()` 置 null，调用来自 `onIframeUnload`

反编译 `~/Library/Application Support/obsidian/obsidian-1.13.7.asar` 里的 `app.js`：
渲染器类（压缩名 `v$`）中，`renderer.px = null` **有且只有** 两处：
构造函数初始化、以及 `destroyGraphics()` 内部。`destroyGraphics()` 的调用者只有 3 个：
`renderer.destroy()`（视图 `onClose`）、`onIframeLoad()`、`onIframeUnload()`。

对 `renderer.destroyGraphics / initGraphics / onIframeLoad / onIframeUnload` 打点后复现，抓到：

```
>>> [graph] destroyGraphics  pxBefore=true
      e.onIframeUnload @ app.js:1        ← 由 iframe 的 beforeunload 触发
>>> [graph] destroyGraphics OK  pxAfter=false
Received URL action {filepath: 'src/202511261650-temporary.md', action: 'adv-uri'}
```

且**之后没有任何 `onIframeLoad` / `initGraphics`**（没有对应的 load 日志）。

### 2.4 为什么不恢复：Obsidian 的 iframe 路径没有重试

桌面端（`!rd.isIosApp`）关系图渲染器把 PIXI canvas 放在一个 **`<iframe>`** 里
（`v$` 构造函数里 `this.iframeEl = e.createEl("iframe")`，`a.onload = this.onIframeLoad`）。

- `onIframeUnload` = `iframe.contentWindow.onbeforeunload` → `destroyGraphics()`（`px=null`，
  `renderCallback=null`，`cancelAnimationFrame`）。
- `onIframeLoad` = `iframe.onload` → `destroyGraphics(); initGraphics(canvas)`。
  **这里没有 try/catch，也没有重试**。而非 iframe 路径（`else` 分支）是
  `setTimeout(()=>{ try{initGraphics(s)}catch{ setTimeout(initGraphics, 300) } }, 50)` —— 有重试。

所以：iframe 一旦 unload 之后没能正常触发 `onIframeLoad`（或 `initGraphics` 抛了一次），
`renderer.px` 就**永久为 null**，整条渲染管线（`px` / `renderCallback` / rAF 循环）被拆掉。

### 2.5 为什么 1.3.19 的 `onResize` 守卫救不了

`SidebarLayoutManager.ts:333-343` 那个把 `graphView.onResize` 包一层、
`.view-content < 20px` 就跳过 `origOnResize()` 的守卫，**只防「WebGL canvas 被 resize 到 0」**。
本 bug 是渲染管线被 `destroyGraphics()` 整个拆掉，不是尺寸问题，守卫完全无关。

### 2.6 为什么只有 Advanced URI 触发、点链接不触发

Advanced URI 的 `plugin.open()`
（`~/Library/Mobile Documents/iCloud~md~obsidian/Documents/Lucas/.obsidian/plugins/obsidian-advanced-uri/main.js`
偏移 ~129173）：

```js
if (e instanceof TFile ? await l.openFile(e) : ... , l.view instanceof MarkdownView) {
  let c = l.getViewState();
  a != null ? c.state.mode = a : c.state = { ...c.state, ...(de(i)?.state) };
  await l.setViewState(c);          // ← 普通点链接没有这一步
}
```

**打开文件后恒定多调一次 `leaf.setViewState()`**（套 mode / eState）。
`WorkspaceLeaf.setViewState`（app.js）在「视图类型没变」时走 skip 分支，
但仍会执行 `view.setState()`、`updateHeader()`，并可能经
`onLayoutChange → updateLayout → recomputeChildrenDimensions / updateTabDisplay`
级联到左侧栏那几个 tab 组。

---

## 3. 插件侧的结构性问题（根源）

`SidebarLayoutManager.injectLocalGraphIntoOutline()`（`src/layout/SidebarLayoutManager.ts:258`）：

1. 正常建一个 `localgraph` leaf（`buildLeftSidebar`，`:163-169`）。
2. `outlineLeafContent.appendChild(graphLeafContent)`（`:305`）——把整个
   `.workspace-leaf-content[data-type="localgraph"]`（**含 iframe**）**物理搬进** outline 的 leaf-content。
3. 原来的 `.workspace-leaf` / `.workspace-tabs` 空壳留在原地，用
   `minimalism-ui-is-hidden`（`display:none`）藏掉（`:308-314`）。

后果：graph view 的 DOM 子树脱离了它在 workspace-item 树里对应的 `.workspace-leaf`。
只要 Obsidian 的布局引擎去 reconcile 那个「被掏空的 `.workspace-leaf` 空壳」所在的 tab 组
（`updateTabDisplay` 里有 `L.containerEl.parentNode !== r && r.appendChild(f)`、
`setChildrenInPlace`、单子节点 tab 组 dissolve 等重挂逻辑），
就可能把被搬走的子树 / iframe 挪位或重挂 —— 而 **iframe 在同文档内被 reparent，Chromium 也会 reload 它**
（即使 `isConnected` 仍为 true）。

代码注释（`:245-257`）解释了为何搬整个 `.workspace-leaf-content` 而不是只搬 `.view-content`：
graph view 把鼠标/滚轮监听注册在 `containerEl` 上，只搬 `.view-content` 会导致交互失效。
所以“只搬 `.view-content`”这条改法需要额外处理事件。

---

## 4. 还没定位到的一步

**到底是哪个 DOM / 属性操作让 iframe unload。** 已排除：

- 在 iframe 或其祖先链（IFRAME → `.view-content` → `.workspace-leaf-content[localgraph]`
  → `.workspace-leaf-content[outline]` → `.workspace-leaf` → `.workspace-tab-container`
  → `.workspace-tabs` → `.workspace-split.mod-left-split` → …）上调用
  `removeChild` / `insertBefore` / `appendChild` / `replaceChild` / `remove` / `replaceWith` /
  `replaceChildren` / `innerHTML=` —— **全局 `Node.prototype` / `Element.prototype` 打点后复现，一个都没抓到。**

剩余候选：

1. iframe 的某个祖先被 `appendChild`/`insertBefore` **移到新父节点**（旧父节点的 `removeChild`
   不会被调用，节点被静默 splice；而“移动到新父节点”这一侧的 receiver 不在祖先链里，
   之前基于“祖先链 receiver”和“`!isConnected`”的判断都会漏）。→ 下次要检测的是
   **“被插入的 node 是否 contains(iframe)”**，而不是 receiver 或 connectivity。
2. `iframe.src` / `srcdoc` / `sandbox` 被改（MutationObserver `attributeFilter` 兜底）。
3. `document.adoptNode` / 跨 document 移动。

**注意**：vault 里装了 `terminal` 插件，它把全局 `console` 包了一层，所有日志 call-site
都显示成 `plugin:terminal:262`，`console.trace` 的栈会被截断。定位时改用
`new Error().stack` 读字符串，或临时禁用 terminal 插件。

### 建议的下一步探针（挂上后正常用，等它自己抓）

```js
(() => {
  const arm = () => {
    const l = app.workspace.getLeavesOfType('localgraph')[0];
    if (!l?.view?.renderer) return setTimeout(arm, 1000);
    const r = l.view.renderer;
    const ifr = l.view.contentEl.querySelector('iframe');
    if (!ifr || r.__probed) return ifr ? 0 : setTimeout(arm, 1000);
    r.__probed = true;

    const o1 = r.onIframeUnload.bind(r);
    r.onIframeUnload = function (...a) {
      console.log('>>> onIframeUnload', JSON.stringify({
        iframeConnected: ifr.isConnected,
        iframeParent: ifr.parentElement?.className,
        vcInOutline: !!l.view.contentEl.closest('[data-type=outline]'),
      }));
      console.log(new Error('UNLOAD-STACK').stack);
      return o1(...a);
    };
    const o2 = r.onIframeLoad.bind(r);
    r.onIframeLoad = function (...a) { console.log('>>> onIframeLoad'); console.log(new Error('LOAD').stack); return o2(...a); };

    // 关键：检测“被插入的节点是否包含 iframe”（reparent-while-connected）
    for (const [proto, name, idx] of [[Node.prototype,'appendChild',0],[Node.prototype,'insertBefore',0],[Node.prototype,'replaceChild',1]]) {
      const orig = proto[name];
      if (orig.__w) continue;
      const w = function (...a) {
        const n = a[idx], prevParent = n instanceof Node ? n.parentElement : null;
        const r2 = orig.apply(this, a);
        if (n instanceof Node && (n === ifr || n.contains?.(ifr)) && prevParent && prevParent !== this)
          console.log('>>> REPARENT', name, '\n  node:', n.tagName+'.'+n.className,
            '\n  from:', prevParent.tagName+'.'+prevParent.className,
            '\n  to:', this.tagName+'.'+this.className, '\n', new Error().stack);
        return r2;
      };
      w.__w = true; w.__orig = orig; w.__proto = proto; w.__name = name;
      (window.__patches ??= []).push(w); proto[name] = w;
    }
    const mo = new MutationObserver(ms => ms.forEach(m => {
      if (m.type === 'attributes' && m.target === ifr) console.log('>>> iframe attr', m.attributeName, new Error().stack);
      m.removedNodes.forEach(n => (n === ifr || n.contains?.(ifr)) && console.log('>>> MO remove from', m.target.className, new Error().stack));
    }));
    mo.observe(document.body, { childList:true, subtree:true, attributes:true, attributeFilter:['src','srcdoc','sandbox'] });
    window.__unpatch = () => { (window.__patches||[]).forEach(w => w.__proto[w.__name] = w.__orig); window.__patches = []; };
    console.log('探针已挂 px=' + !!r.px);
  };
  arm();
})();
```

从**重启 Obsidian、不动设置**的自然恢复状态开始挂（用 `设置里关开本地关系图` 救活后有时不复现，
可能与启动恢复出的 leaf 状态有关）。

---

## 5. 修复方向（按优先级 / 稳健度）

1. **兜底自愈（改动小、最稳）**：注入后给 iframe 挂 `load` / `unload` 监听；或在
   `active-leaf-change` / `file-open` 后检查 `injectedGraphLeaf.view.renderer.px == null`，
   若为 null 就补一次 `initGraphics`（模拟 Obsidian 非 iframe 路径那个被省掉的 300ms 重试），
   或直接 `graphLeaf.rebuildView()` + 重新跑 `injectLocalGraphIntoOutline`。

2. **拦截触发点**：注入时监听自己这条子树的 reparent（MutationObserver），
   一旦发现 iframe 被挪位就立即把它挪回来 / 强制重建。

3. **根治**：不再物理搬 `.workspace-leaf-content` 出它的 `.workspace-leaf`。可选：
   - 只搬 `.view-content`，并把 graph view 注册在 `containerEl` 上的鼠标/滚轮事件手动转发
     （注释 `:245-257` 说明了为何当初没这么做）；
   - 让 graph leaf 作为**真正的 stacked leaf** 留在侧栏 tab 组里，纯靠 CSS `order` / flex
     调整它在合并侧栏里的视觉位置，不动 DOM 结构；
   - 用 CSS 把 graph leaf 的 `.workspace-leaf` 定位/尺寸调整到 outline 面板下方区域，
     而不是把节点搬进 outline 的 leaf-content。

4. 不建议：去 patch / 规避 Advanced URI 那次多余的 `setViewState`——太脆、且别的外部
   打开路径（`obsidian://open`、其它插件）可能有类似副作用。

---

## 6. 关键代码位置速查

插件：
- `src/layout/SidebarLayoutManager.ts:258` `injectLocalGraphIntoOutline()`
- `:305` `outlineLeafContent.appendChild(graphLeafContent)`（物理搬迁）
- `:308-314` 隐藏原 `.workspace-tabs` 空壳
- `:333-343` `graphView.onResize` 守卫（1.3.19，对本 bug 无效）
- `:356-365` 挂在 left split 上的 ResizeObserver（只在侧栏自身 resize 时触发）
- `:368-374` 注入后 200ms 的一次性 `--minimalism-ui-graph-height` + `applyGraphColors`
- `styles.css:442-504` 注入 graph 的布局 CSS（`flex: 0 0 var(--minimalism-ui-graph-height,250px)` + `max-height: 33.333%`）

Obsidian（`obsidian-1.13.7.asar` → `app.js`，压缩名）：
- 渲染器 `v$`：构造函数 iframe 分支、`onIframeLoad`（无 try/catch/重试）、`onIframeUnload`、
  `destroyGraphics`（`this.px=null`）、`initGraphics`、`onResize`、`renderCallback`（`idleFrames>60` 停）
- localgraph 视图 `l0` / 基类 `n0`：`onFileOpen → loadFile → onLoadFile → update() → renderer.resetPan() + engine.render()`
- `WorkspaceLeaf.setViewState`：同类型走 skip 分支
- `WorkspaceTabs.updateTabDisplay` / `FI.removeChild`（单子节点 tab 组 dissolve，`allowSingleChild=false`）

Advanced URI：
- `.../Lucas/.obsidian/plugins/obsidian-advanced-uri/main.js` 偏移 ~129173，`plugin.open()`
  末尾恒定 `await l.setViewState(c)`

---

## 7. 已排除的方向（别再查）

- 尺寸 / resize / WebGL 被 resize 到 0（§2.1）
- leaf / view / renderer 被重建（§2.2）
- 插件侧栏注入被重跑（§2.2，没触发 rebuildView/setViewState）
- CSS `max-height: 33.333%` 把面板压塌（`.view-content` 全程 506×242）
- `ResponsiveSidebarManager`（只监听 window `resize`）
- `SingleTabGroupGuard`（只动 root leaf，明确排除侧栏）
- `EmptyViewButtonManager` / `OnboardingManager`（只往 empty-state / body 注入按钮）
- `RightSidebarViewStack`（`MANAGED_LEFT_VIEW_TYPES` 明确排除 `localgraph`；且只在右侧悬浮面板打开时动）
- `PinManager`（只 patch `detach`，不设 `pinned` / `group`，`isLeafBoundToFile` 仍为 false）
