export interface MinimalismUISettings {
	showProperties: boolean;
	showLocalGraph: boolean;
	hideTabBar: boolean;
	disableNoteTabs: boolean;
	enableNavAnimation: boolean;
	theme: string;
	homePage: string;
	filenamePrefixLength: number;
	language: 'auto' | 'zh' | 'en';
}

export const DEFAULT_SETTINGS: MinimalismUISettings = {
	showProperties: true,
	showLocalGraph: false,
	hideTabBar: false,
	disableNoteTabs: false,
	enableNavAnimation: false,
	theme: 'forest',
	homePage: '',
	filenamePrefixLength: 0,
	language: 'auto',
};
