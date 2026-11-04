import { ItemView, WorkspaceLeaf, TFile, MarkdownRenderer, ViewStateResult } from 'obsidian';
import { t } from '../core/i18n';
import { NoteSuggestModal } from './NoteSuggestModal';

export const VIEW_TYPE_NOTE_CARD = 'minimalism-ui-note-card';

interface NoteCardState {
	[key: string]: unknown;
	file: string | null;
	// 这张卡片对应的 SidebarSlot.id——LeftSidebarManager 建 / 认领 leaf 时写入，用来在
	// 允许多张卡片共存的新架构里区分"这是哪一个 slot"（见 LeftSidebarManager.slotKeyOf）
	// 以及把 settings.noteCardBindings 的读写分流到各自的 slot，不再共用一个全局值。
	slotId?: string;
}

// settings.noteCardBindings 的读写口子，按 slotId 分流（为什么需要这一层兜底、与另外两层
// 持久化的关系，见该字段注释——这里不重复）。
export interface NoteCardPersistence {
	getLastFile(slotId: string): string | null;
	setLastFile(slotId: string, path: string | null): void;
}

/**
 * NoteCardView — 只读展示单篇笔记的侧栏卡片面板。
 *
 * 与左侧栏 slot / 大纲 / 属性等面板不同：这个 view 绑定的文件与 workspace 的 activeLeaf
 * 无关，只由用户在空白态点「选择笔记」改变——在主区切换到别的笔记、或关闭原笔记，都不影响
 * 它的展示内容。绑定状态的三层持久化（内存 boundFile / workspace.json / settings.
 * noteCardBindings）见 settings.ts 的 `noteCardBindings` 字段注释；本类只管第 1 层，
 * setState() 在传入的 state 里找不到 `file` 这个 key 时落到 NoteCardPersistence 读第 3 层。
 *
 * 一旦绑定，面板内部不再提供改绑 / 解绑入口：要换一篇笔记，去设置页删掉这个 slot 再新增
 * 一个——新 slot 必然带一个全新的 id，而这个 id 在 state 和 settings.noteCardBindings 里都
 * 从未出现过，天然是干净未绑定的（见下方 setState：两边都查不到就是 null，不会把别的 slot
 * 的绑定带过来）。这样"面板当前绑定的是哪篇笔记"始终只有设置页这一个修改入口，不会出现
 * "悬浮点一下就意外解绑"的情况。
 *
 * 字段故意不叫 `file`：SinglePageEngine / BreadcrumbRenderer 等全局导航代码按
 * `view.file` 是否存在区分"真正显示笔记内容的 FileView"（markdown/canvas/pdf）与
 * "无文件视图"，并在 leaf 缺少该 view.file 时兜底读 `getViewState().state.file`
 * （见 SinglePageEngine.filePathForLeaf）。本面板的 getState() 恰好也写了 `state.file`，
 * 一旦实例属性也叫 `file`，侧栏这个 leaf 会在 getMostRecentLeaf() 命中时被各处去重 /
 * 复用逻辑误判成"当前显示着这篇笔记的根区域 tab"，导致首页/后退复用判断错乱、面包屑
 * 把绑定的笔记当成一次真实导航。换一个不冲突的名字即可从根上避免这整类误判。
 */
export class NoteCardView extends ItemView {
	private boundFile: TFile | null = null;
	// LeftSidebarManager 在 setViewState 的 state.slotId 里告知的 slot id；setState() 收到后
	// 记下，之后 getState() 原样带回去（否则重启后这个 leaf 在 LeftSidebarManager 眼里就是
	// 「没带 slotId 的孤儿」，匹配不到任何 slot，见 LeftSidebarManager.leafSlotKey）。
	private slotId: string | null = null;
	private renderToken = 0;
	// 绑定文件 path + 内容的联合 key：render() 被重复调用但内容其实没变时据此整段跳过，
	// 避免「先 empty() 清空、再 await 重排」这段必然出现的空白间隙在视觉上闪一下。
	private lastRenderedKey: string | null = null;

	constructor(leaf: WorkspaceLeaf, private persist: NoteCardPersistence) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_NOTE_CARD;
	}

	getDisplayText(): string {
		return this.boundFile ? this.boundFile.basename : t('noteCard');
	}

	getIcon(): string {
		return 'file-text';
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass('minimalism-ui-note-card');

		// 绑定的笔记被编辑 / 改名时跟随刷新；其它笔记的变更与本面板无关，按路径过滤。
		this.registerEvent(
			this.app.vault.on('modify', (file) => {
				if (this.boundFile && file.path === this.boundFile.path) void this.render();
			}),
		);
		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				if (this.boundFile && oldPath === this.boundFile.path && file instanceof TFile) {
					this.boundFile = file;
					void this.render();
				}
			}),
		);

		await this.render();
	}

	async setFile(file: TFile): Promise<void> {
		this.boundFile = file;
		await this.render();
		// 绑定笔记后标题跟着变，需要主动通知 workspace 刷新 tab 标题。
		this.persistBinding();
		if (this.slotId) this.persist.setLastFile(this.slotId, file.path);
	}

	// requestSaveLayout() 本身是 debounced：若用户绑定后立刻刷新 Obsidian（或插件被
	// disable/enable），debounce 定时器还没触发，workspace.json 里存的还是上一次的旧绑定，
	// 刷新后看起来「绑定消失了」。.run() 是 Debouncer 公开 API，跳过等待立即落盘。
	private persistBinding(): void {
		this.app.workspace.requestSaveLayout();
		void this.app.workspace.requestSaveLayout.run();
	}

	getState(): Record<string, unknown> {
		const state: NoteCardState = { file: this.boundFile?.path ?? null };
		if (this.slotId) state.slotId = this.slotId;
		return state;
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const s = state as NoteCardState | null | undefined;
		if (s && typeof s.slotId === 'string' && s.slotId) this.slotId = s.slotId;

		// state 里确实带 `file` 这个 key（哪怕值是 null）才算「这是一次真实的状态恢复」，照单
		// 全收——它与 settings.noteCardBindings 本就该同步。state 整个缺失或没有这个 key
		// （新建 leaf 时传的 undefined，或 LeftSidebarManager park 机制令 leaf 整个脱离 workspace
		// 树、跨重启后彻底丢失自带状态的那种情况）才落到持久化的 noteCardBindings 兜底，
		// 避免用户重启后发现面板空白、必须重新选择笔记。
		const path = s && 'file' in s ? s.file : (this.slotId ? this.persist.getLastFile(this.slotId) : null);
		const restored = path ? this.app.vault.getAbstractFileByPath(path) : null;
		this.boundFile = restored instanceof TFile ? restored : null;
		await this.render();
		await super.setState(state, result);
	}

	private async render(): Promise<void> {
		// 渲染途中若又切换了文件（选择笔记连续触发、与 modify 事件竞态），
		// 丢弃过期的异步结果，避免旧内容在新内容之后才落地覆盖回去。
		const token = ++this.renderToken;

		if (!this.boundFile) {
			// '' 是「已显示空态」的哨兵值，与初始值 null（「从未渲染过」）区分开——否则首次以
			// boundFile=null 调用（新建面板 / 重启后 setState() 解析不到旧路径）时，null !== null
			// 判假，空态被错误跳过，面板真正空白、连「选择笔记」按钮都画不出来，无法再绑定。
			if (this.lastRenderedKey !== '') {
				this.contentEl.empty();
				this.renderEmptyState();
			}
			this.lastRenderedKey = '';
			return;
		}

		const content = await this.app.vault.cachedRead(this.boundFile);
		if (token !== this.renderToken) return;

		// render() 可能被重复调用（例如面板重新显示时的兜底刷新）但内容其实没变——
		// 整段跳过，现有 DOM 原封不动，不产生任何可感知的闪烁。
		const key = `${this.boundFile.path}\u0000${content}`;
		if (key === this.lastRenderedKey) return;

		// 离屏渲染完成后才整块替换当前 DOM，避免「先 empty() 清空再慢慢填回」的空白间隙。
		const target = createDiv({ cls: 'markdown-rendered' });
		await MarkdownRenderer.render(this.app, content, target, this.boundFile.path, this);
		if (token !== this.renderToken) return;

		this.contentEl.empty();
		this.contentEl.appendChild(target);
		this.lastRenderedKey = key;
	}

	private renderEmptyState(): void {
		const empty = this.contentEl.createDiv({ cls: 'minimalism-ui-note-card-empty' });
		empty.createDiv({ cls: 'minimalism-ui-note-card-empty-desc', text: t('noteCardEmptyDesc') });
		const button = empty.createEl('button', {
			cls: 'minimalism-ui-note-card-choose mod-cta',
			text: t('noteCardChooseNote'),
		});
		button.addEventListener('click', () => {
			new NoteSuggestModal(this.app, (file) => void this.setFile(file)).open();
		});
	}
}
