'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

type Theme = 'light' | 'dark';
const STORAGE_KEY = 'mindminer.theme.v1';

export function ThemeSwitcher() {
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      const nextTheme = event.newValue === 'light' ? 'light' : 'dark';
      document.documentElement.dataset.theme = nextTheme;
      setTheme(nextTheme);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  function selectTheme(nextTheme: Theme) {
    document.documentElement.dataset.theme = nextTheme;
    setTheme(nextTheme);
    try { localStorage.setItem(STORAGE_KEY, nextTheme); } catch { /* The current tab still keeps the chosen theme. */ }
  }

  return <div className="theme-switcher" role="group" aria-label="화면 모드">
    <button type="button" aria-label="라이트 모드" title="라이트 모드" aria-pressed={theme === 'light'} onClick={() => selectTheme('light')}><Sun size={16}/><span>라이트</span></button>
    <button type="button" aria-label="다크 모드" title="다크 모드" aria-pressed={theme === 'dark'} onClick={() => selectTheme('dark')}><Moon size={16}/><span>다크</span></button>
  </div>;
}
