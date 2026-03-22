# TODO

## 单页模式：每个文件最多保留一个标签页

**目标行为：**
- 每个文件对应唯一一个 leaf，不允许同一文件在后台存在多个标签页
- 前进/后退通过切换已有 leaf 实现，而非新建
- 打开一个已经存在的文件时，切换到那个 leaf，不新建

**当前实现状态：** 待检查（见下方分析）

**已知漏洞：**
- `interceptLeafOpenFile` 只在 `getLeaf(false/undefined)` 路径上挂载拦截器
- 当 Obsidian 内部以 `getLeaf('tab')` 或 `getLeaf(true)` 打开文件时（如 Cmd+点击链接、右键"在新标签页中打开"），绕过了去重逻辑，会新建重复 leaf

**修复方案：**
- 对 `getLeaf('tab')` 和 `getLeaf(true)` 也挂载 `interceptLeafOpenFile`，实现全路径去重

---

## 极简属性栏：开启时 Properties 面板未移动到左侧边栏底部

**目标行为：**
- 开启「极简属性栏」时，将 Properties 面板移至左侧边栏，并置于最下方
- 根据笔记属性数量自动调整该面板高度（flex-grow 切换为固定高度）
- 关闭时恢复原始位置和样式

**当前实现文件：**
- `src/PropertiesAutoHeightManager.ts`（核心逻辑）
- `src/SettingTab.ts`（设置 UI）
- `main.ts` → `onLayoutReady` → `propertiesHeight.apply()`

**已定位 Bug：**

### Bug 1（主因）：SettingTab 开关未触发 apply()

`SettingTab.ts` 第 68-69 行，`autoPropertiesHeight` 的 `onChange` 仅调用 `saveSettings()`，**没有调用 `this.plugin.propertiesHeight.apply()`**：

```ts
// 现状（有问题）
.onChange(async v => {
    this.plugin.settings.autoPropertiesHeight = v;
    await this.plugin.saveSettings();
    // ← 缺少 this.plugin.propertiesHeight.apply()
})
```

用户在设置页开启开关后，面板不会移动。必须重启 Obsidian 才生效（因为 `apply()` 只在 `onLayoutReady` 时调用一次）。

### Bug 2（次因）：macSidebar 联动缺失

`apply()` 内部检查 `!s.macSidebar || !s.autoPropertiesHeight`，两者都需为 true 才执行。但 `macSidebar` 的 `onChange` 同样没有调用 `propertiesHeight.apply()`，导致用户先开 macSidebar 再开极简属性栏（或反之）时，功能不能正确响应。

### Bug 3（潜在）：ensureSideLeaf 私有 API 错误被静默吞掉

`ensurePropertiesInLeftSidebar()` 通过 `as unknown as {...}` 强转访问 Obsidian 私有 API `ensureSideLeaf`。若该方法不存在（Obsidian 版本差异），会抛出 `TypeError`，但由于外部以 `void this.ensurePropertiesInLeftSidebar()` 调用，Promise rejection 被静默丢弃，面板不会被移动且无任何报错提示。

**修复方案：**

1. `SettingTab.ts`：在 `autoPropertiesHeight` 和 `macSidebar` 的 `onChange` 中补充调用 `this.plugin.propertiesHeight.apply()`
2. `ensurePropertiesInLeftSidebar`：加 try-catch，`ensureSideLeaf` 调用失败时用备用方案（如 `revealLeaf` + DOM 迁移）或 console.warn 提示
