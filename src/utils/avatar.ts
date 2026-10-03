export const AVATAR_OPTIONS = [
  '🎩',
  '🚗',
  '🐶',
  '🚢',
  '🎲',
  '💎',
  '🐈',
  '🚂',
  '✈️',
  '🧸',
  '👑',
  '🦆',
  '🦖',
  '🪙',
  '🎯',
  '🛸',
  '🦊',
  '🍀',
] as const;

export function isUploadedAvatar(value: string): boolean {
  return value.startsWith('data:image/');
}
