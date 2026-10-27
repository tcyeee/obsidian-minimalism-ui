import { App, FuzzySuggestModal, TFile } from 'obsidian';
import { t } from '../core/i18n';

/** 笔记卡片空白态里"选择笔记"按钮用的全库 markdown 笔记模糊搜索弹窗。 */
export class NoteSuggestModal extends FuzzySuggestModal<TFile> {
	constructor(app: App, private onChoose: (file: TFile) => void) {
		super(app);
		this.setPlaceholder(t('noteCardSuggestPlaceholder'));
	}

	getItems(): TFile[] {
		return this.app.vault.getMarkdownFiles();
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile): void {
		this.onChoose(file);
	}
}
