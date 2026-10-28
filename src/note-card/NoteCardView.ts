import { ItemView, WorkspaceLeaf, TFile, MarkdownRenderer, Menu, ViewStateResult } from 'obsidian';
import { t } from '../core/i18n';
import { NoteSuggestModal } from './NoteSuggestModal';

export const VIEW_TYPE_NOTE_CARD = 'minimalism-ui-note-card';

interface NoteCardState {
	[key: string]: unknown;
	file: string | null;
}

/**
 * NoteCardView — 只读展示单篇笔记的侧栏卡片面板。
 *
 * 与左侧栏 slot / 大纲 / 属性等面板不同：这个 view 绑定的文件与 workspace 的 activeLeaf
 * 无关，只由用户在空白态点「选择笔记」、或悬浮菜单点「解绑」改变——在主区切换到别的笔记、
 * 或关闭原笔记，都不影响它的展示内容。boundFile 落进 getState()，Obsidian 落盘 workspace.json
 * 时随 leaf 一起持久化，重启后 setState() 原样恢复绑定并重新渲染。
 *
 * 字段故意不叫 `file`：SinglePageEngine / BreadcrumbRenderer 等全局导航代码按
 * `view.file` 是否存在区分"真正显示笔记内容的 FileView"（markdown/canvas/pdf）与
 * "无文件视图"，并在 leaf 缺少该 view.file 时兜底读 `getViewState().state.file`
 * （见 SinglePageEngine.filePathForLeaf）。本面板的 getState() 恰好也写了 `state.file`，
 * 一旦实例属性也叫 `file`，侧栏这个 leaf 会在 getMostRecentLeaf() 命中时被各处去重 /
 * 复用逻辑误判成"当前显示着这篇笔记的根区域 tab"，导致首页/后退复用判断错乱、面包屑
 * 把绑定的笔记当成一次真实导航。换一个不冲突的名字即可从根上避免这整类误判。
 *
 * 右上角菜单图标默认隐藏，仅 leaf 悬浮时可见（styles.css 的 .minimalism-ui-note-card
 * hover 规则），点击弹出「解绑笔记」——保持面板空间干净，菜单只在需要时露出。
 */
export class NoteCardView extends ItemView {
	private boundFile: TFile | null = null;
	private renderToken = 0;
	// 绑定文件 path + 内容的联合 key：render() 被重复调用但内容其实没变时据此整段跳过，
	// 避免「先 empty() 清空、再 await 重排」这段必然出现的空白间隙在视觉上闪一下。
	private lastRenderedKey: string | null = null;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
		this.addAction('ellipsis-vertical', t('noteCardMenuTooltip'), (evt) => this.showMenu(evt));
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
		// 切换绑定的笔记后标题跟着变，需要主动通知 workspace 刷新 tab 标题。
		this.persistBinding();
	}

	private async unbind(): Promise<void> {
		this.boundFile = null;
		await this.render();
		this.persistBinding();
	}

	// requestSaveLayout() 本身是 debounced：若用户绑定/解绑后立刻刷新 Obsidian（或插件被
	// disable/enable），debounce 定时器还没触发，workspace.json 里存的还是上一次的旧绑定，
	// 刷新后看起来「绑定消失了」。.run() 是 Debouncer 公开 API，跳过等待立即落盘。
	private persistBinding(): void {
		this.app.workspace.requestSaveLayout();
		void this.app.workspace.requestSaveLayout.run();
	}

	getState(): Record<string, unknown> {
		const state: NoteCardState = { file: this.boundFile?.path ?? null };
		return state;
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const path = (state as NoteCardState | null)?.file ?? null;
		const restored = path ? this.app.vault.getAbstractFileByPath(path) : null;
		this.boundFile = restored instanceof TFile ? restored : null;
		await this.render();
		await super.setState(state, result);
	}

	private showMenu(evt: MouseEvent): void {
		const menu = new Menu();
		menu.addItem((item) =>
			item
				.setTitle(t('noteCardUnbind'))
				.setIcon('unlink')
				.setDisabled(!this.boundFile)
				.onClick(() => void this.unbind()),
		);
		menu.showAtMouseEvent(evt);
	}

	private async render(): Promise<void> {
		// 渲染途中若又切换了文件（选择笔记 / 解绑连续触发、与 modify 事件竞态），
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
