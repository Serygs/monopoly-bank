import { useState } from 'react';
import { monopolyBankApi } from '../api/monopoly-bank-api';
import type { JoinChoice } from '../components/app-shell/SignedOutRoutes';
import { useAccountSession } from './useAccountSession';
import { useAppNavigation } from './useAppNavigation';
import { useAsyncAction } from './useAsyncAction';
import { useDevicePreferences } from './useDevicePreferences';
import { useUpdateReady } from './useUpdateReady';

export function useAppState() {
  const session = useAccountSession();
  const [preferences, updatePreferences] = useDevicePreferences();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paymentFlowOpen, setPaymentFlowOpen] = useState(false);
  const [joinChoice, setJoinChoice] = useState<JoinChoice>('choice');
  const [updateReady, dismissUpdate] = useUpdateReady();
  const nav = useAppNavigation(() => setSettingsOpen(false));
  const signOut = useAsyncAction();
  const runSignOut = () =>
    signOut.run(async () => {
      await monopolyBankApi.logout();
      setSettingsOpen(false);
      setPaymentFlowOpen(false);
      nav.resetToHome();
      session.settle(null);
      setJoinChoice('choice');
    });
  return {
    session,
    nav,
    preferences,
    updatePreferences,
    settingsOpen,
    setSettingsOpen,
    paymentFlowOpen,
    setPaymentFlowOpen,
    joinChoice,
    setJoinChoice,
    updateReady,
    dismissUpdate,
    signOut,
    runSignOut,
  };
}

export type AppState = ReturnType<typeof useAppState>;
