import { FieldHint } from '../../components/ui';
import { useLanguage } from '../../i18n/language-context';
import { propertyGroupColors, type TileView } from '../../utils/property-view';
import { pickerClass } from './picker-class';

export interface TilePickerItem {
  view: TileView;
  /** The small line under the name: price, mortgage value, redemption cost or rent. */
  caption?: string;
}

export interface TilePickerProps {
  legend: string;
  items: readonly TilePickerItem[];
  /** The chosen tile id, or an empty string. */
  value: string;
  onChange: (view: TileView) => void;
}

/** A list of board tiles to choose from, each with its group colour; only valid choices are passed in. */
export function TilePicker({ legend, items, value, onChange }: TilePickerProps) {
  const { t } = useLanguage();
  return (
    <fieldset className={pickerClass}>
      <legend>{legend}</legend>
      {items.length === 0 && <FieldHint>{t('tilePickerEmpty')}</FieldHint>}
      {items.map(({ view, caption }) => (
        <button
          type="button"
          key={view.tile.id}
          aria-pressed={value === view.tile.id}
          onClick={() => onChange(view)}
        >
          <span className="flex items-center gap-(--mb-space-2)">
            <span
              aria-hidden="true"
              className="inline-block size-3 shrink-0 rounded-full border border-border"
              style={{ backgroundColor: propertyGroupColors[view.tile.group] }}
            />
            <span>{view.tile.name}</span>
          </span>
          {caption !== undefined && <small>{caption}</small>}
        </button>
      ))}
    </fieldset>
  );
}
