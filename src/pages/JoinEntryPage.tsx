import { Button, PageShell } from '../components/ui';
import { AuthHeading } from '../components/ui/AuthCard';
import { Lede } from '../components/ui/Text';
import { useLanguage } from '../i18n/language-context';

interface Props {
  onSignIn: () => void;
  onRegister: () => void;
  onGuest: () => void;
}

/** Where a signed-out visitor lands from an invite link or QR code: sign in, register, or guest. */
export function JoinEntryPage({ onSignIn, onRegister, onGuest }: Props) {
  const { t } = useLanguage();
  return (
    <PageShell variant="auth" card="join">
      <AuthHeading eyebrow={t('lobby')} title={t('joinEntryTitle')} />
      <Lede>{t('joinEntryDescription')}</Lede>
      <div className="grid gap-(--mb-space-3)">
        <Button variant="primary" onClick={onSignIn}>
          {t('signIn')}
        </Button>
        <Button variant="secondary" onClick={onRegister}>
          {t('createAccount')}
        </Button>
        <Button variant="quiet" onClick={onGuest}>
          {t('playAsGuest')}
        </Button>
      </div>
    </PageShell>
  );
}
