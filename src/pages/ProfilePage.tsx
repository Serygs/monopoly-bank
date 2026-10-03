import { useState, type FormEvent, type FormHTMLAttributes } from 'react';
import type { UserProfile } from '../../shared/contracts/api';
import { monopolyBankApi } from '../api/monopoly-bank-api';
import { Avatar, AvatarPicker } from '../components/AvatarPicker';
import { PageHeader } from '../components/PageHeader';
import { Button, Field, Notice, PageShell, useFeedback } from '../components/ui';
import { apiErrorMessage } from '../i18n/api-errors';
import { useLanguage } from '../i18n/language-context';
import { EMAIL_FEATURES_ENABLED } from '../utils/email-features';
import { cx } from '../components/ui/class-names';
import { MutedText } from '../components/ui/Text';

const layoutClass = cx(
  'grid min-w-0 gap-(--mb-layout-gap-compact)',
  'md:grid-cols-[minmax(18rem,0.82fr)_minmax(0,1.18fr)] md:gap-(--mb-layout-gap-medium) lg:gap-(--mb-layout-gap-wide)',
);
const panelClass =
  'min-w-0 rounded-card-large border border-border p-[clamp(var(--mb-space-5),4vw,var(--mb-space-7))] shadow-sm';
/* Every section after the profile form (upgrade, legacy email, verification) is ruled off. */
const editorClass = cx(
  panelClass,
  'bg-surface-elevated [&>*+*]:mt-(--mb-space-7) [&>*+*]:border-t [&>*+*]:border-border [&>*+*]:pt-(--mb-space-7)',
);
/* The summary name overrides the page's low-specificity `h2` typography. */
const summaryClass = cx(
  'flex min-w-0 items-center gap-(--mb-space-4) border-b border-border pb-(--mb-space-5) [&>div]:min-w-0',
  '[&_.avatar]:size-[72px] [&_.avatar]:flex-none [&_.avatar]:text-[2rem]',
  '[&_h2]:text-[length:clamp(1.25rem,5vw,1.7rem)] [&_h2]:leading-[1.12] [&_h2]:wrap-anywhere',
  '[&_p]:mx-0 [&_p]:mt-(--mb-space-1) [&_p]:mb-0',
);
const statisticsClass = cx(
  'mx-0 mt-(--mb-space-5) mb-0 grid grid-cols-2 gap-(--mb-space-3)',
  '*:min-w-0 *:rounded-card *:border *:border-border *:bg-surface-elevated *:p-(--mb-space-4)',
  '[&_dt]:text-small [&_dt]:text-secondary',
  '[&_dd]:mx-0 [&_dd]:mt-(--mb-space-1) [&_dd]:mb-0 [&_dd]:font-money [&_dd]:text-[length:clamp(1.25rem,5vw,1.65rem)] [&_dd]:leading-[1.1] [&_dd]:font-bold [&_dd]:text-primary [&_dd]:wrap-anywhere',
);
/* `!` outranks the unlayered `.game-form` gap in `primitives.css`. */
const profileFormClass = 'game-form gap-(--mb-space-6)!';

/** The profile, guest-upgrade and legacy-email forms share one spacing. */
function ProfileForm(props: Omit<FormHTMLAttributes<HTMLFormElement>, 'className'>) {
  return <form className={profileFormClass} {...props} />;
}

export function ProfilePage({
  profile,
  onUpdated,
  onBack,
}: {
  profile: UserProfile;
  onUpdated: (profile: UserProfile) => void;
  onBack: () => void;
}) {
  const { t } = useLanguage();
  const [nickname, setNickname] = useState(profile.nickname);
  const [avatar, setAvatar] = useState(profile.avatar);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const notify = useFeedback();
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      onUpdated(await monopolyBankApi.updateProfile({ nickname, avatar }));
      notify({ tone: 'success', message: t('profileUpdated') });
    } catch (caught) {
      setError(caught);
    } finally {
      setSaving(false);
    }
  };
  return (
    <PageShell>
      <PageHeader
        eyebrow={t('playerProfile')}
        title={t('playerProfile')}
        description={t('profileDescription')}
        backAction={
          <Button variant="quiet" onClick={onBack}>
            {t('savedGames')}
          </Button>
        }
      />
      <div className={layoutClass}>
        <section className={cx(panelClass, 'self-start bg-surface-subtle')}>
          <div className={summaryClass}>
            <Avatar avatar={avatar} label={nickname} />
            <div>
              <h2>{nickname}</h2>
              <MutedText>
                {profile.accountType === 'GUEST' ? t('guestAccount') : t('playerProfile')}
              </MutedText>
            </div>
          </div>
          <dl className={statisticsClass}>
            <div>
              <dt>{t('gamesPlayed')}</dt>
              <dd>{profile.gamesPlayed}</dd>
            </div>
            <div>
              <dt>{t('gamesWon')}</dt>
              <dd>{profile.gamesWon}</dd>
            </div>
            <div>
              <dt>{t('gamesLost')}</dt>
              <dd>{profile.gamesLost}</dd>
            </div>
            <div>
              <dt>{t('winRate')}</dt>
              <dd>{Math.round(profile.winRate * 100)}%</dd>
            </div>
          </dl>
        </section>
        <section className={editorClass}>
          <ProfileForm onSubmit={(event) => void save(event)}>
            <Field label={t('nickname')}>
              <input
                value={nickname}
                minLength={2}
                maxLength={40}
                onChange={(event) => setNickname(event.target.value)}
                required
              />
            </Field>
            <AvatarPicker
              avatar={avatar}
              onChange={setAvatar}
              label={t('avatar')}
              uploadLabel={t('avatarUpload')}
              uploadHint={t('avatarUploadHint')}
              invalidImageMessage={t('avatarUploadError')}
              allowUpload
            />
            {error !== null && (
              <Notice tone="error">{apiErrorMessage(error, t, 'unableUpdateProfile')}</Notice>
            )}
            <Button
              variant="primary"
              type="submit"
              className="min-w-48 justify-self-start max-md:w-full"
              disabled={saving}
            >
              {saving ? t('savingProfile') : t('saveProfile')}
            </Button>
          </ProfileForm>
          {EMAIL_FEATURES_ENABLED &&
            (profile.accountType === 'GUEST' ? (
              <GuestUpgradeForm onUpgraded={onUpdated} />
            ) : profile.email === null ? (
              <LegacyEmailForm onAdded={onUpdated} />
            ) : (
              !profile.emailVerified && <VerificationNotice />
            ))}
        </section>
      </div>
    </PageShell>
  );
}

function GuestUpgradeForm({ onUpgraded }: { onUpgraded: (profile: UserProfile) => void }) {
  const { t } = useLanguage();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const upgrade = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onUpgraded(await monopolyBankApi.upgradeGuest({ email, password }));
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };
  return (
    <ProfileForm onSubmit={(event) => void upgrade(event)}>
      <h2>{t('secureGuestAccount')}</h2>
      <MutedText>{t('secureGuestDescription')}</MutedText>
      <Field label={t('email')}>
        <input
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </Field>
      <Field label={t('password')}>
        <input
          type="password"
          minLength={6}
          maxLength={256}
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </Field>
      {error !== null && (
        <Notice tone="error">{apiErrorMessage(error, t, 'unableAuthenticate')}</Notice>
      )}
      <Button variant="primary" type="submit" disabled={busy}>
        {busy ? t('pleaseWait') : t('secureGuestAccount')}
      </Button>
    </ProfileForm>
  );
}

function VerificationNotice() {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const notify = useFeedback();
  const resend = async () => {
    setBusy(true);
    setError(null);
    try {
      await monopolyBankApi.resendVerification();
      notify({ tone: 'success', message: t('verificationSent') });
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section>
      <Notice tone="success" as="div">
        <p>{t('verificationPending')}</p>
        <Button variant="secondary" disabled={busy} onClick={() => void resend()}>
          {busy ? t('pleaseWait') : t('resendVerification')}
        </Button>
      </Notice>
      {error !== null && (
        <Notice tone="error">{apiErrorMessage(error, t, 'errorEmailDelivery')}</Notice>
      )}
    </section>
  );
}

function LegacyEmailForm({ onAdded }: { onAdded: (profile: UserProfile) => void }) {
  const { t } = useLanguage();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const add = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onAdded(await monopolyBankApi.addEmailToLegacyAccount({ email }));
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };
  return (
    <ProfileForm onSubmit={(event) => void add(event)}>
      <h2>{t('addAccountEmail')}</h2>
      <MutedText>{t('addAccountEmailDescription')}</MutedText>
      <Field label={t('email')}>
        <input
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </Field>
      {error !== null && (
        <Notice tone="error">{apiErrorMessage(error, t, 'unableAuthenticate')}</Notice>
      )}
      <Button variant="primary" type="submit" disabled={busy}>
        {busy ? t('pleaseWait') : t('addAccountEmail')}
      </Button>
    </ProfileForm>
  );
}
