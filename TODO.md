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
