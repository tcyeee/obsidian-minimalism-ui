export interface MinimalismUISettings {
	macSidebar: boolean;
	hideTabBar: boolean;
	disablePinTab: boolean;
	simplifyPanel: boolean;
	disableNoteTabs: boolean;
	enableLeafCache: boolean;
	enableNavAnimation: boolean;
	noteStyle: boolean;
	homePage: string;
	autoPropertiesHeight: boolean;
}

export const DEFAULT_SETTINGS: MinimalismUISettings = {
	macSidebar: false,
	hideTabBar: false,
	disablePinTab: true,
	simplifyPanel: false,
	disableNoteTabs: false,
	enableLeafCache: false,
	enableNavAnimation: false,
	noteStyle: false,
	homePage: '',
	autoPropertiesHeight: false,
};
