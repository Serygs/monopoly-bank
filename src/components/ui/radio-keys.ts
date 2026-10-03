import type { KeyboardEvent } from 'react';

/**
 * `onKeyDown` for a Headless UI `Radio`. The library's `RadioGroup` submits the surrounding
 * form on Enter; stopping the event at the option keeps it from reaching the group's handler,
 * while a `<button type="button">` option still activates (selects) on Enter as it did before.
 */
export function keepEnterInRadio(event: KeyboardEvent<HTMLElement>) {
  if (event.key === 'Enter') event.stopPropagation();
}
