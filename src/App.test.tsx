import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserProfile } from '../shared/contracts/api';
import { MonopolyBankApiError, monopolyBankApi } from './api/monopoly-bank-api';
import App from './App';
import { LanguageProvider } from './i18n/LanguageProvider';
import { translate, type TranslationKey } from './i18n/translations';
import { DRAFT_STORAGE_KEY } from './pages/create-game-draft';

const applyPwaUpdate = vi.hoisted(() => vi.fn());
vi.mock('./pwa', () => ({ applyPwaUpdate }));

interface AuthProps {
  initialRegistering: boolean;
  onAuthenticated: (profile: UserProfile) => void;
}
interface SavedProps {
  onCreateGame: () => void;
  onJoinGame: (code?: string) => void;
  onOpenGame: (id: string) => void;
}
interface CreateProps {
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onCreated: (id: string) => void;
}
interface GameProps {
  gameId: string;
  offline: boolean;
  onBack: () => void;
  onPaymentFlowChange: (open: boolean) => void;
}
interface JoinProps {
  initialJoinCode: string;
  invitationToken: string;
  autoJoin?: boolean;
  onJoined: (id: string) => void;
  onGuestJoined?: (guest: UserProfile, gameId: string) => void;
  onBack?: () => void;
}
interface JoinEntryProps {
  onSignIn: () => void;
  onRegister: () => void;
  onGuest: () => void;
}

vi.mock('./pages/AuthPage', () => ({
  AuthPage: (props: AuthProps) => (
    <div>
      <p>auth page registering={String(props.initialRegistering)}</p>
      <button onClick={() => props.onAuthenticated(profile)}>finish auth</button>
    </div>
  ),
}));
vi.mock('./pages/SavedGamesPage', () => ({
  SavedGamesPage: (props: SavedProps) => (
    <div>
      <p>saved games page</p>
      <button onClick={props.onCreateGame}>to create</button>
      <button onClick={() => props.onJoinGame()}>to join</button>
      <button onClick={() => props.onJoinGame('AB 12')}>to join with code</button>
      <button onClick={() => props.onOpenGame('g/1')}>open game</button>
    </div>
  ),
}));
vi.mock('./pages/CreateGamePage', () => ({
  CreateGamePage: (props: CreateProps) => (
    <div>
      <p>create page</p>
      <button onClick={() => props.onDirtyChange(true)}>make dirty</button>
      <button onClick={() => props.onDirtyChange(false)}>make clean</button>
      <button onClick={props.onClose}>close create</button>
      <button onClick={() => props.onCreated('new id')}>created</button>
    </div>
  ),
}));
vi.mock('./pages/GamePage', () => ({
  GamePage: (props: GameProps) => (
    <div>
      <p>
        game page {props.gameId} offline={String(props.offline)}
      </p>
      <button onClick={props.onBack}>back</button>
      <button onClick={() => props.onPaymentFlowChange(true)}>payment open</button>
      <button onClick={() => props.onPaymentFlowChange(false)}>payment closed</button>
    </div>
  ),
}));
vi.mock('./pages/ProfilePage', () => ({
  ProfilePage: () => <p>profile page</p>,
}));
vi.mock('./pages/JoinGamePage', () => ({
  JoinGamePage: (props: JoinProps) => (
    <div>
      <p>
        join page code={props.initialJoinCode} token={props.invitationToken} auto=
        {String(props.autoJoin === true)}
      </p>
      <button onClick={() => props.onJoined('joined id')}>joined</button>
      <button onClick={() => props.onGuestJoined?.(profile, 'guest/game')}>guest joined</button>
      <button onClick={() => props.onBack?.()}>join back</button>
    </div>
  ),
}));
vi.mock('./pages/JoinEntryPage', () => ({
  JoinEntryPage: (props: JoinEntryProps) => (
    <div>
      <p>join entry</p>
      <button onClick={props.onSignIn}>choose sign in</button>
      <button onClick={props.onRegister}>choose register</button>
      <button onClick={props.onGuest}>choose guest</button>
    </div>
  ),
}));

const profile: UserProfile = {
  id: 'user-1',
  nickname: 'Ada',
  avatar: '🧩',
  accountType: 'REGISTERED',
  email: null,
  emailVerified: false,
  gamesPlayed: 0,
  gamesWon: 0,
  gamesLost: 0,
  winRate: 0,
  createdAt: '',
  updatedAt: '',
};
const t = (key: TranslationKey) => translate('en', key);
const unauthorized = () => new MonopolyBankApiError({ code: 'UNAUTHORIZED', message: 'no' });

function mount() {
  render(
    <LanguageProvider>
      <App />
    </LanguageProvider>,
  );
  return userEvent.setup();
}

function setOnline(value: boolean) {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value);
}

beforeEach(() => {
  window.history.replaceState({}, '', '/');
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  applyPwaUpdate.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('loading the account', () => {
  it('shows a loading notice, then the saved games of a signed-in user', async () => {
    let resolve: (value: UserProfile) => void = () => undefined;
    vi.spyOn(monopolyBankApi, 'currentProfile').mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    mount();
    expect(screen.getByText(t('loadingAccount'))).toBeInTheDocument();
    expect(screen.queryByText('saved games page')).not.toBeInTheDocument();
    await act(async () => resolve(profile));
    expect(await screen.findByText('saved games page')).toBeInTheDocument();
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.queryByText(t('loadingAccount'))).not.toBeInTheDocument();
  });

  it('asks a user whose session was rejected to sign in', async () => {
    vi.spyOn(monopolyBankApi, 'currentProfile').mockRejectedValue(unauthorized());
    mount();
    expect(await screen.findByText('auth page registering=false')).toBeInTheDocument();
    expect(screen.queryByText('saved games page')).not.toBeInTheDocument();
  });

  it('shows the error and retries when the account cannot be loaded for another reason', async () => {
    const current = vi
      .spyOn(monopolyBankApi, 'currentProfile')
      .mockRejectedValueOnce(new MonopolyBankApiError({ code: 'NETWORK_ERROR', message: 'x' }))
      .mockResolvedValue(profile);
    const user = mount();
    expect(await screen.findByText(t('errorNetwork'))).toBeInTheDocument();
    expect(screen.queryByText('auth page registering=false')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('tryAgain') }));
    expect(await screen.findByText('saved games page')).toBeInTheDocument();
    expect(current).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(t('errorNetwork'))).not.toBeInTheDocument();
  });

  it('reloads the account when the tab becomes visible again, and only then', async () => {
    const current = vi.spyOn(monopolyBankApi, 'currentProfile').mockResolvedValue(profile);
    mount();
    await screen.findByText('saved games page');
    expect(current).toHaveBeenCalledTimes(1);
    const state = vi.spyOn(document, 'visibilityState', 'get');
    state.mockReturnValue('hidden');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(current).toHaveBeenCalledTimes(1);
    state.mockReturnValue('visible');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(current).toHaveBeenCalledTimes(2));
  });

  it('ignores an answer that arrives after a newer request', async () => {
    const answers: Array<(value: UserProfile) => void> = [];
    vi.spyOn(monopolyBankApi, 'currentProfile').mockImplementation(
      () =>
        new Promise((done) => {
          answers.push(done);
        }),
    );
    mount();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(answers).toHaveLength(2));
    await act(async () => answers[1]?.({ ...profile, nickname: 'Newer' }));
    await screen.findByText('Newer');
    await act(async () => answers[0]?.({ ...profile, nickname: 'Older' }));
    expect(screen.getByText('Newer')).toBeInTheDocument();
    expect(screen.queryByText('Older')).not.toBeInTheDocument();
  });
});

describe('offline and reconnecting', () => {
  it('shows the offline shell and does not ask the server while the device is offline', async () => {
    setOnline(false);
    const current = vi.spyOn(monopolyBankApi, 'currentProfile').mockResolvedValue(profile);
    mount();
    expect(screen.getByText(t('offlineShellTitle'))).toBeInTheDocument();
    expect(screen.getByText(t('offlineShellDescription'))).toBeInTheDocument();
    expect(current).not.toHaveBeenCalled();
    setOnline(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(await screen.findByText('saved games page')).toBeInTheDocument();
    expect(current).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(t('offlineShellTitle'))).not.toBeInTheDocument();
  });

  it('keeps the screen and shows a stale-data banner when the device goes offline', async () => {
    vi.spyOn(monopolyBankApi, 'currentProfile').mockResolvedValue(profile);
    mount();
    await screen.findByText('saved games page');
    expect(screen.queryByText(t('staleSnapshot'))).not.toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByText(t('staleSnapshot'))).toBeInTheDocument();
    expect(screen.getByText('saved games page')).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => expect(screen.queryByText(t('staleSnapshot'))).not.toBeInTheDocument());
  });

  it('shows the offline shell instead of the sign-in page when signed out and offline', async () => {
    vi.spyOn(monopolyBankApi, 'currentProfile').mockRejectedValue(unauthorized());
    mount();
    await screen.findByText('auth page registering=false');
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByText(t('offlineShellTitle'))).toBeInTheDocument();
    expect(screen.queryByText('auth page registering=false')).not.toBeInTheDocument();
  });

  it('tells a game page that the device is offline', async () => {
    window.history.replaceState({}, '', '/games/abc');
    vi.spyOn(monopolyBankApi, 'currentProfile').mockResolvedValue(profile);
    mount();
    expect(await screen.findByText('game page abc offline=false')).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByText('game page abc offline=true')).toBeInTheDocument();
  });
});

describe('app updates', () => {
  it('offers an update, applies it on request and can be dismissed', async () => {
    vi.spyOn(monopolyBankApi, 'currentProfile').mockResolvedValue(profile);
    const user = mount();
    await screen.findByText('saved games page');
    expect(screen.queryByText(t('updateReady'))).not.toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new Event('pwa-update-ready'));
    });
    expect(screen.getByText(t('updateReady'))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('updateApp') }));
    expect(applyPwaUpdate).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: t('updateLater') }));
    expect(screen.queryByText(t('updateReady'))).not.toBeInTheDocument();
  });

  it('holds the update banner back while a payment is being made', async () => {
    window.history.replaceState({}, '', '/games/abc');
    vi.spyOn(monopolyBankApi, 'currentProfile').mockResolvedValue(profile);
    const user = mount();
    await screen.findByText('game page abc offline=false');
    act(() => {
      window.dispatchEvent(new Event('pwa-update-ready'));
    });
    expect(screen.getByText(t('updateReady'))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'payment open' }));
    expect(screen.queryByText(t('updateReady'))).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'payment closed' }));
    expect(screen.getByText(t('updateReady'))).toBeInTheDocument();
  });
});

describe('navigation', () => {
  beforeEach(() => {
    vi.spyOn(monopolyBankApi, 'currentProfile').mockResolvedValue(profile);
  });

  it('goes to the profile from the header and back home from the brand', async () => {
    const user = mount();
    await screen.findByText('saved games page');
    await user.click(screen.getByRole('button', { name: /Ada/u }));
    expect(screen.getByText('profile page')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/profile');
    await user.click(screen.getByRole('button', { name: t('appName') }));
    expect(screen.getByText('saved games page')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
  });

  it('opens the new-game, join and game pages from the saved games', async () => {
    const user = mount();
    await screen.findByText('saved games page');
    await user.click(screen.getByRole('button', { name: 'to create' }));
    expect(screen.getByText('create page')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/games/new');
    await user.click(screen.getByRole('button', { name: 'close create' }));
    await user.click(screen.getByRole('button', { name: 'to join' }));
    expect(screen.getByText('join page code= token= auto=true')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/games/join');
    await user.click(screen.getByRole('button', { name: 'joined' }));
    expect(screen.getByText('game page joined%20id offline=false')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/games/joined%20id');
  });

  it('passes the typed join code in the address, encoded, and reads it back without spaces', async () => {
    const user = mount();
    await screen.findByText('saved games page');
    await user.click(screen.getByRole('button', { name: 'to join with code' }));
    expect(window.location.search).toBe('?code=AB%2012');
    expect(screen.getByText('join page code=AB12 token= auto=true')).toBeInTheDocument();
  });

  it('reads an invitation from the address fragment on the join page', async () => {
    window.history.replaceState({}, '', '/games/join#invite=tok123');
    mount();
    expect(await screen.findByText('join page code= token=tok123 auto=true')).toBeInTheDocument();
  });

  it('opens a game by its encoded id and goes back from it', async () => {
    const user = mount();
    await screen.findByText('saved games page');
    await user.click(screen.getByRole('button', { name: 'open game' }));
    expect(window.location.pathname).toBe('/games/g%2F1');
    expect(screen.getByText('game page g%2F1 offline=false')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'back' }));
    expect(screen.getByText('saved games page')).toBeInTheDocument();
  });

  it('follows the browser back button and remembers where each screen was scrolled', async () => {
    const user = mount();
    await screen.findByText('saved games page');
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 240 });
    await user.click(screen.getByRole('button', { name: 'to create' }));
    expect(window.scrollTo).toHaveBeenLastCalledWith(0, 0);
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
    window.history.replaceState({}, '', '/');
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(screen.getByText('saved games page')).toBeInTheDocument();
    expect(window.scrollTo).toHaveBeenLastCalledWith(0, 240);
  });

  it('takes manual control of scroll restoration and gives it back on unmount', async () => {
    window.history.scrollRestoration = 'auto';
    const view = render(
      <LanguageProvider>
        <App />
      </LanguageProvider>,
    );
    expect(window.history.scrollRestoration).toBe('manual');
    view.unmount();
    expect(window.history.scrollRestoration).toBe('auto');
  });
});

describe('leaving a half-filled new game', () => {
  beforeEach(() => {
    vi.spyOn(monopolyBankApi, 'currentProfile').mockResolvedValue(profile);
    window.history.replaceState({}, '', '/games/new');
  });

  it('leaves at once when nothing was typed', async () => {
    const user = mount();
    await screen.findByText('create page');
    await user.click(screen.getByRole('button', { name: t('appName') }));
    expect(screen.getByText('saved games page')).toBeInTheDocument();
    expect(screen.queryByText(t('discardDraftTitle'))).not.toBeInTheDocument();
  });

  it('asks before leaving, and keeps the form when the user keeps editing', async () => {
    const user = mount();
    await screen.findByText('create page');
    await user.click(screen.getByRole('button', { name: 'make dirty' }));
    await user.click(screen.getByRole('button', { name: t('appName') }));
    expect(screen.getByText(t('discardDraftTitle'))).toBeInTheDocument();
    expect(screen.getByText(t('discardDraftBody'))).toBeInTheDocument();
    expect(screen.getByText('create page')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('keepEditing') }));
    await waitFor(() => expect(screen.queryByText(t('discardDraftTitle'))).not.toBeInTheDocument());
    expect(screen.getByText('create page')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/games/new');
  });

  it('discards the draft and leaves when the user agrees', async () => {
    window.sessionStorage.setItem(DRAFT_STORAGE_KEY, '{}');
    const user = mount();
    await screen.findByText('create page');
    await user.click(screen.getByRole('button', { name: 'make dirty' }));
    await user.click(screen.getByRole('button', { name: /Ada/u }));
    await user.click(screen.getByRole('button', { name: t('discardDraft') }));
    expect(screen.getByText('profile page')).toBeInTheDocument();
    expect(window.sessionStorage.getItem(DRAFT_STORAGE_KEY)).toBeNull();
    expect(window.location.pathname).toBe('/profile');
  });

  it('puts the form back and asks when the browser back button would lose it', async () => {
    const user = mount();
    await screen.findByText('create page');
    await user.click(screen.getByRole('button', { name: 'make dirty' }));
    window.history.pushState({}, '', '/');
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(window.location.pathname).toBe('/games/new');
    expect(screen.getByText(t('discardDraftTitle'))).toBeInTheDocument();
    expect(screen.getByText('create page')).toBeInTheDocument();
  });

  it('leaves without asking once the lobby was created', async () => {
    const user = mount();
    await screen.findByText('create page');
    await user.click(screen.getByRole('button', { name: 'make dirty' }));
    await user.click(screen.getByRole('button', { name: 'created' }));
    expect(screen.getByText('game page new%20id offline=false')).toBeInTheDocument();
    expect(screen.queryByText(t('discardDraftTitle'))).not.toBeInTheDocument();
  });

  it('forgets the dirty state when the form reports it clean again', async () => {
    const user = mount();
    await screen.findByText('create page');
    await user.click(screen.getByRole('button', { name: 'make dirty' }));
    await user.click(screen.getByRole('button', { name: 'make clean' }));
    await user.click(screen.getByRole('button', { name: t('appName') }));
    expect(screen.getByText('saved games page')).toBeInTheDocument();
  });
});

describe('settings and signing out', () => {
  beforeEach(() => {
    vi.spyOn(monopolyBankApi, 'currentProfile').mockResolvedValue(profile);
  });

  it('opens and closes the settings dialog from the header button', async () => {
    const user = mount();
    await screen.findByText('saved games page');
    const button = screen.getByRole('button', { name: t('settings') });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await user.click(button);
    expect(await screen.findByRole('button', { name: t('signOut') })).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  it('remembers the sound, vibration and keep-awake switches on the device', async () => {
    const user = mount();
    await screen.findByText('saved games page');
    await user.click(screen.getByRole('button', { name: t('settings') }));
    await user.click(await screen.findByRole('switch', { name: t('sound') }));
    await user.click(screen.getByRole('switch', { name: t('vibration') }));
    await user.click(screen.getByRole('switch', { name: t('keepScreenAwake') }));
    await waitFor(() => {
      const stored = JSON.parse(
        window.localStorage.getItem('monopoly-bank-device-preferences') ?? '{}',
      ) as Record<string, unknown>;
      expect(stored).toMatchObject({ sound: false, vibration: false, keepScreenAwake: false });
    });
  });

  it('signs out, forgets the draft and shows the sign-in page at the start address', async () => {
    window.sessionStorage.setItem(DRAFT_STORAGE_KEY, '{}');
    const logout = vi.spyOn(monopolyBankApi, 'logout').mockResolvedValue(undefined);
    const user = mount();
    await screen.findByText('saved games page');
    await user.click(screen.getByRole('button', { name: t('settings') }));
    await user.click(await screen.findByRole('button', { name: t('signOut') }));
    expect(await screen.findByText('auth page registering=false')).toBeInTheDocument();
    expect(logout).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe('/');
    expect(window.sessionStorage.getItem(DRAFT_STORAGE_KEY)).toBeNull();
    expect(screen.queryByText('Ada')).not.toBeInTheDocument();
  });

  it('keeps the user signed in and explains why when signing out fails', async () => {
    vi.spyOn(monopolyBankApi, 'logout').mockRejectedValue(
      new MonopolyBankApiError({ code: 'NETWORK_ERROR', message: 'x' }),
    );
    const user = mount();
    await screen.findByText('saved games page');
    await user.click(screen.getByRole('button', { name: t('settings') }));
    await user.click(await screen.findByRole('button', { name: t('signOut') }));
    expect(await screen.findByText(t('errorNetwork'))).toBeInTheDocument();
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('signOut') })).toBeEnabled();
  });

  it('signs in again after signing out and returns to the page that was asked for', async () => {
    window.history.replaceState({}, '', '/profile');
    vi.spyOn(monopolyBankApi, 'currentProfile').mockRejectedValueOnce(unauthorized());
    const user = mount();
    await screen.findByText('auth page registering=false');
    await user.click(screen.getByRole('button', { name: 'finish auth' }));
    expect(await screen.findByText('profile page')).toBeInTheDocument();
    expect(screen.getByText('Ada')).toBeInTheDocument();
  });
});

describe('joining without an account', () => {
  beforeEach(() => {
    vi.spyOn(monopolyBankApi, 'currentProfile').mockRejectedValue(unauthorized());
    window.history.replaceState({}, '', '/games/join?code=ABCD#invite=tok9');
  });

  it('offers the choice first, then registration with the register form open', async () => {
    const user = mount();
    expect(await screen.findByText('join entry')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'choose register' }));
    expect(screen.getByText('auth page registering=true')).toBeInTheDocument();
  });

  it('offers sign-in with the sign-in form open', async () => {
    const user = mount();
    await screen.findByText('join entry');
    await user.click(screen.getByRole('button', { name: 'choose sign in' }));
    expect(screen.getByText('auth page registering=false')).toBeInTheDocument();
  });

  it('joins as a guest with the code and the invitation from the address, and can go back', async () => {
    const user = mount();
    await screen.findByText('join entry');
    await user.click(screen.getByRole('button', { name: 'choose guest' }));
    expect(screen.getByText('join page code=ABCD token=tok9 auto=false')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'join back' }));
    expect(screen.getByText('join entry')).toBeInTheDocument();
  });

  it('signs the guest in and opens the game', async () => {
    const user = mount();
    await screen.findByText('join entry');
    await user.click(screen.getByRole('button', { name: 'choose guest' }));
    await user.click(screen.getByRole('button', { name: 'guest joined' }));
    expect(await screen.findByText('game page guest%2Fgame offline=false')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/games/guest%2Fgame');
    expect(screen.getByText('Ada')).toBeInTheDocument();
  });
});
