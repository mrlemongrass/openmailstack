import { X, Copy, Check } from 'lucide-react';
import { useState, useEffect } from 'react';

interface RawMessageModalProps {
  folder: string;
  uid: number;
  onClose: () => void;
}

export function RawMessageModal({ folder, uid, onClose }: RawMessageModalProps) {
  const requestKey = `${folder}:${uid}`;
  const [rawState, setRawState] = useState<{ key: string; raw: string | null; error: string }>({
    key: requestKey,
    raw: null,
    error: '',
  });
  const [copied, setCopied] = useState(false);
  const loading = rawState.key !== requestKey || (!rawState.raw && !rawState.error);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/folders/${encodeURIComponent(folder)}/messages/${uid}/raw`)
      .then((res) => { if (!res.ok) throw new Error('Failed to fetch'); return res.text(); })
      .then((text) => {
        if (!cancelled) setRawState({ key: requestKey, raw: text, error: '' });
      })
      .catch((e: unknown) => {
        const message = e instanceof Error ? e.message : 'Failed to fetch';
        if (!cancelled) setRawState({ key: requestKey, raw: null, error: message });
      });
    return () => { cancelled = true; };
  }, [folder, uid, requestKey]);

  const handleCopy = async () => {
    if (rawState.raw) { await navigator.clipboard.writeText(rawState.raw); setCopied(true); setTimeout(() => setCopied(false), 2000); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="glass-panel" style={{ width: 750, maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', borderBottom: '1px solid var(--border-glass)' }}>
          <span style={{ fontWeight: 600 }}>Raw Message</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost" onClick={handleCopy} style={{ padding: '4px 10px', fontSize: '0.8rem' }}>
              {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}
            </button>
            <button className="btn btn-ghost" onClick={onClose} style={{ padding: 4 }}><X size={18} /></button>
          </div>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          {loading && <div style={{ color: 'var(--text-secondary)' }}>Loading...</div>}
          {rawState.error && <div style={{ color: 'var(--danger)' }}>{rawState.error}</div>}
          {rawState.raw && <pre style={{ whiteSpace: 'pre-wrap', fontFamily: "'SF Mono','Fira Code',monospace",
            fontSize: '0.78rem', lineHeight: 1.5, color: 'var(--text-primary)', margin: 0 }}>{rawState.raw}</pre>}
        </div>
      </div>
    </div>
  );
}
