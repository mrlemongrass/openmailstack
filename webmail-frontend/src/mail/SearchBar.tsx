import { Search } from 'lucide-react';
import type { useMail } from './hooks/useMail';

export function SearchBar({ mail }: { mail: ReturnType<typeof useMail> }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px' }}>
      <Search size={16} style={{ color: 'var(--text-secondary)' }} />
      <input type="text" className="glass-input" placeholder="Search mail..."
        value={mail.searchQuery}
        onChange={(e) => { mail.setSearchQuery(e.target.value); mail.doSearch(e.target.value, mail.searchScope); }}
        style={{ flex: 1, fontSize: '0.85rem' }} />
    </div>
  );
}
