import { App, EventRef, FileSystemAdapter, MarkdownView, Modal, Notice, Plugin, TFile, ToggleComponent, WorkspaceLeaf, normalizePath, setIcon } from 'obsidian';
import { Feature } from '../core/Feature';
import { t } from '../core/i18n';

// Obsidian 内部命令执行口（未出现在官方类型声明中，同 RightSidebarButtonManager 里
// app.viewRegistry 的取用方式——仅取本文件需要的这一个方法）。
type CommandExecutor = { executeCommandById(id: string): boolean };
// Electron 的 shell 模块：桌面端渲染进程可通过 window.require 拿到（isDesktopOnly 插件），
// 用于调起系统默认程序打开文件；同样不引入 @types/electron，只声明用到的这一个方法。
type ElectronShell = { openPath(path: string): Promise<string> };

// 菜单图标：状态栏常驻的"更多操作"入口。
const TRIGGER_ICON = 'ellipsis-vertical';

const POPOVER_CLASS = 'minimalism-ui-status-popover';
const POPOVER_WIDTH = 265;
const POPOVER_GAP = 8;
const VIEWPORT_MARGIN = 8;

type NoteMode = 'locked' | 'edit' | 'source';

/**
 * StatusBarMenuManager — 状态栏"操作菜单"入口。
 *
 * 常驻状态栏一个图标按钮，点击弹出自绘悬浮卡片（非原生 Menu，样式对齐设计稿：分段控件 +
 * 列表行 + 原生风格开关），收纳：
 *   1. 笔记三态切换（锁定=阅读 mode:'preview' / 编辑=实时预览 mode:'source',source:false /
 *      源码=源码模式 mode:'source',source:true）——与 EditorStatusManager 的阅读/编辑两态锁图标
 *      是完全独立的第二入口，互不影响、互不复用状态。分段控件点击后原地刷新高亮，不关闭面板。
 *   2. 重命名 / 删除当前笔记（分别弹出 RenameModal / ConfirmDeleteModal 二次确认，点击后关闭本面板）。
 *   3. 左侧边栏（workspace.leftSplit）、右侧边栏悬浮面板（RightSidebarButtonManager）的显示/隐藏，
 *      用 Obsidian 原生 ToggleComponent（与 Settings 页一致的开关样式），保持主题一致、不关闭面板。
 *
 * 面板挂在 activeDocument.body，优先定位于触发图标正上方展开；若图标被 DragBarManager
 * 挪到顶部拖拽栏、上方空间不足，positionPopover() 会自动改为向下展开（见其注释）。
 * 每次 open() 都重新创建 DOM（内容依赖当次的活动文件/模式，重建比増量 diff 更简单可靠）。
 *
 * 触发图标用 plugin.addStatusBarItem() 创建，会随 DragBarManager 把整个原生 .status-bar
 * 容器搬进拖拽栏右侧一并迁移，无需额外接线。
 */
export class StatusBarMenuManager implements Feature {
	private statusBarItem: HTMLElement | null = null;
	private popoverEl: HTMLElement | null = null;
	private outsideClickHandler: ((e: MouseEvent) => void) | null = null;
	private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
	// 面板开着时才需要保活的左右侧边栏开关引用，用于状态变化回调里原地刷新（见 refreshSidebarToggles）。
	private leftSidebarToggle: ToggleComponent | null = null;
	private rightSidebarToggle: ToggleComponent | null = null;
	private resizeEventRef: EventRef | null = null;
	private unsubscribeRightSidebar: (() => void) | null = null;

	constructor(
		private app: App,
		private plugin: Plugin,
		private rightSidebar: { togglePanel(): void; isPanelOpen(): boolean; onStateChange(cb: () => void): () => void },
	) {}

	apply(): void {
		this.remove();

		this.statusBarItem = this.plugin.addStatusBarItem();
		this.statusBarItem.addClass('minimalism-ui-status-menu');
		setIcon(this.statusBarItem, TRIGGER_ICON);
		this.statusBarItem.setAttribute('aria-label', t('statusBarMenuLabel'));
		this.statusBarItem.setAttribute('data-tooltip-position', 'top');

		this.statusBarItem.addEventListener('click', (e: MouseEvent) => {
			e.stopPropagation();
			this.toggle();
		});

		// 左侧边栏的显示/隐藏可以经由很多路径触发（快捷键、命令面板、原生折叠箭头、拖拽分栏
		// 边框、窗口变窄自动折叠……），逐一拦截触发源不现实。'resize' 是 Obsidian 提供的效果层
		// 事件——任何 WorkspaceItem 尺寸变化（含侧边栏折叠/展开）都会触发它，因此只需订阅这一个
		// 事件即可覆盖全部触发路径。
		this.resizeEventRef = this.app.workspace.on('resize', () => this.refreshSidebarToggles());
		// 右侧悬浮面板是本插件自绘的 DOM（非真实 rightSplit 的 collapse/expand），点击右下角
		// 悬浮按钮本身不会触发上面的 'resize' 事件——单独订阅 RightSidebarButtonManager 自己的
		// 开关态变化（见其 onStateChange 注释），覆盖“直接点悬浮按钮”这条路径。
		this.unsubscribeRightSidebar = this.rightSidebar.onStateChange(() => this.refreshSidebarToggles());
	}

	remove(): void {
		this.close();
		if (this.resizeEventRef) {
			this.app.workspace.offref(this.resizeEventRef);
			this.resizeEventRef = null;
		}
		if (this.unsubscribeRightSidebar) {
			this.unsubscribeRightSidebar();
			this.unsubscribeRightSidebar = null;
		}
		if (this.statusBarItem) {
			this.statusBarItem.remove();
			this.statusBarItem = null;
		}
	}

	// 面板开着时，把左右两个开关的显示值刷新为当前真实状态。只调 setValue（不触发 onChange，
	// 不会导致 collapse()/expand() 被重复调用形成回路），也不走 renderContent() 整体重建，
	// 避免打断用户正在操作的笔记三态分段控件。
	private refreshSidebarToggles(): void {
		if (!this.popoverEl) return;
		const leftSplit = this.app.workspace.leftSplit ?? null;
		this.leftSidebarToggle?.setValue(leftSplit ? !leftSplit.collapsed : false);
		this.rightSidebarToggle?.setValue(this.rightSidebar.isPanelOpen());
	}

	private toggle(): void {
		if (this.popoverEl) this.close(); else this.open();
	}

	private open(): void {
		this.popoverEl = activeDocument.body.createDiv({ cls: POPOVER_CLASS });
		this.renderContent();
		this.positionPopover();

		this.outsideClickHandler = (e: MouseEvent) => {
			const path = e.composedPath();
			if (this.popoverEl && path.includes(this.popoverEl)) return;
			if (this.statusBarItem && path.includes(this.statusBarItem)) return;
			this.close();
		};
		activeDocument.addEventListener('click', this.outsideClickHandler);

		this.keydownHandler = (e: KeyboardEvent) => {
			if (e.key !== 'Escape') return;
			e.stopPropagation();
			this.close();
		};
		activeDocument.addEventListener('keydown', this.keydownHandler);
	}

	private close(): void {
		if (this.outsideClickHandler) {
			activeDocument.removeEventListener('click', this.outsideClickHandler);
			this.outsideClickHandler = null;
		}
		if (this.keydownHandler) {
			activeDocument.removeEventListener('keydown', this.keydownHandler);
			this.keydownHandler = null;
		}
		this.popoverEl?.remove();
		this.popoverEl = null;
		this.leftSidebarToggle = null;
		this.rightSidebarToggle = null;
	}

	// 优先在触发图标正上方展开；但触发图标可能被 DragBarManager 挪到顶部拖拽栏（此时
	// rect.top 很小，上方空间不够），这种情况下自动改为向下展开——用实测的面板高度
	// 和触发图标上下两侧的剩余空间做判断，而非假设状态栏一定在视口底部。
	private positionPopover(): void {
		if (!this.popoverEl || !this.statusBarItem) return;
		const rect = this.statusBarItem.getBoundingClientRect();

		let left = rect.right - POPOVER_WIDTH;
		left = Math.max(VIEWPORT_MARGIN, Math.min(left, activeWindow.innerWidth - POPOVER_WIDTH - VIEWPORT_MARGIN));

		// 先定宽并隐藏測高：宽度会影响文本换行，必须先设宽再量高度才准确。
		this.popoverEl.setCssStyles({
			position: 'fixed',
			left: `${left}px`,
			top: '0px',
			width: `${POPOVER_WIDTH}px`,
			visibility: 'hidden',
		});
		const height = this.popoverEl.getBoundingClientRect().height;

		const spaceAbove = rect.top - POPOVER_GAP;
		const spaceBelow = activeWindow.innerHeight - rect.bottom - POPOVER_GAP;
		const openUpward = spaceAbove >= height || spaceAbove >= spaceBelow;
		let top = openUpward ? rect.top - POPOVER_GAP - height : rect.bottom + POPOVER_GAP;
		top = Math.max(VIEWPORT_MARGIN, Math.min(top, activeWindow.innerHeight - height - VIEWPORT_MARGIN));

		this.popoverEl.setCssStyles({ top: `${top}px`, visibility: 'visible' });
	}

	private renderContent(): void {
		if (!this.popoverEl) return;
		this.popoverEl.empty();

		const leaf = this.app.workspace.getActiveViewOfType(MarkdownView)?.leaf ?? null;
		const file = this.app.workspace.getActiveFile();

		this.renderModeSegment(this.popoverEl, leaf);
		this.popoverEl.createDiv({ cls: 'minimalism-ui-status-popover-divider' });
		this.renderFileRows(this.popoverEl, file);
		this.popoverEl.createDiv({ cls: 'minimalism-ui-status-popover-divider' });
		this.renderSidebarRows(this.popoverEl);
	}

	// ─── 笔记三态切换（分段控件） ───────────────────────────────────────────

	private getNoteMode(leaf: WorkspaceLeaf | null): { mode: NoteMode | null; state: Record<string, unknown> | undefined } {
		const viewState = leaf?.getViewState();
		const mode = viewState?.state?.mode as string | undefined;
		const source = viewState?.state?.source as boolean | undefined;
		let current: NoteMode | null = null;
		if (mode === 'preview') current = 'locked';
		else if (mode === 'source' && source === false) current = 'edit';
		else if (mode === 'source' && source === true) current = 'source';
		return { mode: current, state: viewState?.state };
	}

	private renderModeSegment(container: HTMLElement, leaf: WorkspaceLeaf | null): void {
		const segment = container.createDiv({ cls: 'minimalism-ui-status-popover-segment' });
		const { mode: current } = this.getNoteMode(leaf);
		const disabled = !leaf;

		const options: { mode: NoteMode; label: string; icon: string; viewMode: string; source: boolean }[] = [
			{ mode: 'locked', label: t('statusBarMenuModeLocked'), icon: 'lock', viewMode: 'preview', source: false },
			{ mode: 'edit', label: t('statusBarMenuModeEdit'), icon: 'pencil', viewMode: 'source', source: false },
			{ mode: 'source', label: t('statusBarMenuModeSource'), icon: 'code-2', viewMode: 'source', source: true },
		];

		for (const opt of options) {
			const btn = segment.createDiv({
				cls: `minimalism-ui-status-popover-segment-btn${current === opt.mode ? ' is-active' : ''}${disabled ? ' is-disabled' : ''}`,
				attr: { 'aria-label': opt.label, 'data-tooltip-position': 'top' },
			});
			setIcon(btn, opt.icon);
			if (disabled) continue;
			btn.addEventListener('click', (e) => {
				e.stopPropagation();
				const viewState = leaf!.getViewState();
				void leaf!.setViewState({
					...viewState,
					state: { ...viewState.state, mode: opt.viewMode, source: opt.source },
				}).then(() => this.renderContent());
			});
		}
	}

	// ─── 重命名 / 删除 / 导出 PDF / 用默认软件打开 ────────────────────────────

	private renderFileRows(container: HTMLElement, file: TFile | null): void {
		const disabled = !file;

		this.createActionRow(container, {
			icon: 'pencil-line',
			label: t('statusBarMenuRename'),
			disabled,
			onClick: () => { new RenameModal(this.app, file!).open(); this.close(); },
		});

		this.createActionRow(container, {
			icon: 'trash-2',
			label: t('statusBarMenuDelete'),
			disabled,
			warning: true,
			onClick: () => { new ConfirmDeleteModal(this.app, file!).open(); this.close(); },
		});

		this.createActionRow(container, {
			icon: 'file-output',
			label: t('statusBarMenuExportPdf'),
			disabled,
			onClick: () => { this.exportToPdf(); this.close(); },
		});

		this.createActionRow(container, {
			icon: 'external-link',
			label: t('statusBarMenuOpenDefaultApp'),
			disabled,
			onClick: () => { this.openWithDefaultApp(file!); this.close(); },
		});
	}

	private createActionRow(
		container: HTMLElement,
		opts: { icon: string; label: string; disabled: boolean; warning?: boolean; onClick: () => void },
	): void {
		const cls = ['minimalism-ui-status-popover-row', opts.warning ? 'is-warning' : '', opts.disabled ? 'is-disabled' : '']
			.filter(Boolean).join(' ');
		const row = container.createDiv({ cls });
		const iconEl = row.createDiv({ cls: 'minimalism-ui-status-popover-row-icon' });
		setIcon(iconEl, opts.icon);
		row.createSpan({ cls: 'minimalism-ui-status-popover-row-label', text: opts.label });
		if (opts.disabled) return;
		row.addEventListener('click', (e) => {
			e.stopPropagation();
			opts.onClick();
		});
	}

	// Obsidian 内置的"导出为 PDF"命令（不在公开类型声明里，同上用局部类型取用）。
	private exportToPdf(): void {
		const commands = (this.app as unknown as { commands?: CommandExecutor }).commands;
		const ok = commands?.executeCommandById('workspace:export-pdf') ?? false;
		if (!ok) new Notice(t('statusBarMenuExportPdfFailed'));
	}

	// 桌面端（isDesktopOnly）用 Electron shell 调起系统默认程序打开文件的绝对路径。
	private openWithDefaultApp(file: TFile): void {
		const adapter = this.app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) return;
		const fullPath = adapter.getFullPath(file.path);
		const req = (activeWindow as unknown as { require?: (id: string) => { shell: ElectronShell } }).require;
		if (!req) return;
		void req('electron').shell.openPath(fullPath);
	}

	// ─── 左右侧边栏显示/隐藏（原生风格开关） ─────────────────────────────────

	private renderSidebarRows(container: HTMLElement): void {
		const leftSplit = this.app.workspace.leftSplit ?? null;

		const leftRow = container.createDiv({ cls: 'minimalism-ui-status-popover-row is-static' });
		const leftIcon = leftRow.createDiv({ cls: 'minimalism-ui-status-popover-row-icon' });
		setIcon(leftIcon, 'panel-left');
		leftRow.createSpan({ cls: 'minimalism-ui-status-popover-row-label', text: t('statusBarMenuToggleLeftSidebar') });
		const leftToggleEl = leftRow.createDiv();
		this.leftSidebarToggle = new ToggleComponent(leftToggleEl)
			.setValue(leftSplit ? !leftSplit.collapsed : false)
			.setDisabled(!leftSplit)
			.onChange((value) => {
				if (!leftSplit) return;
				if (value) leftSplit.expand(); else leftSplit.collapse();
			});

		const rightRow = container.createDiv({ cls: 'minimalism-ui-status-popover-row is-static' });
		const rightIcon = rightRow.createDiv({ cls: 'minimalism-ui-status-popover-row-icon' });
		setIcon(rightIcon, 'panel-right');
		rightRow.createSpan({ cls: 'minimalism-ui-status-popover-row-label', text: t('statusBarMenuToggleRightSidebar') });
		const rightToggleEl = rightRow.createDiv();
		this.rightSidebarToggle = new ToggleComponent(rightToggleEl)
			.setValue(this.rightSidebar.isPanelOpen())
			.onChange(() => this.rightSidebar.togglePanel());
	}
}

// ─── Modals ─────────────────────────────────────────────────────────────────

class RenameModal extends Modal {
	private newName: string;

	constructor(app: App, private file: TFile) {
		super(app);
		this.newName = file.basename;
	}

	onOpen(): void {
		this.setTitle(t('renameModalTitle'));

		const inputEl = this.contentEl.createEl('input', {
			type: 'text',
			value: this.newName,
			attr: { placeholder: t('renameModalPlaceholder') },
		});
		inputEl.setCssStyles({ width: '100%' });
		inputEl.focus();
		inputEl.select();
		inputEl.addEventListener('input', () => { this.newName = inputEl.value; });
		inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				void this.submit();
			}
		});

		const buttonRow = this.contentEl.createDiv();
		buttonRow.setCssStyles({ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' });

		const cancelBtn = buttonRow.createEl('button', { text: t('renameModalCancel') });
		cancelBtn.addEventListener('click', () => this.close());

		const confirmBtn = buttonRow.createEl('button', { text: t('renameModalConfirm'), cls: 'mod-cta' });
		confirmBtn.addEventListener('click', () => void this.submit());
	}

	private async submit(): Promise<void> {
		const trimmed = this.newName.trim();
		if (!trimmed || trimmed === this.file.basename) {
			this.close();
			return;
		}
		const parentPath = this.file.parent?.path;
		const newPath = normalizePath(parentPath ? `${parentPath}/${trimmed}.${this.file.extension}` : `${trimmed}.${this.file.extension}`);
		await this.app.fileManager.renameFile(this.file, newPath);
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

class ConfirmDeleteModal extends Modal {
	constructor(app: App, private file: TFile) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(t('deleteModalTitle'));
		this.contentEl.createEl('p', { text: `${t('deleteModalMessage')} (${this.file.basename})` });

		const buttonRow = this.contentEl.createDiv();
		buttonRow.setCssStyles({ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' });

		const cancelBtn = buttonRow.createEl('button', { text: t('deleteModalCancel') });
		cancelBtn.addEventListener('click', () => this.close());

		const confirmBtn = buttonRow.createEl('button', { text: t('deleteModalConfirm'), cls: 'mod-warning' });
		confirmBtn.addEventListener('click', () => {
			void this.app.fileManager.trashFile(this.file).then(() => this.close());
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
