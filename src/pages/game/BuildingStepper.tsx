import type { BoardSnapshot, PropertyGroupId } from '../../../shared/board';
import { propertyGroupKeys, useBuildingLabel } from '../../components/game/property-labels';
import { Button, FieldError, FieldHint } from '../../components/ui';
import { cx } from '../../components/ui/class-names';
import { useLanguage } from '../../i18n/language-context';
import type { Currency } from '../../../shared/types/monopoly';
import { formatMoney } from '../../utils/money';
import {
  groupStreets,
  levelBounds,
  previewBuildings,
  propertyGroupColors,
  type BuildMode,
  type TileView,
} from '../../utils/property-view';
import { pickerClass } from './picker-class';

export interface BuildingStepperProps {
  board: BoardSnapshot;
  views: readonly TileView[];
  playerId: string;
  mode: BuildMode;
  /** The groups the player may build in (or sell from) now. */
  groups: readonly PropertyGroupId[];
  group: PropertyGroupId | '';
  onGroupChange: (group: PropertyGroupId) => void;
  /** The level wanted for each street of the group (tile id -> 0-5). */
  levels: Readonly<Record<string, number>>;
  onLevelsChange: (levels: Record<string, number>) => void;
  balance: number;
  currency: Currency;
}

const reasonKeys = {
  BUILD_UNEVEN: 'buildingReasonUneven',
  BUILD_MORTGAGED_GROUP: 'buildingReasonMortgaged',
} as const;

const stepButtonClass = cx(
  'inline-flex size-10 cursor-pointer items-center justify-center rounded-full border border-border bg-surface-elevated p-0 text-heading-lg leading-none text-primary',
  'disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-offset-2',
);

/**
 * Sets the buildings of a whole colour group: one stepper per street (0-5, 5 is the hotel), a
 * "+1 for the whole group" shortcut and a live summary. The final state is validated with the same
 * rule as the Worker (`previewBuildings`), and the reason is shown while the form cannot go on.
 */
export function BuildingStepper({
  board,
  views,
  playerId,
  mode,
  groups,
  group,
  onGroupChange,
  levels,
  onLevelsChange,
  balance,
  currency,
}: BuildingStepperProps) {
  const { t } = useLanguage();
  const buildingLabel = useBuildingLabel();
  const sell = mode === 'SELL';
  const streets = group === '' ? [] : groupStreets(views, group);
  const levelOf = (view: TileView) => levels[view.tile.id] ?? view.houses;
  const setLevel = (view: TileView, level: number) =>
    onLevelsChange({ ...levels, [view.tile.id]: level });
  const shift = (delta: 1 | -1) =>
    onLevelsChange(
      Object.fromEntries(
        streets.map((view) => {
          const { min, max } = levelBounds(view, mode);
          return [view.tile.id, Math.min(max, Math.max(min, levelOf(view) + delta))];
        }),
      ),
    );
  const preview = previewBuildings(board, views, playerId, levels, mode);
  const reason = preview.ok
    ? null
    : preview.reason === 'NOTHING'
      ? t('buildingReasonNothing')
      : t(reasonKeys[preview.reason as keyof typeof reasonKeys] ?? 'buildingReasonGeneric');
  const amount = preview.ok ? preview.amount : 0;
  const after = sell ? balance + amount : balance - amount;

  return (
    <div className="grid gap-(--mb-space-3)">
      {groups.length === 0 && <FieldHint>{t('tilePickerEmpty')}</FieldHint>}
      {groups.length > 1 && (
        <fieldset className={pickerClass}>
          <legend>{t('buildingGroup')}</legend>
          <div className="flex flex-wrap gap-(--mb-space-2)">
            {groups.map((candidate) => (
              <button
                type="button"
                key={candidate}
                aria-pressed={group === candidate}
                className="flex items-center gap-(--mb-space-2)"
                onClick={() => onGroupChange(candidate)}
              >
                <span
                  aria-hidden="true"
                  className="inline-block size-3 shrink-0 rounded-full border border-border"
                  style={{ backgroundColor: propertyGroupColors[candidate] }}
                />
                {t(propertyGroupKeys[candidate])}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      {group !== '' && (
        <fieldset className="m-0 grid gap-(--mb-space-2) border-0 p-0">
          <legend className="mb-(--mb-space-2) font-semibold text-primary">
            {t(sell ? 'tileChooseSellBuilding' : 'tileChooseBuild')}
          </legend>
          {streets.map((view) => {
            const { min, max } = levelBounds(view, mode);
            const level = levelOf(view);
            return (
              <div
                key={view.tile.id}
                data-tile={view.tile.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-(--mb-space-3) rounded-control border border-border bg-surface-elevated p-(--mb-space-2) ps-(--mb-space-3)"
              >
                <span className="flex min-w-0 items-center gap-(--mb-space-2)">
                  <span
                    aria-hidden="true"
                    className="inline-block size-3 shrink-0 rounded-full border border-border"
                    style={{ backgroundColor: propertyGroupColors[view.tile.group] }}
                  />
                  <span className="grid min-w-0">
                    <span className="text-small font-semibold wrap-anywhere">{view.tile.name}</span>
                    <small className="text-secondary">
                      {buildingLabel(level) ?? t('buildingNone')}
                    </small>
                  </span>
                </span>
                <span className="flex items-center gap-(--mb-space-2)">
                  <button
                    type="button"
                    className={stepButtonClass}
                    disabled={level <= min}
                    aria-label={t('buildingRemove', { name: view.tile.name })}
                    onClick={() => setLevel(view, level - 1)}
                  >
                    −
                  </button>
                  <output
                    className="min-w-6 text-center font-money text-body font-semibold tabular-nums"
                    aria-live="polite"
                  >
                    {level}
                  </output>
                  <button
                    type="button"
                    className={stepButtonClass}
                    disabled={level >= max}
                    aria-label={t('buildingAdd', { name: view.tile.name })}
                    onClick={() => setLevel(view, level + 1)}
                  >
                    +
                  </button>
                </span>
              </div>
            );
          })}
          <Button variant="secondary" onClick={() => shift(sell ? -1 : 1)}>
            {t(sell ? 'buildingRemoveAll' : 'buildingAddAll')}
          </Button>
          <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-(--mb-space-4) gap-y-[2px] text-small [&_dd]:m-0 [&_dd]:text-end [&_dd]:font-semibold [&_dt]:text-secondary">
            <dt>{t('buildingSummaryCount')}</dt>
            <dd>{preview.ok ? preview.buildings : 0}</dd>
            <dt>{t(sell ? 'buildingSummaryRefund' : 'buildingSummaryCost')}</dt>
            <dd className="font-money tabular-nums">{formatMoney(amount, currency)}</dd>
            <dt>{t('buildingSummaryBalance')}</dt>
            <dd className="font-money tabular-nums">{formatMoney(after, currency)}</dd>
          </dl>
          {reason !== null && (
            <FieldError as="p" announce={preview.ok === false && preview.reason !== 'NOTHING'}>
              {reason}
            </FieldError>
          )}
        </fieldset>
      )}
    </div>
  );
}
