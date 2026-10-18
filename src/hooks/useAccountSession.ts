import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import type { UserProfile } from '../../shared/contracts/api';
import { loadAccountSession } from '../api/account-session';
import { monopolyBankApi } from '../api/monopoly-bank-api';

export interface AccountSession {
  profile: UserProfile | null | undefined;
  setProfile: Dispatch<SetStateAction<UserProfile | null | undefined>>;
  accountError: unknown;
  online: boolean;
  retry: () => void;
  settle: (user: UserProfile | null) => void;
}

function useWindowListener(target: Window | Document, type: string, listener: () => void): void {
  useEffect(() => {
    target.addEventListener(type, listener);
    return () => target.removeEventListener(type, listener);
  }, [target, type, listener]);
}

function useAccountLoad(
  online: boolean,
  retryCount: number,
  versionRef: MutableRefObject<number>,
  setAccountError: (error: unknown) => void,
  setProfile: (user: UserProfile | null) => void,
): void {
  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    const version = ++versionRef.current;
    const current = () => !cancelled && version === versionRef.current;
    void loadAccountSession(monopolyBankApi)
      .then((user) => {
        if (!current()) return;
        setAccountError(null);
        setProfile(user);
      })
      .catch((error: unknown) => {
        if (current()) setAccountError(error);
      });
    return () => {
      cancelled = true;
    };
  }, [retryCount, online, versionRef, setAccountError, setProfile]);
}

export function useAccountSession(): AccountSession {
  const [profile, setProfile] = useState<UserProfile | null | undefined>(undefined);
  const [accountError, setAccountError] = useState<unknown>(null);
  const [accountRetry, setAccountRetry] = useState(0);
  const [online, setOnline] = useState(() => navigator.onLine);
  const requestVersion = useRef(0);
  useAccountLoad(online, accountRetry, requestVersion, setAccountError, setProfile);
  const resumed = useCallback(() => {
    if (document.visibilityState === 'visible') setAccountRetry((attempt) => attempt + 1);
  }, []);
  const connected = useCallback(() => setOnline(true), []);
  const disconnected = useCallback(() => setOnline(false), []);
  useWindowListener(document, 'visibilitychange', resumed);
  useWindowListener(window, 'online', connected);
  useWindowListener(window, 'offline', disconnected);
  const retry = useCallback(() => {
    setAccountError(null);
    setAccountRetry((attempt) => attempt + 1);
  }, []);
  const settle = useCallback((user: UserProfile | null) => {
    requestVersion.current += 1;
    setAccountError(null);
    setProfile(user);
  }, []);
  return { profile, setProfile, accountError, online, retry, settle };
}
