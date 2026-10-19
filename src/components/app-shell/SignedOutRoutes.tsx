import type { UserProfile } from '../../../shared/contracts/api';
import { AuthPage } from '../../pages/AuthPage';
import { PasswordRecoveryPage } from '../../pages/EmailTokenPage';
import { JoinEntryPage } from '../../pages/JoinEntryPage';
import { JoinGamePage } from '../../pages/JoinGamePage';
import { currentRoute } from '../../utils/client-route';
import { EMAIL_FEATURES_ENABLED } from '../../utils/email-features';
import { invitationFromLocation } from './invitation';

export type JoinChoice = 'choice' | 'signIn' | 'register' | 'guest';

interface SignedOutRoutesProps {
  path: string;
  joinChoice: JoinChoice;
  setJoinChoice: (choice: JoinChoice) => void;
  navigate: (target: string) => void;
  navigatePublic: (target: string) => void;
  onAuthenticated: (user: UserProfile) => void;
}

function GuestJoin({
  setJoinChoice,
  navigatePublic,
  onAuthenticated,
}: Pick<SignedOutRoutesProps, 'setJoinChoice' | 'navigatePublic' | 'onAuthenticated'>) {
  return (
    <JoinGamePage
      initialJoinCode={new URLSearchParams(window.location.search).get('code') ?? ''}
      invitationToken={invitationFromLocation()}
      onJoined={() => undefined}
      onGuestJoined={(guest, gameId) => {
        onAuthenticated(guest);
        navigatePublic(`/games/${encodeURIComponent(gameId)}`);
      }}
      onBack={() => setJoinChoice('choice')}
    />
  );
}

export function SignedOutRoutes(props: SignedOutRoutesProps) {
  const { path, joinChoice, setJoinChoice, navigate, navigatePublic, onAuthenticated } = props;
  if (EMAIL_FEATURES_ENABLED && path === '/forgot-password')
    return <PasswordRecoveryPage onBack={() => navigatePublic('/')} />;
  if (path === '/games/join' && joinChoice === 'choice')
    return (
      <JoinEntryPage
        onSignIn={() => setJoinChoice('signIn')}
        onRegister={() => setJoinChoice('register')}
        onGuest={() => setJoinChoice('guest')}
      />
    );
  if (path === '/games/join' && joinChoice === 'guest')
    return (
      <GuestJoin
        setJoinChoice={setJoinChoice}
        navigatePublic={navigatePublic}
        onAuthenticated={onAuthenticated}
      />
    );
  const returnRoute = currentRoute(
    window.location.pathname,
    window.location.search,
    window.location.hash,
  );
  return (
    <AuthPage
      initialRegistering={path === '/games/join' && joinChoice === 'register'}
      onAuthenticated={(user) => {
        onAuthenticated(user);
        setJoinChoice('choice');
        navigate(returnRoute);
      }}
    />
  );
}
