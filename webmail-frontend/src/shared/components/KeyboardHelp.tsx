import { useRef } from 'react';
import { useModalFocus } from '../hooks/useModalFocus';
import { X } from 'lucide-react';

interface Shortcut {
  key: string;
  action: string;
}

const SHORTCUTS: Shortcut[] = [
  { key: '↑ / ↓ · J / K', action: 'Focus previous / next message' },
  { key: 'Shift + ↑ / ↓', action: 'Extend selection' },
  { key: 'Enter', action: 'Open focused message' },
  { key: 'X', action: 'Select focused message' },
  { key: '/', action: 'Search mail' },
  { key: 'C', action: 'Compose' },
  { key: 'G', action: 'Go to folder' },
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
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocus({ dialogRef, open, onClose });
  if (!open) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 2000,
      background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
    }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" className="glass-panel" style={{ maxHeight: '90dvh', overflow: 'auto', maxWidth: 460, width: '100%', padding: 24, borderRadius: 'var(--radius-lg)' }}
        onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Keyboard Shortcuts</h3>
          <button className="btn btn-ghost" aria-label="Close keyboard help" onClick={onClose} style={{ padding: 4 }}><X size={18} /></button>
        </div>
        <p>Choose arrow keys, J/K, or turn shortcuts off in Settings → Reading.</p>
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
