import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Player } from '../../../shared/types/monopoly';
import { PlayerPicker } from './PlayerPicker';

function player(id: string, name: string, balance: number): Player {
  return { id, gameId: 'g1', name, color: '#2563eb', balance, createdAt: '' };
}

const taras = player('p2', 'Taras', 1_000);
const iryna = player('p3', 'Iryna', 2_000);
const everyone = [player('p1', 'Olena', 500), taras, iryna];

describe('PlayerPicker', () => {
  it('shows a lone recipient as one read-only line instead of a choice', () => {
    render(
      <PlayerPicker
        label="Choose recipient"
        players={[taras]}
        gamePlayers={everyone}
        value="p2"
        currency="USD"
        onChange={vi.fn()}
      />,
    );
    const group = screen.getByRole('group', { name: 'Choose recipient' });
    expect(group).toHaveTextContent('Taras');
    expect(group).toHaveTextContent('1 000');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('offers each recipient as a pressed-state button when there are several', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <PlayerPicker
        label="Choose recipient"
        players={[taras, iryna]}
        gamePlayers={everyone}
        value="p3"
        currency="USD"
        onChange={onChange}
      />,
    );
    expect(screen.getByRole('button', { name: /Iryna/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Taras/ })).toHaveAttribute('aria-pressed', 'false');
    await user.click(screen.getByRole('button', { name: /Taras/ }));
    expect(onChange).toHaveBeenCalledWith('p2');
  });
});
