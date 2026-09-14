import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../hooks/useAuth';

// This route mounts only after active editors permit navigation. Never end the
// session in a route loader: loaders can run before navigation is confirmed.
export function LogoutPage() {
  const { logout } = useAuth();
  const started = useRef(false);
  const pending = useRef(false);
  const [error, setError] = useState('');
  const attempt = useCallback(async () => {
    if (pending.current) return;
    pending.current = true;
    setError('');
    try {
      await logout();
    } catch {
      pending.current = false;
      setError('Could not sign out. Your session has not been cleared here. Retry to finish signing out.');
    }
  }, [logout]);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void attempt();
  }, [attempt]);
  return <div className="glass-panel" style={{ margin: 'auto', padding: 28, maxWidth: 460 }}>
    <h2>{error ? 'Sign out interrupted' : 'Signing out…'}</h2>
    {error ? <>
      <p role="alert">{error}</p>
      <button className="btn btn-primary" onClick={() => void attempt()}>Retry sign out</button>
      <Link to="/mail/inbox" className="btn btn-ghost">Back to mail</Link>
    </> : <p role="status">Finishing your session.</p>}
  </div>;
}
