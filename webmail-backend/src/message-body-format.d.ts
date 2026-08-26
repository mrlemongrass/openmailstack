export interface ParsedMessageBodySource {
    html?: string | false;
    text?: string;
    textAsHtml?: string;
}
export interface ProjectedMessageBody {
    bodyMode: 'rich' | 'plain';
    html: string;
    text: string;
}
export declare function projectParsedMessageBody(parsed: ParsedMessageBodySource): ProjectedMessageBody;
//# sourceMappingURL=message-body-format.d.ts.map