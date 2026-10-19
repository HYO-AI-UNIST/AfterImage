import type { RoomSettings } from './contracts';

export const DEFAULT_ROOM_SETTINGS: Readonly<RoomSettings> = Object.freeze({
  playerCount: 6,
  hintCoins: 3,
  totalRounds: 7,
  gridSize: 4,
});

export const ROOM_SETTING_LIMITS = {
  playerCount: { min: 2, max: 6 },
  hintCoins: { min: 0, max: 10 },
  totalRounds: { min: 1, max: 20 },
  gridSize: { min: 3, max: 6 },
} as const;

/** Shared validation keeps browser constraints and authoritative rules aligned. */
export function isValidRoomSettings(input: unknown): input is RoomSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const values = input as Record<string, unknown>;
  if (Object.keys(values).length !== Object.keys(ROOM_SETTING_LIMITS).length || Object.keys(values).some((key) => !Object.hasOwn(ROOM_SETTING_LIMITS, key))) return false;
  return (Object.keys(ROOM_SETTING_LIMITS) as Array<keyof RoomSettings>).every((key) => {
    const value = values[key];
    const { min, max } = ROOM_SETTING_LIMITS[key];
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
  });
}
