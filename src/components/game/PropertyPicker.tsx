import { orderTilesForPicker } from '../../../shared/domain/property';
import type { Currency } from '../../../shared/types/monopoly';
import { useLanguage } from '../../i18n/language-context';
import { formatMoney } from '../../utils/money';
import { propertyGroupColors, type TileView } from '../../utils/property-view';
import { FieldHint, GroupHeader, SelectableRow } from '../ui';
import { propertyGroupKeys } from './property-labels';

export interface PropertyPickerItem {
  view: TileView;
  /** The small line under the name: price, mortgage value, redemption cost or rent. */
  caption?: string;
}

interface PropertyPickerBase {
  legend: string;
  items: readonly PropertyPickerItem[];
  /** Hides tiles the flow cannot use; callers may also pre-filter. */
  eligible?: (view: TileView) => boolean;
  /** With a currency, each colour group header shows its price range. */
  currency?: Currency;
}

export type PropertyPickerProps = PropertyPickerBase &
  (
    | {
        mode: 'single';
        /** The chosen tile id, or an empty string. */
        value: string;
        onChange: (view: TileView) => void;
      }
    | {
        mode: 'multi';
        /** The chosen tile ids. */
        values: readonly string[];
        onToggle: (view: TileView) => void;
      }
  );

/**
 * The one tile picker (buy, mortgage, redeem, auction, rent, trade): free tiles first, owned
 * last, grouped by colour group with a header, ascending price inside a group. `single` marks
 * the choice with a radio indicator, `multi` with a check box; both keep `aria-pressed`.
 */
export function PropertyPicker(props: PropertyPickerProps) {
  const { legend, items, eligible, currency } = props;
  const { t } = useLanguage();
  const usable = eligible === undefined ? items : items.filter((item) => eligible(item.view));
  const captions = new Map(usable.map((item) => [item.view.tile.id, item.caption]));
  const sections = orderTilesForPicker(usable.map((item) => item.view));
  const isSelected = (view: TileView) =>
    props.mode === 'single' ? props.value === view.tile.id : props.values.includes(view.tile.id);
  const select = (view: TileView) =>
    props.mode === 'single' ? props.onChange(view) : props.onToggle(view);
  return (
    <fieldset className="mx-0 my-(--mb-space-3) grid gap-(--mb-space-3) border-0 p-0">
      <legend className="mb-(--mb-space-2) font-semibold text-primary">{legend}</legend>
      {usable.length === 0 && <FieldHint>{t('tilePickerEmpty')}</FieldHint>}
      {sections.map((section) => (
        <section key={section.kind} data-section={section.kind} className="grid gap-(--mb-space-3)">
          {sections.length > 1 && (
            <h4 className="m-0 text-small font-semibold text-secondary">
              {t(section.kind === 'free' ? 'propertySectionFree' : 'propertySectionOwned', {
                count: section.groups.reduce((sum, group) => sum + group.items.length, 0),
              })}
            </h4>
          )}
          {section.groups.map((group) => {
            const prices = group.items.map((view) => view.tile.price);
            const low = Math.min(...prices);
            const high = Math.max(...prices);
            return (
              <div key={group.group} data-group={group.group} className="grid gap-(--mb-space-2)">
                <GroupHeader
                  color={propertyGroupColors[group.group]}
                  name={t(propertyGroupKeys[group.group])}
                  count={group.items.length}
                  priceRange={
                    currency === undefined
                      ? undefined
                      : low === high
                        ? formatMoney(low, currency)
                        : `${formatMoney(low, currency)} – ${formatMoney(high, currency)}`
                  }
                />
                {group.items.map((view) => (
                  <SelectableRow
                    key={view.tile.id}
                    indicator={props.mode === 'single' ? 'radio' : 'check'}
                    selected={isSelected(view)}
                    onSelect={() => select(view)}
                    leading={
                      <span
                        aria-hidden="true"
                        className="inline-block size-3 shrink-0 rounded-full border border-border"
                        style={{ backgroundColor: propertyGroupColors[view.tile.group] }}
                      />
                    }
                    title={view.tile.name}
                    caption={captions.get(view.tile.id)}
                  />
                ))}
              </div>
            );
          })}
        </section>
      ))}
    </fieldset>
  );
}
