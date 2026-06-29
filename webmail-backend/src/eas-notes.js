"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dbNoteToActiveSync = dbNoteToActiveSync;
exports.activeSyncToDbNote = activeSyncToDbNote;
function dbNoteToActiveSync(note) {
    return {
        tag: 'ApplicationData', page: 0, children: [
            { tag: 'Subject', page: 12, content: note.title || 'Untitled' },
            { tag: 'MessageClass', page: 12, content: 'IPM.StickyNote' },
            { tag: 'LastModifiedDate', page: 12, content: new Date(note.updated_at).toISOString() },
            { tag: 'Body', page: 17, children: [
                    { tag: 'Type', page: 17, content: '2' }, // HTML
                    { tag: 'Data', page: 17, content: note.content || '' },
                    { tag: 'EstimatedDataSize', page: 17, content: (note.content || '').length.toString() }
                ] }
        ]
    };
}
function activeSyncToDbNote(applicationData) {
    const note = {};
    const childText = (node, tag) => node?.children?.find((c) => c.tag === tag)?.content?.toString() || '';
    note.title = childText(applicationData, 'Subject');
    const bodyNode = applicationData?.children?.find((c) => c.tag === 'Body');
    if (bodyNode) {
        note.content = childText(bodyNode, 'Data');
    }
    return note;
}
//# sourceMappingURL=eas-notes.js.map