import { MinimalismUISettings } from '../core/settings';
import { Feature } from '../core/Feature';

// CSS 变量名：styles.css 中 .metadata-property-key 的 width 读取它，缺省回落 100px。
const WIDTH_VAR = '--minimalism-ui-prop-key-width';
const KEY_SELECTOR = '.metadata-property-key';
// 把手命中区：指针落在 key 右边缘内 8px 视为拖拽，避开中间的重命名输入区。
const HANDLE_ZONE = 8;
const MIN_WIDTH = 50;
const MAX_WIDTH = 240;

/**
 * PropertyKeyResizer — 让侧边栏 Properties 的 label（key）列宽可拖拽调整。
 *
 * 纯 CSS 无法表达“拖拽到任意宽度”，这里用最小 JS 补足：列宽存为 body 上的 CSS 变量
 * （WIDTH_VAR），整列统一、所有属性行共享同一变量天然对齐。styles.css 里 key 的
 * `::after` 是右边缘的视觉把手（col-resize 光标）。
 *
 * 监听走 activeDocument 上的捕获阶段委托，故每次切换笔记后 metadata DOM 被重建也无需重绑。
 * 拖拽结束才把宽度写入设置并落盘（save 回调仅 saveData，不触发全量 saveSettings 重应用，
 * 避免拖拽中重建侧边栏抖动）。
 */
export class PropertyKeyResizer implements Feature {
	private bound = false;
	// 进行中的拖拽：key 的左边界（用于 width = clientX - keyLeft）。null 表示未在拖拽。
	private keyLeft: number | null = null;
	private currentWidth = 0;

	constructor(
		private getSettings: () => MinimalismUISettings,
		private save: () => Promise<void>,
	) {}

	apply() {
		this.remove();
		this.setVar(this.getSettings().propertyKeyWidth);
		activeDocument.addEventListener('pointerdown', this.onPointerDown, true);
		this.bound = true;
	}

	remove() {
		if (this.bound) {
			activeDocument.removeEventListener('pointerdown', this.onPointerDown, true);
			this.bound = false;
		}
		this.endDrag();
		activeDocument.body.style.removeProperty(WIDTH_VAR);
	}

	private setVar(width: number) {
		activeDocument.body.setCssProps({ [WIDTH_VAR]: `${width}px` });
	}

	private onPointerDown = (e: PointerEvent) => {
		const target = e.target as HTMLElement | null;
		const key = target?.closest(KEY_SELECTOR) as HTMLElement | null;
		if (!key) return;
		const rect = key.getBoundingClientRect();
		// 仅当指针落在右边缘把手区才接管，否则放行（点击中部正常进入重命名）。
		if (e.clientX < rect.right - HANDLE_ZONE) return;

		e.preventDefault();
		e.stopPropagation();
		this.keyLeft = rect.left;
		activeDocument.addEventListener('pointermove', this.onPointerMove, true);
		activeDocument.addEventListener('pointerup', this.onPointerUp, true);
	};

	private onPointerMove = (e: PointerEvent) => {
		if (this.keyLeft === null) return;
		const raw = e.clientX - this.keyLeft;
		this.currentWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(raw)));
		this.setVar(this.currentWidth);
	};

	private onPointerUp = () => {
		const width = this.currentWidth;
		const had = this.keyLeft !== null;
		this.endDrag();
		if (had && width > 0) {
			this.getSettings().propertyKeyWidth = width;
			void this.save();
		}
	};

	private endDrag() {
		if (this.keyLeft === null) return;
		this.keyLeft = null;
		activeDocument.removeEventListener('pointermove', this.onPointerMove, true);
		activeDocument.removeEventListener('pointerup', this.onPointerUp, true);
	}
}
