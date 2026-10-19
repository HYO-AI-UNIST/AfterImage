'use client';

import { useSyncExternalStore } from 'react';
import { Moon, Sun } from 'lucide-react';

type Theme = 'light' | 'dark';
const STORAGE_KEY = 'mindminer.theme.v1';
const CHANGE_EVENT = 'mindminer-theme-change';

function readTheme(): Theme { return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'; }
function subscribeTheme(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    document.documentElement.dataset.theme = event.newValue === 'light' ? 'light' : 'dark';
    onChange();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

export function ThemeSwitcher() {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, (): Theme => 'dark');

  function selectTheme(nextTheme: Theme) {
    document.documentElement.dataset.theme = nextTheme;
    window.dispatchEvent(new Event(CHANGE_EVENT));
    try { localStorage.setItem(STORAGE_KEY, nextTheme); } catch { /* The current tab still keeps the chosen theme. */ }
  }

  return <div className="theme-switcher" role="group" aria-label="화면 모드">
    <button type="button" aria-label="라이트 모드" title="라이트 모드" aria-pressed={theme === 'light'} onClick={() => selectTheme('light')}><Sun size={16}/><span>라이트</span></button>
    <button type="button" aria-label="다크 모드" title="다크 모드" aria-pressed={theme === 'dark'} onClick={() => selectTheme('dark')}><Moon size={16}/><span>다크</span></button>
  </div>;
}
