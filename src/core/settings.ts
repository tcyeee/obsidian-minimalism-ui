export interface MinimalismUISettings {
	macSidebar: boolean;
	showProperties: boolean;
	showLocalGraph: boolean;
	hideTabBar: boolean;
	disablePinTab: boolean;
	simplifyPanel: boolean;
	disableNoteTabs: boolean;
	enableNavAnimation: boolean;
	noteStyle: boolean;
	homePage: string;
	filenamePrefixLength: number;
	showBreadcrumb: boolean;
	language: 'auto' | 'zh' | 'en';
}

export const DEFAULT_SETTINGS: MinimalismUISettings = {
	macSidebar: false,
	showProperties: true,
	showLocalGraph: false,
	hideTabBar: false,
	disablePinTab: true,
	simplifyPanel: false,
	disableNoteTabs: false,
	enableNavAnimation: false,
	noteStyle: false,
	homePage: '',
	filenamePrefixLength: 0,
	showBreadcrumb: false,
	language: 'auto',
};
