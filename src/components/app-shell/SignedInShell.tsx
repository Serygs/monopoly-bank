import type { ReactNode } from 'react';
import type { UserProfile } from '../../../shared/contracts/api';
import { useSettingsPopover } from '../../hooks/useSettingsPopover';
import type { DevicePreferences } from '../../utils/preferences';
import { appTabForPath } from '../../utils/app-tab';
import { AppBottomNav } from '../AppBottomNav';
import { AppBanners } from './AppBanners';
import { AppHeader } from './AppHeader';
import { DiscardDraftDialog } from './DiscardDraftDialog';
import { SettingsDialog } from './SettingsDialog';

const appShellClass =
  'app-shell min-h-dvh [background:var(--mb-background-shell)] text-primary glass:relative glass:isolate';

interface SignedInShellProps {
  path: string;
  profile: UserProfile;
  online: boolean;
  navigate: (target: string) => void;
  preferences: DevicePreferences;
  onPreferencesChange: (change: Partial<DevicePreferences>) => void;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  signingOut: boolean;
  signOutError: unknown;
  onSignOut: () => void;
  updateReady: boolean;
  onDismissUpdate: () => void;
  paymentFlowOpen: boolean;
  leaveTarget: string | null;
  onKeepEditing: () => void;
  onDiscard: (target: string) => void;
  children: ReactNode;
}

export function SignedInShell(props: SignedInShellProps) {
  const { path, profile, navigate, settingsOpen, setSettingsOpen, leaveTarget } = props;
  const popover = useSettingsPopover(settingsOpen);
  return (
    <div className={appShellClass} data-bottom-nav={appTabForPath(path) === null ? undefined : ''}>
      <AppHeader
        profile={profile}
        settingsOpen={settingsOpen}
        settingsButtonRef={popover.buttonRef}
        onToggleSettings={() => setSettingsOpen(!settingsOpen)}
        navigate={navigate}
      />
      {settingsOpen && (
        <SettingsDialog
          preferences={props.preferences}
          onPreferencesChange={props.onPreferencesChange}
          position={popover.position}
          signingOut={props.signingOut}
          signOutError={props.signOutError}
          onSignOut={props.onSignOut}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      <AppBanners
        online={props.online}
        updateReady={props.updateReady}
        paymentFlowOpen={props.paymentFlowOpen}
        onDismissUpdate={props.onDismissUpdate}
      />
      {props.children}
      <AppBottomNav path={path} navigate={navigate} />
      {leaveTarget !== null && (
        <DiscardDraftDialog
          onKeepEditing={props.onKeepEditing}
          onDiscard={() => props.onDiscard(leaveTarget)}
        />
      )}
    </div>
  );
}
