import { useState } from 'react';
import type { CreateInvitationResponse } from '../../../shared/contracts/api';
import { monopolyBankApi } from '../../api/monopoly-bank-api';
import { Dialog } from '../../components/Dialog';
import {
  Button,
  DialogActions,
  DialogBody,
  Notice,
  StatPill,
  useFeedback,
} from '../../components/ui';
import { apiErrorMessage } from '../../i18n/api-errors';
import { useLanguage } from '../../i18n/language-context';
import { createLocalQr } from '../../utils/local-qr';
import { LocalQr } from './LocalQr';

export interface InviteDialogProps {
  gameId: string;
  onClose: () => void;
}

/** Invitation ticket: code and expiry beside the QR code, stacked below `md`. */
const ticketClass =
  'mt-[18px] grid grid-cols-[minmax(0,1fr)_136px] items-center gap-[20px] rounded-lg border border-s-[3px] border-border border-s-highlight bg-(--mb-background-invitation) p-[18px] max-md:grid-cols-1';
const ticketCopyClass =
  'min-w-0 [&>p:last-child]:m-0 [&>p:last-child]:text-small [&>p:last-child]:text-secondary';
const shortCodeClass =
  'mx-0 mt-[12px] mb-[4px] font-money text-[length:clamp(1.5rem,6vw,2.35rem)] leading-none font-bold tracking-[0.1em] text-primary';

export function InviteDialog({ gameId, onClose }: InviteDialogProps) {
  const { locale, t } = useLanguage();
  const [invite, setInvite] = useState<CreateInvitationResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [creating, setCreating] = useState(false);
  const [revoked, setRevoked] = useState(false);
  const notify = useFeedback();
  const create = async () => {
    if (window.location.protocol !== 'https:') {
      setError(new Error('HTTPS_REQUIRED'));
      return;
    }
    setCreating(true);
    setError(null);
    setRevoked(false);
    try {
      setInvite(await monopolyBankApi.createInvitation(gameId));
    } catch (caught) {
      setError(caught);
    } finally {
      setCreating(false);
    }
  };
  const link =
    invite === null
      ? null
      : `${window.location.origin}/games/join#invite=${encodeURIComponent(invite.invitationToken)}`;
  const copy = async () => {
    if (link === null) return;
    if (navigator.clipboard !== undefined) await navigator.clipboard.writeText(link);
    else window.prompt(t('copyInviteLink'), link);
    notify({ tone: 'success', message: t('inviteLinkCopied') });
  };
  const share = async () => {
    if (link !== null && typeof navigator.share === 'function')
      await navigator.share({ title: t('invitePlayers'), text: t('inviteShareText'), url: link });
  };
  const revoke = async () => {
    setCreating(true);
    setError(null);
    try {
      await monopolyBankApi.revokeInvitations(gameId);
      setInvite(null);
      setRevoked(true);
      notify({ tone: 'success', message: t('inviteRevoked') });
    } catch (caught) {
      setError(caught);
    } finally {
      setCreating(false);
    }
  };
  const qr = link === null ? null : createLocalQr(link);
  return (
    <Dialog
      title={t('invitePlayers')}
      closeLabel={t('closeDialog', { title: t('invitePlayers') })}
      onClose={onClose}
    >
      <DialogBody>{t('inviteDescription')}</DialogBody>
      {invite === null ? (
        <Button variant="primary" disabled={creating} onClick={() => void create()}>
          {creating ? t('pleaseWait') : revoked ? t('createNewInvite') : t('createInviteLink')}
        </Button>
      ) : (
        <section className={ticketClass}>
          <div className={ticketCopyClass}>
            <StatPill variant="pill">{t('inviteUnlisted')}</StatPill>
            <p className={shortCodeClass}>{invite.shortCode}</p>
            <p>
              {t('inviteExpiresAt', {
                time: new Intl.DateTimeFormat(locale, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }).format(new Date(invite.expiresAt)),
              })}
            </p>
          </div>
          {qr !== null && <LocalQr matrix={qr} label={t('inviteQrLabel')} />}
          <DialogActions>
            <Button variant="primary" onClick={() => void copy()}>
              {t('copyInviteLink')}
            </Button>
            {typeof navigator.share === 'function' && (
              <Button variant="secondary" onClick={() => void share()}>
                {t('shareInvite')}
              </Button>
            )}
            <Button variant="secondary" disabled={creating} onClick={() => void create()}>
              {t('rotateInvite')}
            </Button>
            <Button variant="danger" disabled={creating} onClick={() => void revoke()}>
              {t('revokeInvite')}
            </Button>
          </DialogActions>
        </section>
      )}
      {error !== null && (
        <Notice tone="error">
          {error instanceof Error && error.message === 'HTTPS_REQUIRED'
            ? t('inviteRequiresHttps')
            : apiErrorMessage(error, t, 'unableJoinGame')}
        </Notice>
      )}
    </Dialog>
  );
}
