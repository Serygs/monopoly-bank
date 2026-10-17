import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { monopolyBankApi } from '../../api/monopoly-bank-api';
import { FeedbackProvider } from '../../components/ui';
import { LanguageProvider } from '../../i18n/LanguageProvider';
import { InviteDialog } from './InviteDialog';

function renderDialog(props: Partial<Parameters<typeof InviteDialog>[0]> = {}) {
  return render(
    <LanguageProvider>
      <FeedbackProvider>
        <InviteDialog joinCode="ABC123" gameId="g1" onClose={vi.fn()} {...props} />
      </FeedbackProvider>
    </LanguageProvider>,
  );
}

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
});

describe('InviteDialog', () => {
  it('shows the spaced code, the QR on a white tile and the lobby facts', () => {
    renderDialog({ playerCount: 3, hasPassword: true });
    expect(screen.getByRole('button', { name: /Copy game code ABC 123/ })).toHaveTextContent(
      'ABC 123',
    );
    const qr = screen.getByRole('img');
    expect(qr.parentElement).toHaveClass('bg-qr-background', 'p-8');
    expect(qr.parentElement).toHaveClass('text-qr-modules');
    expect(screen.getByText('Players in the lobby').nextSibling).toHaveTextContent('3');
    expect(screen.getByText('Table password').nextSibling).toHaveTextContent('Set');
  });

  it('makes Copy the primary action without Web Share and shows Copied for two seconds', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderDialog();
    expect(screen.queryByRole('button', { name: 'Share invite' })).toBeNull();
    const copy = screen.getByRole('button', { name: 'Copy invite link' });
    expect(copy).toHaveClass('button-primary');
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await act(async () => copy.click());
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/games/join?code=ABC123'));
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(2100);
    });
    expect(screen.getByRole('button', { name: 'Copy invite link' })).toBeInTheDocument();
  });

  it('puts Share first when the browser can share', () => {
    Object.defineProperty(navigator, 'share', { value: vi.fn(), configurable: true });
    renderDialog();
    expect(screen.getByRole('button', { name: 'Share invite' })).toHaveClass('button-primary');
    expect(screen.getByRole('button', { name: 'Copy invite link' })).toHaveClass(
      'button-secondary',
    );
  });

  it('regenerates the code only after a confirmation, for the owner', async () => {
    const regenerate = vi
      .spyOn(monopolyBankApi, 'regenerateJoinCode')
      .mockResolvedValue({ joinCode: 'ZZZ999' });
    const onCodeChanged = vi.fn();
    const user = userEvent.setup();
    renderDialog({ canRegenerate: true, onCodeChanged });
    await user.click(screen.getByRole('button', { name: 'Regenerate code' }));
    expect(regenerate).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Regenerate' }));
    expect(regenerate).toHaveBeenCalledWith('g1');
    expect(onCodeChanged).toHaveBeenCalledWith('ZZZ999');
    expect(await screen.findByRole('button', { name: /Copy game code ZZZ 999/ })).toBeVisible();
    regenerate.mockRestore();
  });

  it('hides Regenerate from players who are not the owner', () => {
    renderDialog();
    expect(screen.queryByRole('button', { name: 'Regenerate code' })).toBeNull();
  });
});
