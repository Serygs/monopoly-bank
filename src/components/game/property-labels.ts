import type { PropertyGroupId } from '../../../shared/board';
import { useLanguage } from '../../i18n/language-context';
import type { TranslationKey } from '../../i18n/translations';

export const propertyGroupKeys: Record<PropertyGroupId, TranslationKey> = {
  brown: 'propertyGroupBrown',
  lightblue: 'propertyGroupLightblue',
  pink: 'propertyGroupPink',
  orange: 'propertyGroupOrange',
  red: 'propertyGroupRed',
  yellow: 'propertyGroupYellow',
  green: 'propertyGroupGreen',
  blue: 'propertyGroupBlue',
  railway: 'propertyGroupRailway',
  utility: 'propertyGroupUtility',
};

/** A short label for the building level of a street: nothing, "2 houses" or "Hotel". */
export function useBuildingLabel() {
  const { t } = useLanguage();
  return (houses: number): string | null => {
    if (houses <= 0) return null;
    if (houses >= 5) return t('propertyHotel');
    return houses === 1 ? t('propertyHouseOne') : t('propertyHouses', { count: houses });
  };
}

export const propertyStatusKeys = {
  free: 'propertyFree',
  owned: 'propertyOwned',
  mortgaged: 'propertyMortgaged',
} as const;
