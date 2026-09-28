import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
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
  it('renders the settings track without a group role and marks the active option', () => {
    const { container } = render(<ControlledSegmentedControl columns={3} />);
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
    const track = container.firstElementChild;
    expect(track?.getAttribute('class')).toBe('settings-segmented settings-segmented--three');
    const light = screen.getByRole('button', { name: 'Light' });
    expect(light).toHaveAttribute('aria-pressed', 'true');
    expect(light).toHaveClass('active');
    const dark = screen.getByRole('button', { name: 'Dark' });
    expect(dark).toHaveAttribute('aria-pressed', 'false');
    expect(dark).not.toHaveAttribute('class');
  });

  it('uses the two-column track by default', () => {
    const { container } = render(<ControlledSegmentedControl />);
    expect(container.firstElementChild?.getAttribute('class')).toBe('settings-segmented');
  });

  it('renders the filter variant as a labelled group of filter buttons', () => {
    render(
      <ControlledSegmentedControl
        variant="filter"
        label="Filter games"
        className="saved-games-filters"
      />,
    );
    const group = screen.getByRole('group', { name: 'Filter games' });
    expect(group).toHaveClass('saved-games-filters');
    expect(screen.getByRole('button', { name: 'Light', pressed: true }).getAttribute('class')).toBe(
      'button button-filter active',
    );
    expect(screen.getByRole('button', { name: 'Dark' }).getAttribute('class')).toBe(
      'button button-filter',
    );
  });

  it.each(['settings', 'filter'] as const)(
    'moves the selection from the keyboard in the %s variant',
    async (variant) => {
      const user = userEvent.setup();
      render(<ControlledSegmentedControl variant={variant} label="Mode" />);
      await user.tab();
      expect(screen.getByRole('button', { name: 'Light' })).toHaveFocus();
      await user.tab();
      const dark = screen.getByRole('button', { name: 'Dark' });
      expect(dark).toHaveFocus();
      await user.keyboard('{Enter}');
      expect(dark).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: 'Light' })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
      await user.tab();
      await user.keyboard(' ');
      expect(screen.getByRole('button', { name: 'System', pressed: true })).toHaveFocus();
      expect(screen.getAllByRole('button', { pressed: true })).toHaveLength(1);
    },
  );
});
