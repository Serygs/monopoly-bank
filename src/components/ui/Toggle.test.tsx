import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Toggle } from './Toggle';

function ControlledToggle({ variant }: { variant?: 'setting' | 'inline' }) {
  const [checked, setChecked] = useState(false);
  return <Toggle label="Sound" checked={checked} onChange={setChecked} variant={variant} />;
}

const roleFor = { setting: 'switch', inline: 'checkbox' } as const;

describe('Toggle', () => {
  it('renders the settings row with the label before a switch', () => {
    render(<Toggle label="Sound" checked onChange={() => {}} />);
    const toggle = screen.getByRole('switch', { name: 'Sound' });
    expect(toggle).toBeChecked();
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(toggle.tagName).not.toBe('INPUT');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    const label = toggle.closest('label');
    expect(label).toHaveClass('settings-toggle');
    expect(label?.firstElementChild?.tagName).toBe('SPAN');
    expect(label?.lastElementChild).toBe(toggle);
  });

  it('renders the inline variant as a native checkbox first, with no wrapper class', () => {
    render(<Toggle variant="inline" label="Alice" checked={false} onChange={() => {}} />);
    const toggle = screen.getByRole('checkbox', { name: 'Alice' });
    expect(toggle.tagName).toBe('INPUT');
    expect(toggle).toHaveAttribute('type', 'checkbox');
    expect(toggle).not.toBeChecked();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    const label = toggle.closest('label');
    expect(label).not.toHaveAttribute('class');
    expect(label?.firstElementChild).toBe(toggle);
    expect(label?.outerHTML).toBe('<label><input type="checkbox">Alice</label>');
  });

  it.each(['setting', 'inline'] as const)(
    'toggles from the keyboard in the %s variant',
    async (variant) => {
      const user = userEvent.setup();
      render(<ControlledToggle variant={variant} />);
      const toggle = screen.getByRole(roleFor[variant], { name: 'Sound' });
      await user.tab();
      expect(toggle).toHaveFocus();
      await user.keyboard(' ');
      expect(toggle).toBeChecked();
      await user.keyboard(' ');
      expect(toggle).not.toBeChecked();
    },
  );

  it.each(['setting', 'inline'] as const)(
    'reports the next checked state and toggles from its label in the %s variant',
    async (variant) => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<Toggle variant={variant} label="Vibration" checked={false} onChange={onChange} />);
      await user.click(screen.getByText('Vibration'));
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith(true);
    },
  );

  it.each(['setting', 'inline'] as const)(
    'does not toggle when disabled in the %s variant',
    async (variant) => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(
        <Toggle variant={variant} label="Sound" checked={false} disabled onChange={onChange} />,
      );
      const toggle = screen.getByRole(roleFor[variant], { name: 'Sound' });
      expect(toggle).toBeDisabled();
      await user.click(toggle);
      await user.click(screen.getByText('Sound'));
      expect(onChange).not.toHaveBeenCalled();
    },
  );
});
