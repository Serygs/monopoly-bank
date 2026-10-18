import type { UserProfile } from '../../../shared/contracts/api';
import { CreateGamePage } from '../../pages/CreateGamePage';
import { GamePage } from '../../pages/GamePage';
import { JoinGamePage } from '../../pages/JoinGamePage';
import { ProfilePage } from '../../pages/ProfilePage';
import { SavedGamesPage } from '../../pages/SavedGamesPage';
import { joinCodeFromSearch } from '../../utils/join-code';
import type { DevicePreferences } from '../../utils/preferences';
import { invitationFromLocation } from './invitation';

interface SignedInRoutesProps {
  path: string;
  profile: UserProfile;
  setProfile: (profile: UserProfile) => void;
  navigate: (target: string) => void;
  preferences: DevicePreferences;
  offline: boolean;
  onPaymentFlowChange: (open: boolean) => void;
  onDirtyChange: (dirty: boolean) => void;
  onLobbyCreated: () => void;
}

const gameUrl = (id: string) => `/games/${encodeURIComponent(id)}`;

function CreateRoute(props: SignedInRoutesProps) {
  const { profile, navigate, onDirtyChange, onLobbyCreated } = props;
  return (
    <CreateGamePage
      profile={profile}
      onClose={() => navigate('/')}
      onDirtyChange={onDirtyChange}
      onCreated={(id) => {
        onLobbyCreated();
        navigate(gameUrl(id));
      }}
    />
  );
}

function SavedGamesRoute({ navigate }: Pick<SignedInRoutesProps, 'navigate'>) {
  return (
    <SavedGamesPage
      onCreateGame={() => navigate('/games/new')}
      onJoinGame={(code) =>
        navigate(`/games/join${code === undefined ? '' : `?code=${encodeURIComponent(code)}`}`)
      }
      onOpenGame={(id) => navigate(gameUrl(id))}
    />
  );
}

export function SignedInRoutes(props: SignedInRoutesProps) {
  const { path, profile, setProfile, navigate } = props;
  const gameMatch = /^\/games\/([^/]+)$/.exec(path);
  if (path === '/profile') return <ProfilePage profile={profile} onUpdated={setProfile} />;
  if (path === '/games/new') return <CreateRoute {...props} />;
  if (path === '/games/join')
    return (
      <JoinGamePage
        initialJoinCode={joinCodeFromSearch(window.location.search)}
        invitationToken={invitationFromLocation()}
        autoJoin
        onJoined={(id) => navigate(gameUrl(id))}
      />
    );
  if (gameMatch !== null)
    return (
      <GamePage
        gameId={gameMatch[1]}
        onBack={() => navigate('/')}
        preferences={props.preferences}
        offline={props.offline}
        onPaymentFlowChange={props.onPaymentFlowChange}
      />
    );
  return <SavedGamesRoute navigate={navigate} />;
}
