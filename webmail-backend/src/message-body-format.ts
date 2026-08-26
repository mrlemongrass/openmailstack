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

export function projectParsedMessageBody(parsed: ParsedMessageBodySource): ProjectedMessageBody {
    const sourceHtml = typeof parsed.html === 'string' ? parsed.html : '';
    return {
        bodyMode: sourceHtml ? 'rich' : 'plain',
        html: sourceHtml || parsed.textAsHtml || '',
        text: parsed.text || '',
    };
}
