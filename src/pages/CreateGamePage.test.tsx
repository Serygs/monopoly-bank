import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { monopolyBankApi } from '../api/monopoly-bank-api';
import { LanguageProvider } from '../i18n/LanguageProvider';
import { LanguageContext } from '../i18n/language-context';
import { languageLocale, translate } from '../i18n/translations';
import type { UserProfile } from '../../shared/contracts/api';
import { CreateGamePage } from './CreateGamePage';
import { DRAFT_STORAGE_KEY } from './create-game-draft';

type User = ReturnType<typeof userEvent.setup>;

/** Fills the game name and presses Next `times` times, landing on step `times + 1`. */
async function advance(user: User, times: number, name = 'Friday table') {
  await user.type(screen.getByRole('textbox', { name: /Game name/i }), name);
  for (let index = 0; index < times; index += 1)
    await user.click(screen.getByRole('button', { name: 'Next' }));
}

const profile: UserProfile = {
  id: 'user-1',
  nickname: 'Alice',
  avatar: '🎩',
  accountType: 'GUEST',
  email: null,
  emailVerified: false,
  gamesPlayed: 0,
  gamesWon: 0,
  gamesLost: 0,
  winRate: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => sessionStorage.clear());

afterEach(() => {
  vi.restoreAllMocks();
});

describe('create game colour picker', () => {
  it('does not submit the form when Enter is pressed on a colour option', async () => {
    const user = userEvent.setup();
    const createGame = vi.spyOn(monopolyBankApi, 'createGame');
    const { container } = render(
      <LanguageContext
        value={{
          language: 'en',
          locale: languageLocale('en'),
          setLanguage: () => {},
          t: (key, values) => translate('en', key, values),
        }}
      >
        <CreateGamePage profile={profile} onClose={() => {}} onCreated={() => {}} />
      </LanguageContext>,
    );
    const form = container.querySelector('form');
    expect(form).not.toBeNull();
    const onSubmit = vi.fn();
    form?.addEventListener('submit', onSubmit);

    await advance(user, 2);
    const selected = screen.getByRole('radio', { name: 'Select color red' });
    expect(selected).toHaveAttribute('aria-checked', 'true');
    selected.focus();
    await user.keyboard('{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();

    // Enter on another colour still selects it and still does not submit.
    const blue = screen.getByRole('radio', { name: 'Select color blue' });
    blue.focus();
    await user.keyboard('{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(blue).toHaveAttribute('aria-checked', 'true');
    expect(createGame).not.toHaveBeenCalled();
  });
});

describe('house rule descriptions', () => {
  it('shows one line per rule, filled with the entered amounts', async () => {
    const user = userEvent.setup();
    render(
      <LanguageProvider>
        <CreateGamePage profile={profile} onClose={() => {}} onCreated={() => {}} />
      </LanguageProvider>,
    );
    await advance(user, 1);
    const auctions = screen.getByRole('switch', { name: 'Auctions' });
    expect(auctions).toHaveAccessibleDescription(/30-second auction/);
    expect(screen.getByRole('switch', { name: 'Bank loans' })).toHaveAccessibleDescription(
      /Borrow up to \$/,
    );
  });
});

describe('game name suggestions in the refactored form', () => {
  for (const language of ['en', 'uk'] as const) {
    it(`${language}: keeps suggestions editable and preserves the colour picker without submitting`, async () => {
      const user = userEvent.setup();
      const createGame = vi.spyOn(monopolyBankApi, 'createGame');
      const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
      render(
        <LanguageContext
          value={{
            language,
            locale: languageLocale(language),
            setLanguage: () => {},
            t: (key, values) => translate(language, key, values),
          }}
        >
          <CreateGamePage profile={profile} onClose={() => {}} onCreated={() => {}} />
        </LanguageContext>,
      );
      const name = screen.getByLabelText(t('gameName'));
      const trigger = screen.getByRole('button', { name: t('suggestGameName') });
      await user.click(trigger);
      const suggestions = screen.getByRole('dialog', { name: t('suggestedGameNames') });
      const choices = Array.from(suggestions.querySelectorAll('button'));
      expect(choices).toHaveLength(6);
      await user.click(choices[0]);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(name).toHaveFocus();
      expect(name).not.toHaveValue('');
      await user.clear(name);
      await user.type(name, 'Edited name');
      expect(name).toHaveValue('Edited name');

      await user.click(trigger);
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(name).toHaveFocus();
      await user.click(trigger);
      await user.click(screen.getByLabelText(t('currency')));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(createGame).not.toHaveBeenCalled();
    });
  }
});

describe('house rules', () => {
  const rules = [
    'Double reward on exact GO',
    'Player loans',
    'Bank loans',
    'Free Parking jackpot',
    'Auctions',
  ];
  const renderPage = () =>
    render(
      <LanguageContext
        value={{
          language: 'en',
          locale: languageLocale('en'),
          setLanguage: () => {},
          t: (key, values) => translate('en', key, values),
        }}
      >
        <CreateGamePage profile={profile} onClose={() => {}} onCreated={() => {}} />
      </LanguageContext>,
    );

  it('lists every rule unchecked by default', async () => {
    const user = userEvent.setup();
    renderPage();
    await advance(user, 1);
    for (const name of rules) expect(screen.getByRole('switch', { name })).not.toBeChecked();
  });

  it('sends exactly the rules that were switched on, in any combination', async () => {
    const user = userEvent.setup();
    const createGame = vi.spyOn(monopolyBankApi, 'createGame').mockResolvedValue({
      game: { id: 'game-1' },
    } as never);
    renderPage();
    await advance(user, 1);
    await user.click(screen.getByRole('switch', { name: 'Auctions' }));
    await user.click(screen.getByRole('switch', { name: 'Bank loans' }));
    await user.click(screen.getByRole('switch', { name: 'Bank loans' }));
    await user.click(screen.getByRole('switch', { name: 'Player loans' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Create lobby' }));
    expect(createGame).toHaveBeenCalledWith(
      expect.objectContaining({
        rules: {
          doubleRewardOnExactGo: false,
          playerLoans: true,
          bankLoans: false,
          freeParkingJackpot: false,
          auctions: true,
        },
      }),
    );
  });
});

describe('board choice', () => {
  const renderPage = () =>
    render(
      <LanguageProvider>
        <CreateGamePage profile={profile} onClose={() => {}} onCreated={() => {}} />
      </LanguageProvider>,
    );

  it('sends the board when Monopoly RU 2012 is chosen', async () => {
    const user = userEvent.setup();
    const createGame = vi.spyOn(monopolyBankApi, 'createGame').mockResolvedValue({
      game: { id: 'game-1' },
    } as never);
    renderPage();
    expect(screen.getByRole('radio', { name: 'No board' })).toBeChecked();
    expect(screen.queryByRole('radio', { name: /Custom/i })).toBeNull();
    await user.click(screen.getByRole('radio', { name: 'Monopoly RU 2012' }));
    await advance(user, 2);
    await user.click(screen.getByRole('button', { name: 'Create lobby' }));
    expect(createGame).toHaveBeenCalledWith(expect.objectContaining({ board: 'monopoly-ru-2012' }));
  });

  it('does not send a board for No board', async () => {
    const user = userEvent.setup();
    const createGame = vi.spyOn(monopolyBankApi, 'createGame').mockResolvedValue({
      game: { id: 'game-1' },
    } as never);
    renderPage();
    await advance(user, 2);
    await user.click(screen.getByRole('button', { name: 'Create lobby' }));
    expect(createGame.mock.calls[0]?.[0]).not.toHaveProperty('board');
  });
});

describe('create lobby stepper', () => {
  const renderPage = (props: Partial<Parameters<typeof CreateGamePage>[0]> = {}) =>
    render(
      <LanguageProvider>
        <CreateGamePage profile={profile} onClose={() => {}} onCreated={() => {}} {...props} />
      </LanguageProvider>,
    );

  it('starts on step 1 of 3 and blocks Next with inline errors', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(screen.getByRole('status')).toHaveTextContent('Step 1 of 3');
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Enter a game name.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Step 1 of 3');
    const balance = screen.getByLabelText('Starting balance');
    await user.clear(balance);
    await user.type(screen.getByRole('textbox', { name: /Game name/i }), 'Table');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('status')).toHaveTextContent('Step 1 of 3');
  });

  it('keeps the entered state when going Back', async () => {
    const user = userEvent.setup();
    renderPage();
    await advance(user, 1);
    await user.click(screen.getByRole('switch', { name: 'Auctions' }));
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('textbox', { name: /Game name/i })).toHaveValue('Friday table');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('switch', { name: 'Auctions' })).toBeChecked();
  });

  it('requires a name for every player before creating', async () => {
    const user = userEvent.setup();
    const createGame = vi.spyOn(monopolyBankApi, 'createGame');
    renderPage();
    await advance(user, 2);
    await user.clear(screen.getByLabelText('Player 1 name'));
    await user.click(screen.getByRole('button', { name: 'Create lobby' }));
    expect(createGame).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Step 3 of 3');
  });

  it('restores the draft after a reload, without the password, and clears it on create', async () => {
    const user = userEvent.setup();
    const first = renderPage();
    await advance(user, 1);
    await user.click(screen.getByRole('switch', { name: 'Player loans' }));
    first.unmount();
    expect(sessionStorage.getItem(DRAFT_STORAGE_KEY)).not.toContain('password');

    const onCreated = vi.fn();
    vi.spyOn(monopolyBankApi, 'createGame').mockResolvedValue({ game: { id: 'g1' } } as never);
    renderPage({ onCreated });
    expect(screen.getByRole('status')).toHaveTextContent('Step 2 of 3');
    expect(screen.getByRole('switch', { name: 'Player loans' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Create lobby' }));
    expect(onCreated).toHaveBeenCalledWith('g1');
    expect(sessionStorage.getItem(DRAFT_STORAGE_KEY)).toBeNull();
  });

  it('reports whether the draft holds input and closes through the X', async () => {
    const user = userEvent.setup();
    const onDirtyChange = vi.fn();
    const onClose = vi.fn();
    renderPage({ onDirtyChange, onClose });
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    await user.type(screen.getByRole('textbox', { name: /Game name/i }), 'A');
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    await user.click(screen.getByRole('button', { name: 'Close new lobby' }));
    expect(onClose).toHaveBeenCalled();
  });
});
