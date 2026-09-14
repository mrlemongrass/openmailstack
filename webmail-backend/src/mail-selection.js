"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.mailSelections = exports.MailSelectionStore = void 0;
const crypto_1 = __importDefault(require("crypto"));
// Short-lived, bounded snapshots. A restart expires them rather than replaying an uncertain write.
class MailSelectionStore {
    now;
    entries = new Map();
    constructor(now = () => Date.now()) {
        this.now = now;
    }
    create(owner, groups) {
        for (const [key, entry] of this.entries)
            if (!entry.pending && (entry.expires < this.now() || (entry.owner === owner && entry.result.state !== 'ready')))
                this.entries.delete(key);
        if (this.entries.size >= 100 || [...this.entries.values()].filter(e => e.owner === owner).length >= 5)
            throw new Error('Close earlier selections before starting another.');
        const count = groups.reduce((sum, group) => sum + group.uids.length, 0);
        if (count > 10000 || groups.length > 200)
            throw new Error('Narrow the selection to at most 10,000 messages and 200 folders.');
        const token = crypto_1.default.randomUUID();
        const result = { token, count, completed: 0, state: 'ready', allJunk: groups.length > 0 && groups.every(g => g.junk), includesTrash: groups.some(g => g.trash) };
        this.entries.set(token, { owner, expires: this.now() + 10 * 60_000, groups, result });
        return { ...result };
    }
    get(owner, token) {
        const entry = this.entries.get(token);
        if (!entry || entry.owner !== owner || (!entry.pending && entry.expires < this.now()))
            throw new Error('Selection expired. Refresh and review the messages again.');
        return entry;
    }
    cancel(owner, token) {
        const entry = this.get(owner, token);
        entry.cancelled = true;
        if (!entry.pending && entry.result.state === 'ready')
            entry.result.state = 'cancelled';
        return { ...entry.result };
    }
    async apply(owner, token, cursor, operation, run) {
        const entry = this.get(owner, token);
        if (entry.operation && entry.operation !== operation)
            throw new Error('This selection is already bound to a different action.');
        if (!Number.isInteger(cursor) || cursor < 0 || cursor > entry.result.completed)
            throw new Error('Invalid selection progress.');
        if (entry.pending)
            return entry.pending;
        if (cursor < entry.result.completed || entry.result.state !== 'ready')
            return { ...entry.result };
        entry.operation = operation;
        entry.pending = (async () => {
            let skip = entry.result.completed;
            const group = entry.groups.find(g => { if (skip >= g.uids.length) {
                skip -= g.uids.length;
                return false;
            } return true; });
            if (!group) {
                entry.result.state = 'complete';
                return { ...entry.result };
            }
            const batch = { ...group, uids: group.uids.slice(skip, skip + 100) };
            try {
                await run(batch);
                entry.result.confirmedBatch = { folder: batch.folder, uids: batch.uids };
                entry.result.completed += batch.uids.length;
                if (entry.result.completed === entry.result.count)
                    entry.result.state = 'complete';
                else if (entry.cancelled)
                    entry.result.state = 'cancelled';
            }
            catch {
                entry.result.state = 'uncertain';
                entry.result.error = 'The last batch could not be confirmed. Earlier completed batches are retained. Refresh the folders and review before starting a new action.';
            }
            return { ...entry.result };
        })();
        try {
            return await entry.pending;
        }
        finally {
            entry.pending = undefined;
        }
    }
}
exports.MailSelectionStore = MailSelectionStore;
exports.mailSelections = new MailSelectionStore();
//# sourceMappingURL=mail-selection.js.map