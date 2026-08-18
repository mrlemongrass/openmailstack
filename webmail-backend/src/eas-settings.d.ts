import type { WbxmlNode } from './wbxml/parser';
export interface ActiveSyncSettingsNode {
    tag: string;
    page: number;
    content?: string;
    children?: ActiveSyncSettingsNode[];
}
export declare const activeSyncSettingsResponseNode: (request: WbxmlNode | null) => ActiveSyncSettingsNode;
//# sourceMappingURL=eas-settings.d.ts.map