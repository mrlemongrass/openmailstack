import { Search } from 'lucide-react';
import type { useMail } from './hooks/useMail';

export function SearchBar({ mail }: { mail: ReturnType<typeof useMail> }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px' }}>
      <Search size={16} style={{ color: 'var(--text-secondary)' }} />
      <input type="text" className="glass-input" placeholder="Search mail..."
        value={mail.searchQuery}
        onChange={(e) => mail.updateSearchQuery(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); mail.submitSearchQuery(); } }}
        style={{ flex: 1, fontSize: '0.85rem' }} />
    </div>
  );
}
