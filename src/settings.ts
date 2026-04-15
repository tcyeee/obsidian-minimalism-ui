export interface MinimalismUISettings {
	macSidebar: boolean;
	showProperties: boolean;
	showLocalGraph: boolean;
	hideTabBar: boolean;
	disablePinTab: boolean;
	simplifyPanel: boolean;
	disableNoteTabs: boolean;
	enableLeafCache: boolean;
	enableNavAnimation: boolean;
	noteStyle: boolean;
	homePage: string;
}

export const DEFAULT_SETTINGS: MinimalismUISettings = {
	macSidebar: false,
	showProperties: true,
	showLocalGraph: false,
	hideTabBar: false,
	disablePinTab: true,
	simplifyPanel: false,
	disableNoteTabs: false,
	enableLeafCache: false,
	enableNavAnimation: false,
	noteStyle: false,
	homePage: '',
};
