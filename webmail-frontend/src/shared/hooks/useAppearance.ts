import { useState, useEffect, useCallback } from 'react';
import {
  loadAppearancePreferences,
  saveAppearancePreferences,
  applyAppearancePreferences,
  type AppearancePreferences,
} from '../../settings/appearance';

export function useAppearance() {
  const [appearance, setAppearance] = useState<AppearancePreferences>(() =>
    loadAppearancePreferences()
  );

  const updateAppearance = useCallback((partial: Partial<AppearancePreferences>) => {
    setAppearance((prev) => {
      const next = { ...prev, ...partial };
      saveAppearancePreferences(next);
      applyAppearancePreferences(next);
      return next;
    });
  }, []);

  useEffect(() => { applyAppearancePreferences(appearance); }, [appearance]);

  return { appearance, setAppearance, updateAppearance };
}
