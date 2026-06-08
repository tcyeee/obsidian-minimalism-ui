# Newspaper — 设计说明

移植自 Typora **Newsprint** 主题。一份报刊读物的观感：奶白纸张、近黑衬线字、报头式分隔线。

## 调色板

| 角色 | 色值 |
|---|---|
| 纸张背景 | `#f3f2ee` |
| 正文文字 | `#1f0909` |
| 链接 | `#065588` |
| 引用块文字 | `#656565` |
| 引用块边框 | `#bababa` |
| 代码/表头灰块 | `#dadada` |
| 隔行底色 | `#e8e7e7` |
| 分隔线 | `#c5c5c5` |
| 选区底色 | `rgba(32, 43, 51, 0.63)` |

## 字体

不 bundle 字体（避免改 `FontLoader.ts`，见 README §6）。CSS 用衬线字体栈：

```
'PT Serif', Georgia, 'Times New Roman', 'Songti SC', 'Noto Serif CJK SC', 'SimSun', serif
```

用户本机装了 PT Serif 自动启用，否则优雅回退到 Georgia / 宋体。代码块用系统等宽栈。

## 设计要点

- **纸张背景强制套用**：正文内容区（reading + edit）强制 `#f3f2ee` 奶白底 + 近黑字，明/暗底色下都呈亮色调，还原报刊纸感。
- **整片纸感延伸到 chrome**：奶白底铺到侧边栏 `.workspace-leaf-content`、左右 split、vault profile、顶部拖拽栏 `.minimalism-ui-drag-bar`，让单页阅读连成一整张报纸。
  - 侧边栏的 chrome 配色（背景 / 文字 / 分区标题 / 导航项 hover-active / vault profile）原本写在 `styles.css`、是 Forest 专属的深色方案，现已迁回各主题 CSS。newspaper 用 `* { color: #4a3838 }` 直接把整片侧边栏文字铺成报刊深墨（不依赖 `--text-*` 变量，故明/暗底色下都一致），分区标题用 `#1f0909`，导航项 hover/active 用暖灰（`#e8e7e7` / `#dadada`）替代 Forest 的蓝色 accent。
- **h1 报头线**：标题 + 笔记 `inline-title` 底部一道 `#c5c5c5` 细线，模拟报头分栏。
- **引用块**：斜体灰字 + 5px 左实线，无背景、无圆角，区别于 Forest 的圆角色块风。
- **表格**：表头灰底 + 大写字母 + 加粗，隔行浅灰，典型报表样式。
- 阅读视图与编辑视图（CodeMirror 6 / Live Preview）成对覆盖。
