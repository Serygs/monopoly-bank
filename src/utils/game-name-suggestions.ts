import type { Language } from '../i18n/translations';

interface GameNameSuggestion {
  icon: string;
  en: string;
  uk: string;
}

const suggestionPool: readonly GameNameSuggestion[] = [
  { icon: '🎲', en: 'Classic Monopoly', uk: 'Класична Монополія' },
  { icon: '🌙', en: 'Monopoly Night', uk: 'Вечір Монополії' },
  { icon: '🏠', en: 'Family Night', uk: 'Сімейний вечір' },
  { icon: '👑', en: 'Monopoly Masters', uk: 'Майстри Монополії' },
  { icon: '🎩', en: 'Property Tycoons', uk: 'Магнати нерухомості' },
  { icon: '💼', en: 'Boardroom Battle', uk: 'Битва магнатів' },
  { icon: '💰', en: "Banker's Table", uk: 'Банкірський стіл' },
  { icon: '🌆', en: 'City Empire', uk: 'Міська імперія' },
  { icon: '🔎', en: 'Fortune Hunters', uk: 'Мисливці за статками' },
  { icon: '🤝', en: 'Deal Makers', uk: 'Майстри угод' },
  { icon: '🌟', en: 'Millionaire Night', uk: 'Ніч мільйонерів' },
  { icon: '☕', en: 'Coffee & Capital', uk: 'Кава та капітал' },
];

export interface LocalizedGameNameSuggestion {
  icon: string;
  name: string;
}

export function getGameNameSuggestions(
  language: Language,
  startIndex: number,
  count = 6,
): LocalizedGameNameSuggestion[] {
  const safeStart = Math.abs(Math.trunc(startIndex)) % suggestionPool.length;
  return Array.from({ length: Math.min(count, suggestionPool.length) }, (_, offset) => {
    const suggestion = suggestionPool[(safeStart + offset) % suggestionPool.length];
    return { icon: suggestion.icon, name: suggestion[language] };
  });
}

export function randomSuggestionStart(random: () => number = Math.random): number {
  return Math.floor(random() * suggestionPool.length);
}
