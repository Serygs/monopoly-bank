import { PropertyPicker, type PropertyPickerItem } from '../../components/game/PropertyPicker';
import type { Currency } from '../../../shared/types/monopoly';
import type { TileView } from '../../utils/property-view';

export type TilePickerItem = PropertyPickerItem;

export interface TilePickerProps {
  legend: string;
  items: readonly TilePickerItem[];
  /** The chosen tile id, or an empty string. */
  value: string;
  onChange: (view: TileView) => void;
  currency?: Currency;
}

/** Choose one board tile; only valid choices are passed in. See `PropertyPicker` for the order. */
export function TilePicker({ legend, items, value, onChange, currency }: TilePickerProps) {
  return (
    <PropertyPicker
      mode="single"
      legend={legend}
      items={items}
      value={value}
      onChange={onChange}
      currency={currency}
    />
  );
}

export interface TileMultiPickerProps {
  legend: string;
  items: readonly TilePickerItem[];
  /** The chosen tile ids. */
  values: readonly string[];
  onToggle: (view: TileView) => void;
  currency?: Currency;
}

/** Like `TilePicker`, but any number of tiles can be chosen; each press toggles one. */
export function TileMultiPicker({
  legend,
  items,
  values,
  onToggle,
  currency,
}: TileMultiPickerProps) {
  return (
    <PropertyPicker
      mode="multi"
      legend={legend}
      items={items}
      values={values}
      onToggle={onToggle}
      currency={currency}
    />
  );
}
