import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WalletMenu } from './WalletMenu';

const item = (key: string) => ({ key, label: key, onSelect: vi.fn() });

describe('WalletMenu', () => {
  it('stretches the last tile of an odd set across the row', () => {
    render(<WalletMenu primary={['one', 'two', 'three'].map(item)} groups={[]} />);
    expect(screen.getByRole('button', { name: 'three' })).toHaveClass('col-span-2');
    expect(screen.getByRole('button', { name: 'one' })).not.toHaveClass('col-span-2');
  });

  it('keeps an even set balanced and draws group icons as line SVGs, not emoji', () => {
    const { container } = render(
      <WalletMenu
        primary={['one', 'two'].map(item)}
        groups={[{ key: 'p', label: 'Property', icon: 'property', items: [item('buy')] }]}
      />,
    );
    expect(screen.getByRole('button', { name: 'two' })).not.toHaveClass('col-span-2');
    const summary = container.querySelector('summary')!;
    expect(summary.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(summary.textContent).toBe('Property');
  });
});
