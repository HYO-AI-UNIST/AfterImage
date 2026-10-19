'use client';

import { Check, LoaderCircle, SlidersHorizontal } from 'lucide-react';
import type { RoomSettings } from '@/lib/contracts';
import { ROOM_SETTING_LIMITS } from '@/lib/settings';

interface Props {
  value: RoomSettings;
  host: boolean;
  busy: boolean;
  disabled: boolean;
  changed: boolean;
  onChange: (value: RoomSettings) => void;
}

const difficulties: Record<number, string> = { 3: '쉬움', 4: '기본', 5: '어려움', 6: '매우 어려움' };

export function RoomSettingsPanel({ value, host, busy, disabled, changed, onChange }: Props) {
  const fields = [
    { key: 'playerCount', label: '플레이 인원', unit: '명' },
    { key: 'hintCoins', label: '라운드당 힌트 코인', unit: '개' },
    { key: 'totalRounds', label: '총 라운드', unit: '라운드' },
    { key: 'gridSize', label: '그리드 난이도', unit: '등분' },
  ] as const;

  return <section className="room-settings" aria-label="게임 설정">
    <div className="room-settings-heading"><h2><SlidersHorizontal size={17}/>게임 설정</h2><span>{host ? '방장만 변경 가능' : '방장이 정한 규칙'}</span></div>
    <div className="room-settings-grid">
      {fields.map(({ key, label, unit }) => {
        const { min, max } = ROOM_SETTING_LIMITS[key];
        return <label className="room-setting" key={key}>
          <span>{label}</span>
          <select aria-label={label} value={value[key]} disabled={!host || disabled} onChange={event => onChange({ ...value, [key]: Number(event.target.value) })}>
            {Array.from({ length: max - min + 1 }, (_, index) => min + index).map(amount => <option key={amount} value={amount}>{key === 'gridSize' ? `${difficulties[amount]} · ${amount}등분` : key === 'hintCoins' && amount === 0 ? '사용 안 함 (0개)' : `${amount}${unit}`}</option>)}
          </select>
        </label>;
      })}
    </div>
    <div className="room-settings-actions">
      <p className="room-settings-note">게임이 시작되면 설정과 참가석이 고정됩니다.</p>
      <span className="settings-sync" role="status">{busy && changed ? <><LoaderCircle className="spin" size={13}/>반영 중</> : <><Check size={13}/>{host ? '변경 즉시 자동 반영' : '실시간 반영'}</>}</span>
    </div>
  </section>;
}
