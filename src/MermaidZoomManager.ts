import { App } from 'obsidian';

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
 */
export class MermaidZoomManager {
    private readonly app: App;
    private readonly getSettings: () => { noteStyle: boolean };
    private readonly clickHandler: (e: MouseEvent) => void;
    private mutationObs: MutationObserver | null = null;

    constructor(app: App, getSettings: () => { noteStyle: boolean }) {
        this.app = app;
        this.getSettings = getSettings;
        this.clickHandler = this.onClick.bind(this);
    }

    apply() {
        document.addEventListener('click', this.clickHandler, true);

        // 监听 DOM 变化：Mermaid 图表是异步渲染的，SVG 在笔记打开后才插入
        this.mutationObs = new MutationObserver((mutations) => {
            for (const m of mutations) {
                for (const node of Array.from(m.addedNodes)) {
                    if (!(node instanceof Element)) continue;
                    if (node.classList.contains('mermaid')) {
                        this.scheduleMarkOverflow(node as HTMLElement);
                    } else {
                        node.querySelectorAll<HTMLElement>('.mermaid').forEach(el => this.scheduleMarkOverflow(el));
                    }
                }
            }
        });
        this.mutationObs.observe(document.body, { childList: true, subtree: true });

        // 处理已存在的图表
        document.querySelectorAll<HTMLElement>('.mermaid').forEach(el => this.scheduleMarkOverflow(el));
    }

    remove() {
        document.removeEventListener('click', this.clickHandler, true);
        this.mutationObs?.disconnect();
        this.mutationObs = null;
        document.querySelectorAll<HTMLElement>('.mermaid').forEach(el => {
            el.classList.remove('mermaid-fit-view', 'mermaid-overflows');
        });
    }

    // ─── Private ──────────────────────────────────────────────────────────────

    private onClick(e: MouseEvent) {
        if (!this.getSettings().noteStyle) return;
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
        requestAnimationFrame(() => this.markOverflow(el));
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
