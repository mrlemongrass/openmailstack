"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.projectParsedMessageBody = projectParsedMessageBody;
function projectParsedMessageBody(parsed) {
    const sourceHtml = typeof parsed.html === 'string' ? parsed.html : '';
    return {
        bodyMode: sourceHtml ? 'rich' : 'plain',
        html: sourceHtml || parsed.textAsHtml || '',
        text: parsed.text || '',
    };
}
//# sourceMappingURL=message-body-format.js.map