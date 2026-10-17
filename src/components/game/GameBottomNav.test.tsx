import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageProvider';
import { GameBottomNav, type GameBottomNavProps } from './GameBottomNav';

function renderNav(overrides: Partial<GameBottomNavProps> = {}) {
  const props: GameBottomNavProps = {
    hasPending: false,
    payDisabled: false,
    activityDisabled: false,
    toolsDisabled: false,
    onOpenTools: vi.fn(),
    onPay: vi.fn(),
    onOpenActivity: vi.fn(),
    onOpenStatistics: vi.fn(),
    ...overrides,
  };
  const view = render(
    <LanguageProvider>
      <GameBottomNav {...props} />
    </LanguageProvider>,
  );
  return { props, user: userEvent.setup(), ...view };
}

describe('GameBottomNav', () => {
  it('lists the four destinations in order inside a labelled navigation', () => {
    renderNav();
    const nav = screen.getByRole('navigation', { name: 'Game navigation' });
    const buttons = Array.from(nav.querySelectorAll('button')).map((button) =>
      button.textContent?.trim(),
    );
    expect(buttons).toEqual(['Activity', 'Statistics', 'Tools', 'Pay']);
  });

  it('adds the Property item without a count badge only for board games', async () => {
    const onOpen = vi.fn();
    const { user } = renderNav({ property: { onOpen } });
    const nav = screen.getByRole('navigation', { name: 'Game navigation' });
    expect(nav.querySelectorAll('button')).toHaveLength(5);
    expect(nav.textContent).not.toMatch(/\d/);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Property/ }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('keeps four items when the game has no board', () => {
    renderNav();
    expect(screen.queryByRole('button', { name: /Property/ })).toBeNull();
  });

  it('opens Tools as a sheet', async () => {
    const { props, user } = renderNav();
    await user.click(screen.getByRole('button', { name: 'Tools' }));
    expect(props.onOpenTools).toHaveBeenCalledTimes(1);
  });

  it('runs the pay, activity and statistics actions', async () => {
    const { props, user } = renderNav();
    await user.click(screen.getByRole('button', { name: 'Pay' }));
    await user.click(screen.getByRole('button', { name: 'Activity' }));
    await user.click(screen.getByRole('button', { name: 'Statistics' }));
    expect(props.onPay).toHaveBeenCalledTimes(1);
    expect(props.onOpenActivity).toHaveBeenCalledTimes(1);
    expect(props.onOpenStatistics).toHaveBeenCalledTimes(1);
  });

  it('disables each action by its own flag', () => {
    renderNav({ payDisabled: true, activityDisabled: true, toolsDisabled: true });
    expect(screen.getByRole('button', { name: 'Pay' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Activity' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Statistics' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Tools' })).toBeDisabled();
  });

  it('shows a neutral dot on Activity only while something waits for the viewer', () => {
    const first = renderNav({ hasPending: false });
    expect(screen.queryByText('A request is waiting for your answer')).not.toBeInTheDocument();
    first.unmount();
    renderNav({ hasPending: true });
    expect(screen.getByText('A request is waiting for your answer')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('navigation').textContent).not.toMatch(/\d/);
  });
});
