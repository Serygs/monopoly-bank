import { hotelHouseLevel, type BoardSpace, type ColorGroup, type GameProperty } from '../../shared/types/monopoly';
import { useLanguage } from '../i18n/language-context';
import { boardSpaceName, colorGroupName } from '../utils/board-space-name';
import { groupColorStyle, groupSpaces, propertyOf } from '../utils/property-view';

export function GroupBadge({ group }: { group: ColorGroup }) {
  const { t } = useLanguage();
  return <span className="group-badge" style={groupColorStyle(group)}>{colorGroupName(group, t)}</span>;
}

interface DeedChipProps {
  space: BoardSpace;
  property: GameProperty;
  onClick?: () => void;
  pressed?: boolean;
  disabled?: boolean;
  /** Shown as the chip's tooltip and read to assistive tech when the chip cannot be chosen. */
  disabledReason?: string | null;
}

/** One deed: a colour stripe, the name on the surface, then houses, hotel and mortgage state. */
export function DeedChip({ space, property, onClick, pressed, disabled = false, disabledReason = null }: DeedChipProps) {
  const { t } = useLanguage();
  const name = boardSpaceName(space, t);
  const state = [
    property.houses >= hotelHouseLevel ? t('hotelBadge') : property.houses === 1 ? t('houseOne') : property.houses > 0 ? t('housesCount', { count: property.houses }) : null,
    property.mortgaged ? t('mortgagedBadge') : null,
    disabled && disabledReason !== null ? disabledReason : null,
  ].filter((part): part is string => part !== null);
  const content = <>
    <span className="deed-chip-stripe" aria-hidden="true" />
    <span className="deed-chip-name">{name}</span>
    {(property.houses > 0 || property.mortgaged) && <span className="deed-chip-meta" aria-hidden="true">
      {property.houses >= hotelHouseLevel ? <span className="deed-hotel">{t('hotelBadge')}</span> : property.houses > 0 ? <span className="deed-houses">{'●'.repeat(property.houses)}</span> : null}
      {property.mortgaged && <span className="deed-mortgaged">{t('mortgagedBadge')}</span>}
    </span>}
  </>;
  const label = state.length === 0 ? name : `${name} · ${state.join(' · ')}`;
  if (onClick === undefined) return <span className={`deed-chip${property.mortgaged ? ' deed-chip-mortgaged' : ''}`} style={groupColorStyle(space.colorGroup)} aria-label={label} role="img">{content}</span>;
  return <button type="button" className={`deed-chip deed-chip-button${pressed === true ? ' selected' : ''}${property.mortgaged ? ' deed-chip-mortgaged' : ''}`} style={groupColorStyle(space.colorGroup)} aria-pressed={pressed} aria-label={label} title={disabled && disabledReason !== null ? disabledReason : undefined} disabled={disabled} onClick={onClick}>{content}</button>;
}

interface SpacePickerProps {
  label: string;
  spaces: readonly BoardSpace[];
  properties: readonly GameProperty[];
  selectedIds: readonly string[];
  onToggle: (boardSpaceId: string) => void;
  /** A localized reason makes a deed unselectable; `null` leaves it selectable. */
  disabledReason?: (space: BoardSpace, property: GameProperty) => string | null;
  emptyLabel?: string;
}

/** Multi-select of deeds grouped by colour, used by trades. */
export function SpacePicker({ label, spaces, properties, selectedIds, onToggle, disabledReason, emptyLabel }: SpacePickerProps) {
  const groups = groupSpaces(spaces);
  return <fieldset className="space-picker"><legend>{label}</legend>
    {groups.length === 0 && emptyLabel !== undefined && <p className="muted">{emptyLabel}</p>}
    {groups.map(({ group, spaces: groupSpacesList }) => <div className="space-picker-group" key={group}><GroupBadge group={group} /><div className="deed-list">{groupSpacesList.map((space) => { const property = propertyOf(properties, space.id); const reason = disabledReason?.(space, property) ?? null; return <DeedChip key={space.id} space={space} property={property} pressed={selectedIds.includes(space.id)} disabled={reason !== null} disabledReason={reason} onClick={() => onToggle(space.id)} />; })}</div></div>)}
  </fieldset>;
}
