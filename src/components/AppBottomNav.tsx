import { useState } from 'react';
import { useLanguage } from '../i18n/language-context';
import { appTabForPath } from '../utils/app-tab';
import { Dialog } from './Dialog';
import { BottomNav, Button, DialogBody, NavIcon } from './ui';

export interface AppBottomNavProps {
  path: string;
  navigate: (target: string) => void;
}

/**
 * The main navigation of every top-level screen (Games, + , Profile). `App` renders it once next
 * to the route switch, so it stays mounted across route changes. Profile toggles back to Games.
 */
export function AppBottomNav({ path, navigate }: AppBottomNavProps) {
  const { t } = useLanguage();
  const [addOpen, setAddOpen] = useState(false);
  const tab = appTabForPath(path);
  if (tab === null) return null;
  return (
    <>
      <BottomNav
        label={t('homeNavigation')}
        className="home-bottom-nav"
        items={[
          {
            key: 'games',
            label: t('navGames'),
            active: tab === 'games',
            onPress: () =>
              path === '/' ? window.scrollTo({ top: 0, behavior: 'smooth' }) : navigate('/'),
            icon: (
              <NavIcon>
                <rect x="4" y="4" width="16" height="16" rx="3" />
                <path d="M8 9h8M8 13h8M8 17h4" />
              </NavIcon>
            ),
          },
          {
            key: 'add',
            label: t('navAddGame'),
            raised: true,
            active: tab === 'add',
            onPress: () => setAddOpen(true),
            icon: (
              <NavIcon>
                <path d="M12 5v14M5 12h14" />
              </NavIcon>
            ),
          },
          {
            key: 'profile',
            label: t('navProfile'),
            active: tab === 'profile',
            onPress: () => navigate(tab === 'profile' ? '/' : '/profile'),
            icon: (
              <NavIcon>
                <circle cx="12" cy="8" r="4" />
                <path d="M4 20c1.5-4 4.5-5.5 8-5.5s6.5 1.5 8 5.5" />
              </NavIcon>
            ),
          },
        ]}
      />
      {addOpen && (
        <Dialog
          title={t('addGameTitle')}
          closeLabel={t('closeDialog', { title: t('addGameTitle') })}
          onClose={() => setAddOpen(false)}
        >
          <DialogBody>
            <div className="grid gap-(--mb-space-3)">
              <Button
                variant="primary"
                onClick={() => {
                  setAddOpen(false);
                  navigate('/games/new');
                }}
              >
                {t('createNewGame')}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setAddOpen(false);
                  navigate('/games/join');
                }}
              >
                {t('joinGame')}
              </Button>
            </div>
          </DialogBody>
        </Dialog>
      )}
    </>
  );
}
