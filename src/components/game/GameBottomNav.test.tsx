import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageProvider';
import { GameBottomNav, type GameBottomNavProps } from './GameBottomNav';

function renderNav(overrides: Partial<GameBottomNavProps> = {}) {
  const props: GameBottomNavProps = {
    pendingRequests: 0,
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

  it('shows a pending-request count only when there are requests', () => {
    const first = renderNav({ pendingRequests: 0 });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    first.unmount();
    renderNav({ pendingRequests: 2 });
    expect(screen.getByRole('status', { name: '2 pending payment requests' })).toHaveTextContent(
      '2',
    );
  });
});
