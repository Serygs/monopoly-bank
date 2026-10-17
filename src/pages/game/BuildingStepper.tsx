import type { BoardSnapshot, PropertyGroupId } from '../../../shared/board';
import { buildCost, offendingStreets, sellRefund } from '../../../shared/domain/property';
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
  registryOf,
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
  'inline-flex size-11 cursor-pointer items-center justify-center rounded-full border border-border bg-surface-elevated p-0 text-heading-lg leading-none text-primary',
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
  const label = (level: number) => buildingLabel(level) ?? t('buildingNone');
  // Streets that cause an invalid plan, each with its own reason under its row.
  const offenders = new Map<string, string>();
  if (!preview.ok && streets[0] !== undefined) {
    const code = preview.reason;
    for (const id of offendingStreets(
      { board, registry: registryOf(views) },
      streets[0].tile.id,
      code,
      Object.fromEntries(streets.map((view) => [view.tile.id, levelOf(view)])),
      mode,
    ))
      offenders.set(
        id,
        t(
          code === 'BUILD_MORTGAGED_GROUP'
            ? 'buildingStreetMortgaged'
            : sell
              ? 'buildingStreetTooLow'
              : 'buildingStreetTooHigh',
        ),
      );
  }
  // Totals follow the wanted levels even while the plan is invalid, so the cost is never hidden.
  const unitPrice = (view: TileView) =>
    sell ? sellRefund(board, view.tile.id) : buildCost(board, view.tile.id);
  const changeOf = (view: TileView) => (sell ? -1 : 1) * (levelOf(view) - view.houses);
  const changed = streets.filter((view) => changeOf(view) > 0);
  const amount = changed.reduce((sum, view) => sum + changeOf(view) * unitPrice(view), 0);
  const buildings = changed.reduce((sum, view) => sum + changeOf(view), 0);
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
            const offence = offenders.get(view.tile.id);
            const delta = changeOf(view);
            return (
              <div key={view.tile.id} data-tile={view.tile.id} className="grid gap-(--mb-space-1)">
                <div
                  aria-invalid={offence !== undefined || undefined}
                  className={cx(
                    'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-(--mb-space-3) rounded-control border bg-surface-elevated p-(--mb-space-2) ps-(--mb-space-3)',
                    offence === undefined
                      ? 'border-border'
                      : 'border-danger bg-danger-soft shadow-[inset_0_0_0_1px_var(--mb-color-danger)]',
                  )}
                >
                  <span className="flex min-w-0 items-center gap-(--mb-space-2)">
                    <span
                      aria-hidden="true"
                      className="inline-block size-3 shrink-0 rounded-full border border-border"
                      style={{ backgroundColor: propertyGroupColors[view.tile.group] }}
                    />
                    <span className="grid min-w-0">
                      <span className="text-small font-semibold wrap-anywhere">
                        {view.tile.name}
                      </span>
                      <small className="text-secondary">
                        {level === view.houses
                          ? label(level)
                          : t('buildingFromTo', { from: label(view.houses), to: label(level) })}
                      </small>
                      {delta > 0 && (
                        <small className="font-money font-semibold text-primary tabular-nums">
                          {t(sell ? 'buildingStreetRefund' : 'buildingStreetCost', {
                            amount: formatMoney(delta * unitPrice(view), currency),
                          })}
                        </small>
                      )}
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
                {offence !== undefined && (
                  <FieldError as="p" announce>
                    {offence}
                  </FieldError>
                )}
              </div>
            );
          })}
          <Button variant="secondary" onClick={() => shift(sell ? -1 : 1)}>
            {t(sell ? 'buildingRemoveAll' : 'buildingAddAll')}
          </Button>
          <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-(--mb-space-4) gap-y-[2px] text-small [&_dd]:m-0 [&_dd]:text-end [&_dd]:font-semibold [&_dt]:text-secondary">
            <dt>{t('buildingSummaryCount')}</dt>
            <dd>{buildings}</dd>
            <dt>{t(sell ? 'buildingSummaryRefund' : 'buildingSummaryCost')}</dt>
            <dd className="font-money tabular-nums">{formatMoney(amount, currency)}</dd>
            <dt>{t('buildingSummaryBalance')}</dt>
            <dd className="font-money tabular-nums">{formatMoney(after, currency)}</dd>
          </dl>
          {reason !== null && (
            <FieldError
              as="p"
              id="building-reason"
              announce={preview.ok === false && preview.reason !== 'NOTHING'}
            >
              {reason}
            </FieldError>
          )}
        </fieldset>
      )}
    </div>
  );
}
