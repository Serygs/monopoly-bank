import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SegmentedControl, type SegmentedControlProps } from './SegmentedControl';

type Mode = 'light' | 'dark' | 'system';

const modes = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
] as const;

function ControlledSegmentedControl(
  props: Omit<SegmentedControlProps<Mode>, 'value' | 'onChange' | 'options'>,
) {
  const [value, setValue] = useState<Mode>('light');
  return <SegmentedControl {...props} options={modes} value={value} onChange={setValue} />;
}

describe('SegmentedControl', () => {
  it('renders the settings track as a radio group and marks the active option', () => {
    render(<ControlledSegmentedControl columns={3} />);
    const track = screen.getByRole('radiogroup');
    expect(track.getAttribute('class')).toBe('settings-segmented settings-segmented--three');
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
    const light = screen.getByRole('radio', { name: 'Light' });
    expect(light.tagName).toBe('BUTTON');
    expect(light).toHaveAttribute('type', 'button');
    expect(light).toHaveAttribute('aria-checked', 'true');
    expect(light).toHaveAttribute('tabindex', '0');
    expect(light).toHaveClass('active');
    const dark = screen.getByRole('radio', { name: 'Dark' });
    expect(dark).toHaveAttribute('aria-checked', 'false');
    expect(dark).toHaveAttribute('tabindex', '-1');
    expect(dark).not.toHaveAttribute('class');
  });

  it('uses the two-column track by default', () => {
    render(<ControlledSegmentedControl />);
    expect(screen.getByRole('radiogroup').getAttribute('class')).toBe('settings-segmented');
  });

  it('renders the filter variant as a labelled radio group of filter buttons', () => {
    render(
      <ControlledSegmentedControl
        variant="filter"
        label="Filter games"
        className="saved-games-filters"
      />,
    );
    const group = screen.getByRole('radiogroup', { name: 'Filter games' });
    expect(group).toHaveClass('saved-games-filters');
    expect(screen.getByRole('radio', { name: 'Light', checked: true }).getAttribute('class')).toBe(
      'button button-filter active',
    );
    expect(screen.getByRole('radio', { name: 'Dark' }).getAttribute('class')).toBe(
      'button button-filter',
    );
  });

  it.each(['settings', 'filter'] as const)(
    'moves the selection with the arrow keys from one tab stop in the %s variant',
    async (variant) => {
      const user = userEvent.setup();
      render(
        <>
          <ControlledSegmentedControl variant={variant} label="Mode" />
          <button type="button">After</button>
        </>,
      );
      const light = screen.getByRole('radio', { name: 'Light' });
      const dark = screen.getByRole('radio', { name: 'Dark' });
      const system = screen.getByRole('radio', { name: 'System' });

      await user.tab();
      expect(light).toHaveFocus();
      await user.keyboard('{ArrowRight}');
      expect(dark).toHaveFocus();
      expect(dark).toHaveAttribute('aria-checked', 'true');
      expect(light).toHaveAttribute('aria-checked', 'false');

      await user.keyboard('{ArrowDown}');
      expect(screen.getByRole('radio', { name: 'System', checked: true })).toHaveFocus();
      await user.keyboard('{ArrowRight}');
      expect(screen.getByRole('radio', { name: 'Light', checked: true })).toHaveFocus();
      await user.keyboard('{ArrowLeft}');
      expect(system).toHaveFocus();
      expect(screen.getAllByRole('radio', { checked: true })).toEqual([system]);

      // One tab stop: Tab leaves the group from the checked option.
      await user.tab();
      expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
      await user.tab({ shift: true });
      expect(system).toHaveFocus();
    },
  );

  it.each(['settings', 'filter'] as const)(
    'does not submit the surrounding form on Enter in the %s variant',
    async (variant) => {
      const user = userEvent.setup();
      const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
      render(
        <form onSubmit={onSubmit}>
          <ControlledSegmentedControl variant={variant} label="Mode" />
          <button type="submit">Save</button>
        </form>,
      );
      await user.tab();
      expect(screen.getByRole('radio', { name: 'Light' })).toHaveFocus();
      await user.keyboard('{Enter}');
      expect(onSubmit).not.toHaveBeenCalled();
      screen.getByRole('radio', { name: 'Dark' }).focus();
      await user.keyboard('{Enter}');
      expect(onSubmit).not.toHaveBeenCalled();
      expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');
    },
  );

  it('selects an option with the pointer', async () => {
    const user = userEvent.setup();
    render(<ControlledSegmentedControl variant="filter" label="Mode" />);
    await user.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getAllByRole('radio', { checked: true })).toHaveLength(1);
  });
});
