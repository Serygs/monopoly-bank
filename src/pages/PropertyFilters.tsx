import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { PropertyGroupId } from '../../shared/board';
import type { Player } from '../../shared/types/monopoly';
import { propertyGroupKeys } from '../components/game/property-labels';
import { Button } from '../components/ui';
import { cx } from '../components/ui/class-names';
import { useLanguage } from '../i18n/language-context';
import {
  activeFilterCount,
  noPropertyFilters,
  type OwnerFilter,
  type PropertyFilterState,
} from '../utils/property-filters';
import { propertyGroupColors } from '../utils/property-view';

export interface PropertyFiltersProps {
  players: readonly Player[];
  /** The groups of the board, in the order they are listed. */
  groupIds: readonly PropertyGroupId[];
  filters: PropertyFilterState;
  onChange: (filters: PropertyFilterState) => void;
}

const sectionTitleClass = 'm-0 text-meta font-semibold text-secondary';
const chipClass =
  'inline-flex min-h-[32px] items-center gap-(--mb-space-1) rounded-pill border border-border bg-surface-subtle px-(--mb-space-3) text-small font-semibold text-primary';
const swatchButtonClass = cx(
  'inline-flex size-9 cursor-pointer items-center justify-center rounded-full border border-border bg-transparent p-0 text-primary',
  'aria-pressed:ring-2 aria-pressed:ring-accent aria-pressed:ring-offset-2 aria-pressed:ring-offset-(--mb-color-surface-elevated)',
  'focus-visible:outline-offset-2',
);

/** A small glyph for the two groups that have no colour of their own to read at a glance. */
function GroupGlyph({ group }: { group: PropertyGroupId }) {
  if (group === 'railway')
    return (
      <svg
        viewBox="0 0 20 20"
        className="size-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      >
        <path
          d="M5 3h10v9H5zM5 8h10M7 15l-2 3M13 15l2 3M7 12h.01M13 12h.01"
          strokeLinecap="round"
        />
      </svg>
    );
  return (
    <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M10 2a5 5 0 0 0-3 9v2h6v-2a5 5 0 0 0-3-9zM8 16h4M9 18h2" strokeLinecap="round" />
    </svg>
  );
}

/**
 * One "Filters (N)" button with a popover (Owner, Group); the active filters are removable chips
 * only when something is selected. The popover is rendered inside the sheet, not in the page body,
 * because the sheet makes everything outside itself inert.
 */
export function PropertyFilters({ players, groupIds, filters, onChange }: PropertyFiltersProps) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const count = activeFilterCount(filters);

  useEffect(() => {
    if (!open) return;
    const closeFromOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeFromOutside);
    return () => document.removeEventListener('pointerdown', closeFromOutside);
  }, [open]);

  // Escape closes the popover only; the sheet stays open.
  const closeOnEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !open) return;
    event.stopPropagation();
    setOpen(false);
  };
  const setOwner = (owner: OwnerFilter) => onChange({ ...filters, owner });
  const toggleGroup = (group: PropertyGroupId) =>
    onChange({
      ...filters,
      groups: filters.groups.includes(group)
        ? filters.groups.filter((candidate) => candidate !== group)
        : [...filters.groups, group],
    });
  const ownerName = (owner: OwnerFilter): string =>
    owner === 'FREE'
      ? t('propertyFilterFree')
      : (players.find((player) => player.id === owner)?.name ?? owner);
  const owners: { value: OwnerFilter; label: string }[] = [
    { value: 'ALL', label: t('propertyFilterAll') },
    { value: 'FREE', label: t('propertyFilterFree') },
    ...players.map((player) => ({ value: player.id, label: player.name })),
  ];

  return (
    <div className="grid gap-(--mb-space-2)" onKeyDown={closeOnEscape}>
      <div ref={rootRef} className="relative">
        <Button
          variant="secondary"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          onClick={() => setOpen(!open)}
        >
          {count === 0 ? t('propertyFilters') : t('propertyFiltersCount', { count })}
        </Button>
        {open && (
          <div
            id={panelId}
            role="group"
            aria-label={t('propertyFilters')}
            className="glass-popover absolute inset-s-0 top-full z-10 mt-(--mb-space-2) grid w-[min(100%,24rem)] gap-(--mb-space-3) rounded-card border border-border bg-surface-elevated p-(--mb-space-3) shadow-lg"
          >
            <div
              className="grid gap-(--mb-space-2)"
              role="group"
              aria-label={t('propertyFilterPlayer')}
            >
              <h4 className={sectionTitleClass}>{t('propertyFilterPlayer')}</h4>
              <div className="flex flex-wrap gap-(--mb-space-2)">
                {owners.map((option) => (
                  <Button
                    key={option.value}
                    variant="secondary"
                    aria-pressed={filters.owner === option.value}
                    onClick={() => setOwner(option.value)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>
            <div
              className="grid gap-(--mb-space-2)"
              role="group"
              aria-label={t('propertyFilterGroup')}
            >
              <h4 className={sectionTitleClass}>{t('propertyFilterGroup')}</h4>
              <div className="flex flex-wrap gap-(--mb-space-2)">
                {groupIds.map((group) => (
                  <button
                    key={group}
                    type="button"
                    className={swatchButtonClass}
                    aria-pressed={filters.groups.includes(group)}
                    aria-label={t(propertyGroupKeys[group])}
                    title={t(propertyGroupKeys[group])}
                    onClick={() => toggleGroup(group)}
                    style={
                      group === 'railway' || group === 'utility'
                        ? undefined
                        : { backgroundColor: propertyGroupColors[group] }
                    }
                  >
                    {(group === 'railway' || group === 'utility') && <GroupGlyph group={group} />}
                  </button>
                ))}
              </div>
            </div>
            {count > 0 && (
              <Button variant="quiet" onClick={() => onChange(noPropertyFilters)}>
                {t('propertyFilterClear')}
              </Button>
            )}
          </div>
        )}
      </div>
      {count > 0 && (
        <ul className="m-0 flex list-none flex-wrap gap-(--mb-space-2) p-0">
          {filters.owner !== 'ALL' && (
            <li>
              <button
                type="button"
                className={chipClass}
                aria-label={t('propertyFilterRemove', { name: ownerName(filters.owner) })}
                onClick={() => setOwner('ALL')}
              >
                {ownerName(filters.owner)} <span aria-hidden="true">×</span>
              </button>
            </li>
          )}
          {filters.groups.map((group) => (
            <li key={group}>
              <button
                type="button"
                className={chipClass}
                aria-label={t('propertyFilterRemove', { name: t(propertyGroupKeys[group]) })}
                onClick={() => toggleGroup(group)}
              >
                <span
                  aria-hidden="true"
                  className="inline-block size-3 rounded-full border border-border"
                  style={{ backgroundColor: propertyGroupColors[group] }}
                />
                {t(propertyGroupKeys[group])} <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
