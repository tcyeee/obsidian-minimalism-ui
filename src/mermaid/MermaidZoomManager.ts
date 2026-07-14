import { App, EventRef } from 'obsidian';

/**
 * MermaidZoomManager
 *
 * 为 .mermaid 容器添加点击切换行为：
 *   - 默认（超宽图表）：缩放至填满容器宽度，显示全图（cursor: zoom-in 提示可放大）
 *   - 点击后展开：SVG 原始尺寸，超出时横向滚动（cursor: zoom-out 提示可收回）
 *   - 再次点击恢复默认全图视图
 *
 * CSS 状态由两个 class 驱动：
 *   .mermaid-overflows  — SVG 自然宽度超出容器（超宽标记）
 *   .mermaid-fit-view   — 当前处于缩放适配状态（默认为超宽图表添加此 class）
 *
 * 超宽判断使用 SVG width 属性（Mermaid 渲染时写入自然像素宽度），
 * 而非 scrollWidth，避免在 fit-view 状态下 SVG 已被 CSS 压缩导致误判。
 *
 * 弹出窗口（popout）有自己独立的 document，需要逐一挂载监听；apply() 时先挂到主窗口和
 * 已存在的弹出窗口，再监听 window-open/window-close 跟进新开/关闭的窗口。
 */
export class MermaidZoomManager {
    private readonly app: App;
    private readonly clickHandler: (e: MouseEvent) => void;
    private readonly observers = new Map<Document, MutationObserver>();
    private windowOpenRef: EventRef | null = null;
    private windowCloseRef: EventRef | null = null;

    constructor(app: App) {
        this.app = app;
        this.clickHandler = this.onClick.bind(this);
    }

    apply() {
        this.remove();

        this.attachToDocument(activeDocument);

        const seen = new Set<Document>([activeDocument]);
        this.app.workspace.iterateAllLeaves((leaf) => {
            const doc = leaf.view.containerEl.ownerDocument;
            if (!seen.has(doc)) {
                seen.add(doc);
                this.attachToDocument(doc);
            }
        });

        this.windowOpenRef = this.app.workspace.on('window-open', (_win, win) => {
            this.attachToDocument(win.document);
        });
        this.windowCloseRef = this.app.workspace.on('window-close', (_win, win) => {
            this.detachFromDocument(win.document);
        });
    }

    remove() {
        if (this.windowOpenRef) this.app.workspace.offref(this.windowOpenRef);
        if (this.windowCloseRef) this.app.workspace.offref(this.windowCloseRef);
        this.windowOpenRef = null;
        this.windowCloseRef = null;
        for (const doc of Array.from(this.observers.keys())) this.detachFromDocument(doc);
    }

    // ─── Private ──────────────────────────────────────────────────────────────

    private attachToDocument(doc: Document) {
        if (this.observers.has(doc)) return;

        doc.addEventListener('click', this.clickHandler, true);

        // 监听 DOM 变化：Mermaid 图表是异步渲染的，SVG 在笔记打开后才插入
        const mutationObs = new MutationObserver((mutations) => {
            for (const m of mutations) {
                for (const node of Array.from(m.addedNodes)) {
                    if (!node.instanceOf(Element)) continue;
                    if (node.classList.contains('mermaid')) {
                        this.scheduleMarkOverflow(node as HTMLElement);
                    } else {
                        node.querySelectorAll<HTMLElement>('.mermaid').forEach(el => this.scheduleMarkOverflow(el));
                    }
                }
            }
        });
        mutationObs.observe(doc.body, { childList: true, subtree: true });
        this.observers.set(doc, mutationObs);

        // 处理已存在的图表
        doc.querySelectorAll<HTMLElement>('.mermaid').forEach(el => this.scheduleMarkOverflow(el));
    }

    private detachFromDocument(doc: Document) {
        const obs = this.observers.get(doc);
        if (!obs) return;
        obs.disconnect();
        this.observers.delete(doc);
        doc.removeEventListener('click', this.clickHandler, true);
        doc.querySelectorAll<HTMLElement>('.mermaid').forEach(el => {
            el.classList.remove('mermaid-fit-view', 'mermaid-overflows');
        });
    }

    private onClick(e: MouseEvent) {
        const mermaidEl = (e.target as Element).closest<HTMLElement>('.mermaid');
        if (!mermaidEl || !mermaidEl.classList.contains('mermaid-overflows')) return;

        if (mermaidEl.classList.contains('mermaid-fit-view')) {
            // 展开为 100% 原始尺寸
            mermaidEl.classList.remove('mermaid-fit-view');
        } else {
            // 收回为全图 fit-view
            mermaidEl.classList.add('mermaid-fit-view');
        }
    }

    /** 等一帧再检查，确保 SVG 已完成渲染并写入 width 属性 */
    private scheduleMarkOverflow(el: HTMLElement) {
        const win = el.ownerDocument.defaultView ?? window;
        win.requestAnimationFrame(() => this.markOverflow(el));
    }

    private markOverflow(el: HTMLElement) {
        const svg = el.querySelector('svg');
        if (!svg) return;

        // 使用 SVG width 属性判断自然宽度，不受当前 CSS 状态影响
        const naturalWidth = parseFloat(svg.getAttribute('width') ?? '0');
        const containerWidth = el.clientWidth;
        const overflows = naturalWidth > containerWidth + 2;

        el.classList.toggle('mermaid-overflows', overflows);

        // 超宽图表默认进入 fit-view（显示全图）；不超宽则不加
        if (overflows) {
            el.classList.add('mermaid-fit-view');
        } else {
            el.classList.remove('mermaid-fit-view');
        }
    }
}
