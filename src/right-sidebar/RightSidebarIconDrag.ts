import { RightSidebarViewStack, STOW_KEY } from './RightSidebarViewStack';
import { MinimalismUISettings } from '../core/settings';
import { uiDoc } from '../core/appDom';

const STACK_DRAGGING_CLASS = 'minimalism-ui-rsb-stack-dragging';
const ICON_DRAG_ACTIVE_CLASS = 'minimalism-ui-rsb-stack-icon-drag-active';
const ICON_DRAGGING_BODY_CLASS = 'minimalism-ui-rsb-icon-dragging';
// "已收纳"视觉提示（灰化）：哨兵左侧即命中，与是否肉眼可见（展开/拖拽强制显形）无关。
const STACK_ICON_STOWED_CLASS = 'minimalism-ui-rsb-stack-icon-stowed';
// 拖拽判定阈值：移动小于此距离视为点击（触发选中/收纳切换），超过才进入真正的重排拖拽态。
const ICON_DRAG_THRESHOLD_PX = 4;

/**
 * RightSidebarIconDrag — 图标堆叠的拖拽重排。从 RightSidebarButtonManager 拆出：越过
 * ICON_DRAG_THRESHOLD_PX 阈值前视为普通点击（交由 RightSidebarViewStack 的 click 处理器
 * 走选中/收纳切换），越过后接管顺序——用"虚拟位置排序"（把被拖项当成中心点在当前指针
 * clientX 的虚拟条目，和其余各项按各自实时测得的 bounding rect 中点一起排序，天然避免
 * 相邻位判断的边界抖动，也不需要区分拖拽方向）+ FLIP 动画重排 DOM，松手后把新顺序换算回
 * 按 view type 持久化的 key、写入 settings.rightSidebarStackOrder，并回调 ViewStack 用新
 * 顺序重新渲染。
 *
 * 与 RightSidebarViewStack 双向协作（构造顺序见 RightSidebarButtonManager）：读它的
 * computeRenderOrder()/instanceKeyOf()/keyOf()/leafForInstanceKey() 做排序与持久化换算，
 * 它反过来在渲染图标时把 pointerdown 转交给本类的 startIconDrag()、在图标 click 时经
 * consumeSuppressedClick() 判断要不要吞掉这次点击。
 */
export class RightSidebarIconDrag {
	// 进行中的图标拖拽重排；null 表示未在拖拽。dragging 为 false 时表示还未越过阈值
	// （此时仍可能是一次普通点击），越过阈值后才真正接管顺序 + 吞掉尾随的 click。
	private iconDrag: {
		key: string;
		startX: number;
		startY: number;
		dragging: boolean;
		order: string[];
		// 抓取时指针相对图标左边缘的偏移，及当前已叠加的跟手位移——见 followIconPointer。
		grabOffsetX: number;
		translateX: number;
	} | null = null;
	// 拖拽越过阈值后置位：吞掉这次拖拽松手后紧随而来的 click，避免误触发选中/收纳切换。
	// 超时兜底同主类的 suppressNextOutsideClick，防止浏览器这次没派发 click 导致标记卡死。
	private suppressNextIconClick = false;

	constructor(
		private stack: RightSidebarViewStack,
		private getSettings: () => MinimalismUISettings,
		private save: () => Promise<void>,
		// 拖拽松手点可能落在 launcher/panel 外，通知主类吞掉紧随而来的一次"点击外部关闭"判定。
		private notifyDragEnd: () => void,
	) {}

	// 供 ViewStack 的图标 click 处理器调用：拖拽刚越过阈值时吞掉紧随的一次 click。
	consumeSuppressedClick(): boolean {
		if (!this.suppressNextIconClick) return false;
		this.suppressNextIconClick = false;
		return true;
	}

	startIconDrag(e: PointerEvent, key: string) {
		if (e.button !== 0) return;
		const stackEl = this.stack.getStackEl();
		const el = stackEl?.querySelector<HTMLElement>(`[data-rsb-key="${CSS.escape(key)}"]`);
		this.iconDrag = {
			key,
			startX: e.clientX,
			startY: e.clientY,
			dragging: false,
			order: this.stack.computeRenderOrder().map((item) => (item === STOW_KEY ? STOW_KEY : this.stack.instanceKeyOf(item))),
			grabOffsetX: el ? e.clientX - el.getBoundingClientRect().left : 0,
			translateX: 0,
		};
		uiDoc().addEventListener('pointermove', this.onIconPointerMove, true);
		uiDoc().addEventListener('pointerup', this.onIconPointerUp, true);
	}

	private onIconPointerMove = (e: PointerEvent) => {
		const drag = this.iconDrag;
		if (!drag) return;
		const stackEl = this.stack.getStackEl();
		if (!drag.dragging) {
			const dx = e.clientX - drag.startX;
			const dy = e.clientY - drag.startY;
			if (Math.hypot(dx, dy) < ICON_DRAG_THRESHOLD_PX) return;
			drag.dragging = true;
			this.suppressNextIconClick = true;
			window.setTimeout(() => { this.suppressNextIconClick = false; }, 300);
			stackEl?.addClass(STACK_DRAGGING_CLASS);
			uiDoc().body.addClass(ICON_DRAGGING_BODY_CLASS);
			stackEl?.querySelector<HTMLElement>(`[data-rsb-key="${CSS.escape(drag.key)}"]`)
				?.addClass(ICON_DRAG_ACTIVE_CLASS);
		}
		e.preventDefault();
		// 先按虚拟位置排序重排 DOM（可能改变被拖图标的"自然位置"），再让它贴回指针——
		// 顺序不能反，否则跟手位移会用上一帧的自然位置算出错误的偏移。
		this.updateIconDragTarget(e.clientX);
		this.followIconPointer(e.clientX);
	};

	// 被拖拽图标的"跟手"位移：越过阈值后每帧都让它的视觉位置贴着指针（保留抓取时指针相对
	// 图标左边缘的偏移，而不是让图标左边缘直接对齐指针）。它在 DOM 流里的"自然位置"只由
	// updateIconDragTarget 的重排决定，这里在自然位置之上叠加一段 translateX 补足到指针实际
	// 位置——与 flipIconPositions 处理其余图标各自独立，互不干扰。
	// ICON_DRAG_ACTIVE_CLASS 的 scale(1.12) 由 CSS 类声明，但内联 transform 会整体覆盖它，
	// 故这里把两者写进同一个 transform 字符串里。
	private followIconPointer(clientX: number) {
		const drag = this.iconDrag;
		const stackEl = this.stack.getStackEl();
		if (!drag || !drag.dragging || !stackEl) return;
		const el = stackEl.querySelector<HTMLElement>(`[data-rsb-key="${CSS.escape(drag.key)}"]`);
		if (!el) return;
		const rect = el.getBoundingClientRect();
		const naturalLeft = rect.left - drag.translateX;
		const desiredLeft = clientX - drag.grabOffsetX;
		drag.translateX = desiredLeft - naturalLeft;
		el.setCssStyles({ transform: `translateX(${drag.translateX}px) scale(1.12)` });
	}

	// 用"虚拟位置排序"而非逐格判断相邻位来求新顺序（见类注释）。容器 right 固定、内容变宽
	// 会让兄弟节点左移，故每次都现场测量，不用拖拽起点缓存的 rect。
	private updateIconDragTarget(clientX: number) {
		const drag = this.iconDrag;
		const stackEl = this.stack.getStackEl();
		if (!drag || !drag.dragging || !stackEl) return;
		const children = Array.from(stackEl.children) as HTMLElement[];
		const byKey = (key: string) => children.find((c) => c.dataset.rsbKey === key) ?? null;

		const entries: { key: string; center: number }[] = [];
		for (const key of drag.order) {
			if (key === drag.key) continue;
			const el = byKey(key);
			if (!el) continue;
			const rect = el.getBoundingClientRect();
			entries.push({ key, center: rect.left + rect.width / 2 });
		}
		entries.push({ key: drag.key, center: clientX });
		entries.sort((a, b) => a.center - b.center);
		const newOrder = entries.map((entry) => entry.key);
		if (newOrder.join(' ') === drag.order.join(' ')) return;
		drag.order = newOrder;

		// 被拖拽的图标自身跳过滑动动画：它由 ICON_DRAG_ACTIVE_CLASS 控制 transform: scale(...)，
		// 叠加位移会互相打架，且它的挪动本就由指针驱动。其余因让位而挪动的图标用 FLIP 补一段
		// 滑动过渡，而不是随 insertBefore 瞬间跳位（见 flipIconPositions）。
		const others = children.filter((el) => el.dataset.rsbKey !== drag.key);
		this.flipIconPositions(others, () => {
			// 按新顺序物理重排 DOM，只挪动实际错位的节点。
			let cursor: ChildNode | null = stackEl.firstChild;
			for (const key of newOrder) {
				const el = byKey(key);
				if (!el) continue;
				if (cursor !== el) stackEl.insertBefore(el, cursor);
				cursor = el.nextSibling;
			}
		});

		// 收纳分界随拖拽实时移动：灰化提示必须跟着每一步重排同步刷新，不能只在松手/展开切换
		// 时算一次——否则拖拽过程中会出现"已经越过分界线但还没变灰/变回"的滞后。
		this.applyStowedClasses(newOrder, byKey);
	}

	// 按当前顺序把哨兵左侧的图标标记为"已收纳"（灰化提示，见 STACK_ICON_STOWED_CLASS）。
	private applyStowedClasses(order: string[], byKey: (key: string) => HTMLElement | null) {
		const stowIndex = order.indexOf(STOW_KEY);
		order.forEach((key, idx) => {
			if (key === STOW_KEY) return;
			byKey(key)?.toggleClass(STACK_ICON_STOWED_CLASS, idx < stowIndex);
		});
	}

	// FLIP（First-Last-Invert-Play）：mutate 前先清掉每个元素可能残留的上一轮位移（无过渡、
	// 瞬间归位——先清后测才准，也让连续快速重排时动画能被自然打断重启，不会越叠越乱），
	// 记录 First 位置；跑 mutate；量出 Last 位置，用位移差瞬时"倒回" First（同样无过渡）；
	// 强制回流后清空 transform——图标自身的 CSS 已带 transform 0.15s ease 过渡，这一步会被
	// 浏览器动画成滑向 Last，不需要额外声明过渡时长。
	private flipIconPositions(els: HTMLElement[], mutate: () => void) {
		for (const el of els) {
			el.setCssStyles({ transition: 'none', transform: '' });
		}
		void this.stack.getStackEl()?.offsetWidth;
		const firstLeft = new Map<HTMLElement, number>();
		for (const el of els) firstLeft.set(el, el.getBoundingClientRect().left);

		mutate();

		for (const el of els) {
			const first = firstLeft.get(el);
			if (first === undefined) continue;
			const delta = first - el.getBoundingClientRect().left;
			if (delta !== 0) el.setCssStyles({ transform: `translateX(${delta}px)` });
		}
		void this.stack.getStackEl()?.offsetWidth;
		for (const el of els) {
			el.setCssStyles({ transition: '', transform: '' });
		}
	}

	private onIconPointerUp = () => {
		const drag = this.iconDrag;
		this.iconDrag = null;
		uiDoc().removeEventListener('pointermove', this.onIconPointerMove, true);
		uiDoc().removeEventListener('pointerup', this.onIconPointerUp, true);
		if (!drag || !drag.dragging) return;

		const stackEl = this.stack.getStackEl();
		stackEl?.removeClass(STACK_DRAGGING_CLASS);
		uiDoc().body.removeClass(ICON_DRAGGING_BODY_CLASS);

		// drag.order 里存的是本次运行时的实例 key，落盘前换回按 view type 持久化的 key
		// （见 RightSidebarViewStack 的 leafInstanceKeys 字段注释）——同 type 的多个 leaf
		// 会折叠回重复的 type 字符串，与 computeRenderOrder() 的池化消费逻辑一致，不影响
		// "记住顺序"这个持久化目标本身。
		const s = this.getSettings();
		s.rightSidebarStackOrder = drag.order.map((key) => {
			if (key === STOW_KEY) return STOW_KEY;
			const leaf = this.stack.leafForInstanceKey(key);
			return leaf ? this.stack.keyOf(leaf) : key;
		});
		void this.save();

		// 拖拽松手点可能落在 launcher/panel 外，避免被主类的"点击外部关闭"误判。
		this.notifyDragEnd();

		this.stack.renderStackIcons();
	};

	// 强制结束进行中的拖拽（remove() 调用），不持久化、不重渲染。
	endIconDrag() {
		if (!this.iconDrag) return;
		this.iconDrag = null;
		uiDoc().removeEventListener('pointermove', this.onIconPointerMove, true);
		uiDoc().removeEventListener('pointerup', this.onIconPointerUp, true);
		const stackEl = this.stack.getStackEl();
		stackEl?.removeClass(STACK_DRAGGING_CLASS);
		uiDoc().body.removeClass(ICON_DRAGGING_BODY_CLASS);
		this.suppressNextIconClick = false;
	}
}
