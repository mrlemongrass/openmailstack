import { X } from 'lucide-react';

interface Shortcut {
  key: string;
  action: string;
}

const SHORTCUTS: Shortcut[] = [
  { key: 'R', action: 'Reply' },
  { key: 'A', action: 'Reply All' },
  { key: 'F', action: 'Forward' },
  { key: 'S', action: 'Toggle flag' },
  { key: 'E', action: 'Archive' },
  { key: '#', action: 'Delete' },
  { key: 'Delete / Backspace', action: 'Delete' },
  { key: 'Esc', action: 'Back to message list' },
];

export function KeyboardHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 2000,
      background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
    }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="glass-panel" style={{ maxWidth: 380, width: '100%', padding: 24, borderRadius: 'var(--radius-lg)' }}
        onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Keyboard Shortcuts</h3>
          <button className="btn btn-ghost" onClick={onClose} style={{ padding: 4 }}><X size={18} /></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {SHORTCUTS.map((s) => (
            <div key={s.key} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '6px 0', borderBottom: '1px solid var(--border-glass)',
              fontSize: '0.85rem',
            }}>
              <span style={{ color: 'var(--text-secondary)' }}>{s.action}</span>
              <kbd style={{
                padding: '2px 8px', borderRadius: 4, fontSize: '0.75rem',
                background: 'rgba(255,255,255,0.08)', border: '1px solid var(--border-glass)',
                fontFamily: 'monospace',
              }}>{s.key}</kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
