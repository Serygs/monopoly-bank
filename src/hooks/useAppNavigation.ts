import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { clearDraft } from '../pages/create-game-draft';
import { routePath } from '../utils/client-route';

const CREATE_PATH = '/games/new';

function useManualScrollRestoration(): void {
  useEffect(() => {
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    return () => {
      window.history.scrollRestoration = previous;
    };
  }, []);
}

interface PopStateOptions {
  pathRef: RefObject<string>;
  createDirty: RefObject<boolean>;
  scrollPositions: RefObject<Record<string, number>>;
  setPath: (path: string) => void;
  setLeaveTarget: (target: string) => void;
}

function usePopState({
  pathRef,
  createDirty,
  scrollPositions,
  setPath,
  setLeaveTarget,
}: PopStateOptions): void {
  useEffect(() => {
    const onPopState = () => {
      const target = window.location.pathname;
      if (pathRef.current === CREATE_PATH && createDirty.current && target !== CREATE_PATH) {
        window.history.pushState({}, '', CREATE_PATH);
        setLeaveTarget(target);
        return;
      }
      scrollPositions.current[pathRef.current] = window.scrollY;
      setPath(target);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [pathRef, createDirty, scrollPositions, setPath, setLeaveTarget]);
}

interface NavigationRefs {
  pathRef: RefObject<string>;
  createDirty: RefObject<boolean>;
  scrollPositions: RefObject<Record<string, number>>;
}

function useNavigationActions(
  refs: NavigationRefs,
  setPath: (path: string) => void,
  setLeaveTarget: (target: string) => void,
  onNavigate: () => void,
) {
  const { pathRef, createDirty, scrollPositions } = refs;
  const navigate = (target: string) => {
    onNavigate();
    const leavingDirtyDraft =
      pathRef.current === CREATE_PATH && createDirty.current && routePath(target) !== CREATE_PATH;
    if (leavingDirtyDraft) {
      setLeaveTarget(target);
      return;
    }
    scrollPositions.current[pathRef.current] = window.scrollY;
    window.history.pushState({}, '', target);
    setPath(routePath(target));
  };
  const navigatePublic = (target: string) => {
    window.history.pushState({}, '', target);
    setPath(target);
  };
  const discardDraft = () => {
    clearDraft();
    createDirty.current = false;
  };
  const resetToHome = () => {
    discardDraft();
    window.history.replaceState({}, '', '/');
    setPath('/');
  };
  const lobbyCreated = () => {
    createDirty.current = false;
  };
  return { navigate, navigatePublic, discardDraft, resetToHome, lobbyCreated };
}

export function useAppNavigation(onNavigate: () => void) {
  const [path, setPath] = useState(window.location.pathname);
  const [leaveTarget, setLeaveTarget] = useState<string | null>(null);
  const pathRef = useRef(path);
  const scrollPositions = useRef<Record<string, number>>({});
  const createDirty = useRef(false);
  const setCreateDirty = useCallback((dirty: boolean) => {
    createDirty.current = dirty;
  }, []);
  useLayoutEffect(() => {
    pathRef.current = path;
    window.scrollTo(0, scrollPositions.current[path] ?? 0);
  }, [path]);
  useManualScrollRestoration();
  usePopState({ pathRef, createDirty, scrollPositions, setPath, setLeaveTarget });
  const actions = useNavigationActions(
    { pathRef, createDirty, scrollPositions },
    setPath,
    setLeaveTarget,
    onNavigate,
  );
  return { path, leaveTarget, setLeaveTarget, setCreateDirty, ...actions };
}

export type AppNavigation = ReturnType<typeof useAppNavigation>;
