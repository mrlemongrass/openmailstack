import { useState } from 'react';
import { findSettings } from './settingsNavigation';
import type { SettingsTab } from './tabs';
export function SettingsSearch({ onChoose }: { onChoose: (tab: SettingsTab) => void }) {
  const [query, setQuery] = useState('');
  const results = findSettings(query);
  return <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border-glass)' }}>
    <label style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>Find a setting <input type="search" className="glass-input" placeholder="Format, after delete, block sender…" value={query} onChange={e => setQuery(e.target.value)} style={{ flex: 1, minWidth: 160 }} /></label>
    {query.trim() && <div aria-label="Matching settings" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
      {results.map(item => <button className="btn btn-secondary" key={item.tab} onClick={() => { onChoose(item.tab); setQuery(''); }}>{item.label}</button>)}
      {!results.length && <p role="status">No matching settings. Try “compose”, “keyboard”, or “sender”.</p>}
    </div>}
  </div>;
}
