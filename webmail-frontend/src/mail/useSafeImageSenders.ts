import { useEffect, useState } from 'react';

export function useSafeImageSenders(): string[] {
  const [senders, setSenders] = useState<string[]>([]);
  useEffect(() => {
    let generation = 0;
    const load = async () => {
      const current = ++generation;
      try {
        const response = await fetch('/api/rules/sender-policy', { cache: 'no-store' });
        const data = await response.json();
        if (!response.ok || !data.success || !Array.isArray(data.entries)) throw new Error('Unavailable');
        if (current === generation) setSenders(data.entries.filter((entry: {kind: string; disposition: string; value: string}) => entry.kind === 'sender' && entry.disposition === 'safe').map((entry: {value: string}) => entry.value));
      } catch { if (current === generation) setSenders([]); }
    };
    void load();
    window.addEventListener('oms:sender-policy', load);
    return () => { generation++; window.removeEventListener('oms:sender-policy', load); };
  }, []);
  return senders;
}
