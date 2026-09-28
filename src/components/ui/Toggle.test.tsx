import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Toggle } from './Toggle';

function ControlledToggle({ variant }: { variant?: 'setting' | 'inline' }) {
  const [checked, setChecked] = useState(false);
  return <Toggle label="Sound" checked={checked} onChange={setChecked} variant={variant} />;
}

describe('Toggle', () => {
  it('renders the settings row with the label before a native checkbox', () => {
    render(<Toggle label="Sound" checked onChange={() => {}} />);
    const checkbox = screen.getByRole('checkbox', { name: 'Sound' });
    expect(checkbox).toBeChecked();
    const label = checkbox.closest('label');
    expect(label).toHaveClass('settings-toggle');
    expect(label?.firstElementChild?.tagName).toBe('SPAN');
    expect(label?.lastElementChild).toBe(checkbox);
  });

  it('renders the inline variant with the checkbox first and no wrapper class', () => {
    render(<Toggle variant="inline" label="Alice" checked={false} onChange={() => {}} />);
    const checkbox = screen.getByRole('checkbox', { name: 'Alice' });
    const label = checkbox.closest('label');
    expect(label).not.toHaveAttribute('class');
    expect(label?.firstElementChild).toBe(checkbox);
  });

  it.each(['setting', 'inline'] as const)(
    'toggles from the keyboard in the %s variant',
    async (variant) => {
      const user = userEvent.setup();
      render(<ControlledToggle variant={variant} />);
      const checkbox = screen.getByRole('checkbox', { name: 'Sound' });
      await user.tab();
      expect(checkbox).toHaveFocus();
      await user.keyboard(' ');
      expect(checkbox).toBeChecked();
      await user.keyboard(' ');
      expect(checkbox).not.toBeChecked();
    },
  );

  it('reports the next checked state and toggles from its label', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Toggle label="Vibration" checked={false} onChange={onChange} />);
    await user.click(screen.getByText('Vibration'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('does not toggle when disabled', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Toggle label="Sound" checked={false} disabled onChange={onChange} />);
    await user.click(screen.getByRole('checkbox', { name: 'Sound' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
