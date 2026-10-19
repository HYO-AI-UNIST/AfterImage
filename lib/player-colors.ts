import type { CSSProperties } from 'react';

/** Fixed seat identities. Keep the order stable across rounds and board views. */
export const PLAYER_COLORS = [
  { label: '파랑', color: '#2369a4', light: '#2369a4', dark: '#81b8ea' },
  { label: '황금', color: '#90650b', light: '#90650b', dark: '#e5c365' },
  { label: '보라', color: '#7950a4', light: '#7950a4', dark: '#b99cde' },
  { label: '청록', color: '#257263', light: '#257263', dark: '#79c7af' },
  { label: '분홍', color: '#a14b77', light: '#a14b77', dark: '#e5a0c3' },
  { label: '은회색', color: '#59666b', light: '#59666b', dark: '#c4cfd2' },
] as const;

export function playerColor(seat: number) {
  return PLAYER_COLORS[Number.isInteger(seat) && seat >= 0 ? seat % PLAYER_COLORS.length : 0];
}

export function playerColorStyle(seat: number): CSSProperties {
  const color = playerColor(seat);
  return {
    '--player-color': color.color,
    '--player-color-light': color.light,
    '--player-color-dark': color.dark,
  } as CSSProperties;
}
