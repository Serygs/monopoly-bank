import { useState } from 'react';
import type { CreateInvitationResponse } from '../../../shared/contracts/api';
import { monopolyBankApi } from '../../api/monopoly-bank-api';
import { Dialog } from '../../components/Dialog';
import { Button, DialogActions, DialogBody, Notice, StatPill } from '../../components/ui';
import { apiErrorMessage } from '../../i18n/api-errors';
import { useLanguage } from '../../i18n/language-context';
import { createLocalQr } from '../../utils/local-qr';
import { LocalQr } from './LocalQr';

export interface InviteDialogProps {
  gameId: string;
  onClose: () => void;
}

export function InviteDialog({ gameId, onClose }: InviteDialogProps) {
  const { locale, t } = useLanguage();
  const [invite, setInvite] = useState<CreateInvitationResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [revoked, setRevoked] = useState(false);
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
    setCopied(true);
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
        <section className="invite-ticket">
          <div className="invite-ticket-copy">
            <StatPill variant="pill">{t('inviteUnlisted')}</StatPill>
            <p className="invite-short-code">{invite.shortCode}</p>
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
          {copied && <Notice tone="success">{t('inviteLinkCopied')}</Notice>}
        </section>
      )}
      {revoked && <Notice tone="success">{t('inviteRevoked')}</Notice>}
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
