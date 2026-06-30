import { useState, useEffect, useCallback } from 'react';
import type { UserIdentities } from '../types';

interface AuthState {
  user: { email: string; name: string } | null;
  userIdentities: UserIdentities | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

export function useAuth(): AuthState & {
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  fetchMe: () => Promise<void>;
} {
  const [user, setUser] = useState<{ email: string; name: string } | null>(null);
  const [userIdentities, setUserIdentities] = useState<UserIdentities | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchMe = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        if (data.user?.username) {
          setUser({ email: data.user.username, name: data.user.username });
          const identRes = await fetch('/api/user/identities');
          if (identRes.ok) {
            const identData = await identRes.json();
            setUserIdentities(identData);
          }
          setIsLoading(false);
          return;
        }
      }
      setUser(null);
      setUserIdentities(null);
    } catch {
      setUser(null);
      setUserIdentities(null);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => { fetchMe(); }, [fetchMe]);

  const login = useCallback(async (email: string, password: string): Promise<boolean> => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: email, password }),
    });
    if (res.ok) { await fetchMe(); return true; }
    return false;
  }, [fetchMe]);

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
    setUserIdentities(null);
  }, []);

  return { user, userIdentities, isLoading, isAuthenticated: !!user, login, logout, fetchMe };
}
