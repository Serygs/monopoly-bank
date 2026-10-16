import { useState, type FormEvent, type FormHTMLAttributes } from 'react';
import type { UserProfile } from '../../shared/contracts/api';
import { monopolyBankApi } from '../api/monopoly-bank-api';
import { Avatar, AvatarPicker } from '../components/AvatarPicker';
import { PageHeader } from '../components/PageHeader';
import { Dialog } from '../components/Dialog';
import {
  Button,
  DialogBody,
  Field,
  FormSection,
  Notice,
  PageShell,
  useFeedback,
} from '../components/ui';
import { apiErrorMessage } from '../i18n/api-errors';
import { useLanguage } from '../i18n/language-context';
import { EMAIL_FEATURES_ENABLED } from '../utils/email-features';
import { cx } from '../components/ui/class-names';
import { MutedText } from '../components/ui/Text';

/* The whole page is one column of glass cards; the save bar sticks above the home indicator. */
const layoutClass = 'mx-auto grid w-full max-w-[40rem] min-w-0 gap-(--mb-layout-gap-compact)';
const cardClass = cx(
  'glass-panel min-w-0 rounded-card-large border border-border bg-surface-elevated shadow-sm',
  'p-[clamp(var(--mb-space-4),4vw,var(--mb-space-6))]',
);
const identityClass = 'grid grid-cols-[auto_minmax(0,1fr)] items-end gap-(--mb-space-4)';
const avatarButtonClass = cx(
  'relative grid size-[72px] cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0',
  '[&_.avatar]:size-[72px] [&_.avatar]:text-[2rem]',
  'after:absolute after:right-0 after:bottom-0 after:grid after:size-6 after:place-items-center after:rounded-full',
  "after:border after:border-border after:bg-surface-elevated after:text-[0.8rem] after:content-['✎']",
);
const statisticsClass = cx(
  'mx-0 mt-(--mb-space-4) mb-0 grid grid-cols-4 gap-(--mb-space-2)',
  '*:min-w-0 *:rounded-control *:bg-surface-subtle *:px-(--mb-space-2) *:py-(--mb-space-3) *:text-center',
  '[&_dt]:truncate [&_dt]:text-[0.72rem] [&_dt]:text-secondary',
  '[&_dd]:mx-0 [&_dd]:mt-[2px] [&_dd]:mb-0 [&_dd]:font-money [&_dd]:text-[1.15rem] [&_dd]:leading-[1.1] [&_dd]:font-bold [&_dd]:text-primary',
);
/* Sticks to the bottom edge of the scroll area, clear of the iOS home indicator. */
const saveBarClass = cx(
  'glass-panel sticky bottom-[calc(var(--mb-shell-nav-offset,0px)+var(--mb-space-3))] z-10 grid gap-(--mb-space-2)',
  'rounded-card border border-border bg-surface-elevated p-(--mb-space-3) shadow-lg',
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
}: {
  profile: UserProfile;
  onUpdated: (profile: UserProfile) => void;
}) {
  const { t } = useLanguage();
  const [nickname, setNickname] = useState(profile.nickname);
  const [avatar, setAvatar] = useState(profile.avatar);
  const [pickerOpen, setPickerOpen] = useState(false);
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
      <PageHeader eyebrow={t('playerProfile')} title={t('playerProfile')} />
      <div className={layoutClass}>
        <form className="grid gap-(--mb-layout-gap-compact)" onSubmit={(event) => void save(event)}>
          <section className={cardClass} aria-label={t('playerProfile')}>
            <div className={identityClass}>
              <button
                type="button"
                className={avatarButtonClass}
                aria-label={t('changeAvatar')}
                aria-haspopup="dialog"
                onClick={() => setPickerOpen(true)}
              >
                <Avatar avatar={avatar} label={nickname} />
              </button>
              <div className="game-form min-w-0">
                <Field label={t('nickname')}>
                  <input
                    value={nickname}
                    minLength={2}
                    maxLength={40}
                    onChange={(event) => setNickname(event.target.value)}
                    required
                  />
                </Field>
              </div>
            </div>
            <div className="mt-(--mb-space-2)">
              <MutedText>
                {profile.accountType === 'GUEST' ? t('guestAccount') : t('playerProfile')}
              </MutedText>
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
          <div className={saveBarClass}>
            {error !== null && (
              <Notice tone="error">{apiErrorMessage(error, t, 'unableUpdateProfile')}</Notice>
            )}
            <Button variant="primary" type="submit" className="w-full" disabled={saving}>
              {saving ? t('savingProfile') : t('saveProfile')}
            </Button>
          </div>
        </form>
        {EMAIL_FEATURES_ENABLED &&
          (profile.accountType === 'GUEST' ? (
            <GuestUpgradeForm onUpgraded={onUpdated} />
          ) : profile.email === null ? (
            <LegacyEmailForm onAdded={onUpdated} />
          ) : (
            !profile.emailVerified && <VerificationNotice />
          ))}
      </div>
      {pickerOpen && (
        <Dialog
          title={t('avatar')}
          closeLabel={t('closeDialog', { title: t('avatar') })}
          onClose={() => setPickerOpen(false)}
        >
          <DialogBody>
            <AvatarPicker
              avatar={avatar}
              onChange={(next) => {
                setAvatar(next);
                setPickerOpen(false);
              }}
              label={t('avatar')}
              uploadLabel={t('avatarUpload')}
              uploadHint={t('avatarUploadHint')}
              invalidImageMessage={t('avatarUploadError')}
              allowUpload
            />
          </DialogBody>
        </Dialog>
      )}
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
      <FormSection legend={t('secureGuestAccount')}>
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
      </FormSection>
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
      <FormSection legend={t('addAccountEmail')}>
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
      </FormSection>
    </ProfileForm>
  );
}
