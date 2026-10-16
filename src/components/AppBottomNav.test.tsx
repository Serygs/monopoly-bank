import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { LanguageProvider } from '../i18n/LanguageProvider';
import { appTabForPath } from '../utils/app-tab';
import { AppBottomNav } from './AppBottomNav';

/** A stand-in for `App`: owns the path and renders the nav beside a route label. */
function Shell({ start }: { start: string }) {
  const [path, setPath] = useState(start);
  return (
    <LanguageProvider>
      <p data-testid="route">{path}</p>
      <AppBottomNav path={path} navigate={setPath} />
    </LanguageProvider>
  );
}

const route = () => screen.getByTestId('route').textContent;

describe('appTabForPath', () => {
  it('maps top-level screens to a tab and in-game paths to none', () => {
    expect(appTabForPath('/')).toBe('games');
    expect(appTabForPath('/profile')).toBe('profile');
    expect(appTabForPath('/games/new')).toBe('add');
    expect(appTabForPath('/games/join')).toBe('add');
    expect(appTabForPath('/games/abc-123')).toBeNull();
  });
});

describe('AppBottomNav', () => {
  it('stays mounted as the route changes and highlights the active tab', async () => {
    const user = userEvent.setup();
    render(<Shell start="/" />);
    const nav = screen.getByRole('navigation');
    expect(screen.getByRole('button', { name: 'Games' })).toHaveAttribute('aria-current', 'page');
    await user.click(screen.getByRole('button', { name: 'Profile' }));
    expect(route()).toBe('/profile');
    expect(screen.getByRole('navigation')).toBe(nav);
    expect(screen.getByRole('button', { name: 'Profile' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Games' })).not.toHaveAttribute('aria-current');
  });

  it('returns to Games when the active Profile tab is tapped again', async () => {
    const user = userEvent.setup();
    render(<Shell start="/profile" />);
    await user.click(screen.getByRole('button', { name: 'Profile' }));
    expect(route()).toBe('/');
  });

  it('always opens the Games list from the Games tab', async () => {
    const user = userEvent.setup();
    render(<Shell start="/games/new" />);
    await user.click(screen.getByRole('button', { name: 'Games' }));
    expect(route()).toBe('/');
  });

  it('opens the create/join sheet from the + action', async () => {
    const user = userEvent.setup();
    render(<Shell start="/" />);
    await user.click(screen.getByRole('button', { name: 'New' }));
    await user.click(screen.getByRole('button', { name: 'Join game' }));
    expect(route()).toBe('/games/join');
  });

  it('is hidden inside a game, which has its own navigation', () => {
    render(<Shell start="/games/abc-123" />);
    expect(screen.queryByRole('navigation')).toBeNull();
  });
});
