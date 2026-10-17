import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CountBadge, GroupHeader, SelectableRow, StatTile, ToggleRow } from './index';

describe('GroupHeader', () => {
  it('shows name, count and price range, opaque and pinned when sticky', () => {
    render(<GroupHeader color="#8b5a2b" name="Brown" count={2} priceRange="$60 – $60" sticky />);
    const header = screen.getByRole('heading', { name: /Brown/ });
    expect(header).toHaveClass('sticky', 'glass-popover', 'bg-surface-elevated');
    expect(header).toHaveTextContent('2');
    expect(header).toHaveTextContent('$60 – $60');
  });

  it('is not pinned by default', () => {
    render(<GroupHeader color="#000" name="Red" />);
    expect(screen.getByRole('heading', { name: 'Red' })).not.toHaveClass('sticky');
  });
});

describe('SelectableRow', () => {
  it('reports selection through aria-pressed and calls onSelect', async () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <SelectableRow selected={false} onSelect={onSelect} title="Mayfair" />,
    );
    const row = screen.getByRole('button', { name: 'Mayfair' });
    expect(row).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(row);
    expect(onSelect).toHaveBeenCalledOnce();
    rerender(<SelectableRow selected onSelect={onSelect} title="Mayfair" indicator="radio" />);
    expect(screen.getByRole('button', { name: 'Mayfair' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('ToggleRow', () => {
  it('is a labelled switch', async () => {
    const onChange = vi.fn();
    render(<ToggleRow label="I also pay cash" checked={false} onChange={onChange} />);
    await userEvent.click(screen.getByRole('switch', { name: 'I also pay cash' }));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('CountBadge and StatTile', () => {
  it('render their text', () => {
    render(
      <>
        <CountBadge>3</CountBadge>
        <StatTile label="Cards" value="5" hint="worth $900" />
      </>,
    );
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Cards')).toBeInTheDocument();
    expect(screen.getByText('worth $900')).toBeInTheDocument();
  });
});
