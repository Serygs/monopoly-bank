import type { UserProfile } from '../shared/contracts/api';
import { AccountLoading } from './components/app-shell/AccountLoading';
import { emailTokenRoute } from './components/app-shell/EmailTokenRoute';
import { LazyBoundary } from './components/app-shell/LazyBoundary';
import { OfflineShell } from './components/app-shell/OfflineShell';
import { SignedInRoutes } from './components/app-shell/SignedInRoutes';
import { SignedInShell } from './components/app-shell/SignedInShell';
import { FeedbackProvider } from './components/ui';
import { useAppState, type AppState } from './hooks/useAppState';
import { lazyNamed } from './utils/lazy-named';
import './styles/app.css';

// Sign-in, registration and the guest join flow are not needed once a session exists.
const SignedOutRoutes = lazyNamed(
  () => import('./components/app-shell/SignedOutRoutes'),
  'SignedOutRoutes',
);

/** Every route, including the signed-out and email-token pages, shares one notification region. */
function App() {
  return (
    <FeedbackProvider>
      <AppRoutes />
    </FeedbackProvider>
  );
}

function AppRoutes() {
  const app = useAppState();
  const { nav, session } = app;
  const tokenPage = emailTokenRoute({
    path: nav.path,
    onVerified: session.setProfile,
    onBack: () => nav.navigate('/'),
  });
  return tokenPage ?? <AccountGate app={app} />;
}

function AccountGate({ app }: { app: AppState }) {
  const { session, nav } = app;
  const { profile, online } = session;
  if (!online && profile !== undefined && profile !== null)
    return <SignedInApp app={app} profile={profile} />;
  if (!online) return <OfflineShell />;
  if (profile === undefined)
    return <AccountLoading error={session.accountError} onRetry={session.retry} />;
  if (profile !== null) return <SignedInApp app={app} profile={profile} />;
  return (
    <LazyBoundary page>
      <SignedOutRoutes
        path={nav.path}
        joinChoice={app.joinChoice}
        setJoinChoice={app.setJoinChoice}
        navigate={nav.navigate}
        navigatePublic={nav.navigatePublic}
        onAuthenticated={session.settle}
      />
    </LazyBoundary>
  );
}

function SignedInApp({ app, profile }: { app: AppState; profile: UserProfile }) {
  const { nav, session } = app;
  return (
    <SignedInShell
      path={nav.path}
      profile={profile}
      online={session.online}
      navigate={nav.navigate}
      preferences={app.preferences}
      onPreferencesChange={app.updatePreferences}
      settingsOpen={app.settingsOpen}
      setSettingsOpen={app.setSettingsOpen}
      signingOut={app.signOut.busy}
      signOutError={app.signOut.error}
      onSignOut={() => void app.runSignOut()}
      updateReady={app.updateReady}
      onDismissUpdate={app.dismissUpdate}
      paymentFlowOpen={app.paymentFlowOpen}
      leaveTarget={nav.leaveTarget}
      onKeepEditing={() => nav.setLeaveTarget(null)}
      onDiscard={(target) => {
        nav.discardDraft();
        nav.setLeaveTarget(null);
        nav.navigate(target);
      }}
    >
      <SignedInRoutes
        path={nav.path}
        profile={profile}
        setProfile={session.setProfile}
        navigate={nav.navigate}
        preferences={app.preferences}
        offline={!session.online}
        onPaymentFlowChange={app.setPaymentFlowOpen}
        onDirtyChange={nav.setCreateDirty}
        onLobbyCreated={nav.lobbyCreated}
      />
    </SignedInShell>
  );
}

export default App;
