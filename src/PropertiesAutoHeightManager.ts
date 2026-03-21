import { App } from 'obsidian';
import { MinimalismUISettings } from './settings';

const PROPS_SELECTOR =
	'.workspace-split.mod-left-split .workspace-leaf-content[data-type="file-properties"]';

export class PropertiesAutoHeightManager {
	private mutationObserver: MutationObserver | null = null;
	private resizeObserver: ResizeObserver | null = null;
	private leafChangeHandler: (() => void) | null = null;
	private layoutHandler: (() => void) | null = null;

	// Saved inline flex-grow so remove() can restore Obsidian's original value
	private savedFlexGrow = '';

	constructor(private app: App, private getSettings: () => MinimalismUISettings) {}

	apply() {
		this.remove();
		const s = this.getSettings();
		if (!s.macSidebar || !s.autoPropertiesHeight) return;

		let rafId: number | null = null;
		const syncHeight = () => {
			const tabsEl = this.findTabsEl();
			if (!tabsEl) return;
			if (rafId !== null) cancelAnimationFrame(rafId);
			rafId = requestAnimationFrame(() => {
				rafId = null;
				const toH = this.measureContentHeight();
				if (toH <= 0) return;
				tabsEl.style.height = toH + 'px';
			});
		};

		const setupObserver = (): boolean => {
			const contentEl = document.querySelector<HTMLElement>(PROPS_SELECTOR);
			const tabsEl = contentEl?.closest<HTMLElement>('.workspace-tabs') ?? null;
			if (!contentEl || !tabsEl) return false;

			// Read current rendered height BEFORE touching flex, so we can keep
			// the panel visible while switching from flex-grow to explicit height.
			const currentH = tabsEl.offsetHeight;

			// Save Obsidian's flex-grow and switch to fixed sizing so our explicit
			// height takes full effect instead of competing with flex distribution.
			this.savedFlexGrow = tabsEl.style.flexGrow;
			tabsEl.dataset.propertiesAutoHeight = 'true';
			tabsEl.style.flexGrow = '0';
			tabsEl.style.flexShrink = '0';
			// Lock to current height immediately — prevents the panel collapsing to
			// 0 before measureContentHeight() has a chance to run.
			tabsEl.style.height = currentH + 'px';

			// MutationObserver catches property add / remove / value edits
			this.mutationObserver = new MutationObserver(syncHeight);
			this.mutationObserver.observe(contentEl, { childList: true, subtree: true });

			// ResizeObserver on .metadata-content catches height changes that
			// MutationObserver may miss (e.g. multi-line value expansion)
			const metaContent = contentEl.querySelector<HTMLElement>('.metadata-content');
			if (metaContent) {
				this.resizeObserver = new ResizeObserver(syncHeight);
				this.resizeObserver.observe(metaContent);
			}

			// Animate to content height on the next frame (CSS transition is now active)
			syncHeight();

			return true;
		};

		if (!setupObserver()) {
			this.layoutHandler = () => {
				if (setupObserver()) {
					this.app.workspace.off('layout-change', this.layoutHandler!);
					this.layoutHandler = null;
				}
			};
			this.app.workspace.on('layout-change', this.layoutHandler);
		}

		// active-leaf-change fires before Obsidian updates the properties DOM,
		// delay to let the mutations land first.
		this.leafChangeHandler = () => setTimeout(syncHeight, 80);
		this.app.workspace.on('active-leaf-change', this.leafChangeHandler);
	}

	remove() {
		this.mutationObserver?.disconnect();
		this.mutationObserver = null;
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;

		if (this.leafChangeHandler) {
			this.app.workspace.off('active-leaf-change', this.leafChangeHandler);
			this.leafChangeHandler = null;
		}
		if (this.layoutHandler) {
			this.app.workspace.off('layout-change', this.layoutHandler);
			this.layoutHandler = null;
		}

		document.querySelectorAll<HTMLElement>('.workspace-tabs[data-properties-auto-height]').forEach(el => {
			el.style.flexGrow = this.savedFlexGrow;
			el.style.flexShrink = '';
			el.style.height = '';
			delete el.dataset.propertiesAutoHeight;
		});
		this.savedFlexGrow = '';
	}

	// ── helpers ──────────────────────────────────────────────────────────────

	private findTabsEl(): HTMLElement | null {
		const contentEl = document.querySelector<HTMLElement>(PROPS_SELECTOR);
		return contentEl?.closest<HTMLElement>('.workspace-tabs') ?? null;
	}

	/**
	 * Measure the height that .workspace-tabs needs to show all properties.
	 *
	 * .metadata-content has natural (unconstrained) height — its offsetHeight is
	 * the true rendered height of all property rows.  We add:
	 *   • the gap between the top of .workspace-tabs and the top of .metadata-content
	 *     (tab-header, "PROPERTIES" label, container padding, etc.)
	 *   • the bottom padding of .workspace-leaf-content so nothing is clipped.
	 */
	private measureContentHeight(): number {
		const contentEl = document.querySelector<HTMLElement>(PROPS_SELECTOR);
		if (!contentEl) return 0;
		const tabsEl = contentEl.closest<HTMLElement>('.workspace-tabs');
		if (!tabsEl) return 0;

		const metaContent = contentEl.querySelector<HTMLElement>('.metadata-content');
		if (!metaContent) return 0;

		const tabsTop = tabsEl.getBoundingClientRect().top;
		const metaTop = metaContent.getBoundingClientRect().top;
		const topOffset = metaTop - tabsTop;           // headers + padding above properties
		const metaH = metaContent.offsetHeight;        // natural height of property rows
		const bottomPad = parseFloat(getComputedStyle(contentEl).paddingBottom) || 8;

		return Math.round(topOffset + metaH + bottomPad);
	}
}
