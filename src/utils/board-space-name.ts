import type { BoardSpace, ColorGroup } from '../../shared/types/monopoly';
import { isTranslationKey, type Translate, type TranslationKey } from '../i18n/translations';

/**
 * A canonical space renders through its translation key; a space of a
 * user-owned board copy carries the owner's own name and that name wins.
 * An unknown key (a future seed the client has not learnt yet) falls back to
 * the key itself rather than crashing the panel.
 */
export function boardSpaceName(space: Pick<BoardSpace, 'translationKey' | 'customName'>, t: Translate): string {
  if (space.customName !== null && space.customName.trim() !== '') return space.customName;
  return isTranslationKey(space.translationKey) ? t(space.translationKey) : space.translationKey;
}

const colorGroupKeys = {
  BROWN: 'colorGroupBrown',
  LIGHT_BLUE: 'colorGroupLightBlue',
  PINK: 'colorGroupPink',
  ORANGE: 'colorGroupOrange',
  RED: 'colorGroupRed',
  YELLOW: 'colorGroupYellow',
  GREEN: 'colorGroupGreen',
  DARK_BLUE: 'colorGroupDarkBlue',
  RAILROAD: 'colorGroupRailroad',
  UTILITY: 'colorGroupUtility',
} as const satisfies Record<ColorGroup, TranslationKey>;

export function colorGroupName(group: ColorGroup, t: Translate): string {
  return t(colorGroupKeys[group]);
}
