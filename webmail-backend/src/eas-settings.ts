import type { WbxmlNode } from './wbxml/parser';

export interface ActiveSyncSettingsNode {
    tag: string;
    page: number;
    content?: string;
    children?: ActiveSyncSettingsNode[];
}

const protocolError = (): ActiveSyncSettingsNode => ({
    tag: 'Settings',
    page: 18,
    children: [{ tag: 'Status', page: 18, content: '2' }],
});

const hasNoContent = (node: WbxmlNode): boolean => node.content === undefined;

const isOofGet = (request: WbxmlNode | null): boolean => {
    if (!request || request.tag !== 'Settings' || request.page !== 18
        || !hasNoContent(request) || request.children.length !== 1) return false;

    const oof = request.children[0];
    if (oof.tag !== 'Oof' || oof.page !== 18 || !hasNoContent(oof)
        || oof.children.length !== 1) return false;

    const get = oof.children[0];
    if (get.tag !== 'Get' || get.page !== 18 || !hasNoContent(get)
        || get.children.length !== 1) return false;

    const bodyType = get.children[0];
    return bodyType.tag === 'BodyType' && bodyType.page === 18
        && bodyType.children.length === 0
        && (bodyType.content === 'Text' || bodyType.content === 'HTML');
};

export const activeSyncSettingsResponseNode = (
    request: WbxmlNode | null,
): ActiveSyncSettingsNode => {
    if (!isOofGet(request)) return protocolError();
    return {
        tag: 'Settings',
        page: 18,
        children: [
            { tag: 'Status', page: 18, content: '1' },
            {
                tag: 'Oof',
                page: 18,
                children: [
                    { tag: 'Status', page: 18, content: '1' },
                    {
                        tag: 'Get',
                        page: 18,
                        children: [{ tag: 'OofState', page: 18, content: '0' }],
                    },
                ],
            },
        ],
    };
};
