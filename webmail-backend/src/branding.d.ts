export interface BrandingSettings {
    appName: string;
    companyName: string;
    loginTitle: string;
    loginSubtitle: string;
    appIconDataUrl: string;
    faviconDataUrl: string;
    loginLogoDataUrl: string;
    loginBackgroundDataUrl: string;
}
export declare const brandingDefaults: BrandingSettings;
export declare function ensureBrandingSchema(): Promise<void>;
export declare function normalizeBrandingSettings(value: unknown): BrandingSettings;
export declare function getBrandingSettings(): Promise<BrandingSettings>;
export declare function saveBrandingSettings(settings: unknown, updatedBy: string): Promise<BrandingSettings>;
//# sourceMappingURL=branding.d.ts.map