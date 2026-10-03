import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AVATAR_OPTIONS } from '../../utils/avatar';
import { formatMoney } from '../../utils/money';
import { PlayerRow } from './PlayerRow';

const player = { name: 'Alice', color: '#d83f55', balance: 1_500_000 };

describe('PlayerRow', () => {
  it('shows the player name and balance formatted by the money helpers', () => {
    render(<PlayerRow player={player} currency="USD" />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText(formatMoney(1_500_000, 'USD'))).toBeInTheDocument();
  });

  it('prefers an explicit display name over the player name', () => {
    render(<PlayerRow player={player} currency="EUR" name="Alice · #AB12" />);
    expect(screen.getByText('Alice · #AB12')).toBeInTheDocument();
    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
  });

  it('falls back to the colour swatch when no avatar is given', () => {
    const { container } = render(<PlayerRow player={player} currency="USD" />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(container.querySelector('.player-color')).toHaveStyle({
      backgroundColor: player.color,
    });
  });

  it('renders an emoji avatar through Avatar with an accessible name', () => {
    render(<PlayerRow player={player} currency="USD" avatar={AVATAR_OPTIONS[0]} />);
    const avatar = screen.getByRole('img', { name: 'Alice' });
    expect(avatar).toHaveClass('avatar', 'avatar-icon');
    expect(avatar).toHaveTextContent(AVATAR_OPTIONS[0]);
  });

  it('renders an uploaded avatar image labelled with the display name', () => {
    render(
      <PlayerRow
        player={player}
        currency="USD"
        name="Alice · #AB12"
        avatar="data:image/jpeg;base64,AA=="
      />,
    );
    const avatar = screen.getByRole('img', { name: 'Alice · #AB12' });
    expect(avatar.tagName).toBe('IMG');
    expect(avatar).toHaveClass('avatar');
  });
});
