import { NoteRow, getNote, saveNote, deleteNote, getNotesSyncToken, listNotes } from './notes-utils';

export function dbNoteToActiveSync(note: NoteRow): any {
    return {
        tag: 'ApplicationData', page: 0, children: [
            { tag: 'Subject', page: 12, content: note.title || 'Untitled' },
            { tag: 'MessageClass', page: 12, content: 'IPM.StickyNote' },
            { tag: 'LastModifiedDate', page: 12, content: new Date(note.updated_at).toISOString() },
            { tag: 'Body', page: 17, children: [
                { tag: 'Type', page: 17, content: '2' }, // HTML
                { tag: 'Data', page: 17, content: note.content || '' },
                { tag: 'EstimatedDataSize', page: 17, content: (note.content || '').length.toString() }
            ]}
        ]
    };
}

export function activeSyncToDbNote(applicationData: any): Partial<NoteRow> {
    const note: Partial<NoteRow> = {};
    const childText = (node: any, tag: string) => node?.children?.find((c: any) => c.tag === tag)?.content?.toString() || '';
    
    note.title = childText(applicationData, 'Subject');
    
    const bodyNode = applicationData?.children?.find((c: any) => c.tag === 'Body');
    if (bodyNode) {
        note.content = childText(bodyNode, 'Data');
    }
    
    return note;
}
