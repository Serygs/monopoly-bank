import { useEffect, useRef, useState } from 'react';
import { monopolyBankApi } from '../../api/monopoly-bank-api';
import { Dialog } from '../../components/Dialog';
import {
  Button,
  DialogBody,
  GlassSurface,
  Notice,
  SheetActions,
  StatTile,
  useFeedback,
} from '../../components/ui';
import { apiErrorMessage } from '../../i18n/api-errors';
import { useLanguage } from '../../i18n/language-context';
import { formatJoinCode, joinInviteLink } from '../../utils/join-code';
import { createLocalQr } from '../../utils/local-qr';
import { LocalQr } from './LocalQr';

export interface InviteDialogProps {
  /** The game's one join code: what the link and QR open, and what the manual form accepts. */
  joinCode: string | undefined;
  /** Needed to regenerate the code. */
  gameId?: string;
  /** Players in the lobby now. */
  playerCount?: number;
  /** Whether the table has an access password; omitted when the server does not say. */
  hasPassword?: boolean;
  /** Owner only: shows "Regenerate code". */
  canRegenerate?: boolean;
  onCodeChanged?: (joinCode: string) => void;
  onClose: () => void;
}

const COPIED_MS = 2000;

/** Invitation card: spaced join code (tap to copy), QR code on a white tile, then share and copy. */
export function InviteDialog({
  joinCode,
  gameId,
  playerCount,
  hasPassword,
  canRegenerate = false,
  onCodeChanged,
  onClose,
}: InviteDialogProps) {
  const { t } = useLanguage();
  const notify = useFeedback();
  // A code the owner just regenerated shows at once, before the parent has stored it.
  const [regenerated, setRegenerated] = useState<string | null>(null);
  const code = regenerated ?? joinCode;
  const [copied, setCopied] = useState(false);
  const [confirmingRegenerate, setConfirmingRegenerate] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<unknown | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const link = code === undefined ? null : joinInviteLink(window.location.origin, code);
  // Share is offered only where the browser can share this link; otherwise Copy is the primary action.
  const canShare =
    link !== null &&
    typeof navigator.share === 'function' &&
    (typeof navigator.canShare !== 'function' || navigator.canShare({ url: link }));
  const write = async (text: string, prompt: string) => {
    if (navigator.clipboard !== undefined) await navigator.clipboard.writeText(text);
    else window.prompt(prompt, text);
  };
  const copyLink = async () => {
    if (link === null) return;
    await write(link, t('copyInviteLink'));
    setCopied(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), COPIED_MS);
    notify({ tone: 'success', message: t('inviteLinkCopied') });
  };
  const copyCode = async () => {
    if (code === undefined) return;
    await write(code, t('inviteCodeLabel'));
    notify({ tone: 'success', message: t('inviteCodeCopied') });
  };
  const share = async () => {
    if (link === null || !canShare) return;
    try {
      await navigator.share({ title: t('invitePlayers'), text: t('inviteShareText'), url: link });
    } catch {
      // The person closed the share sheet; nothing to report.
    }
  };
  const regenerate = async () => {
    if (gameId === undefined || regenerating) return;
    setRegenerating(true);
    setError(null);
    try {
      const result = await monopolyBankApi.regenerateJoinCode(gameId);
      setRegenerated(result.joinCode);
      onCodeChanged?.(result.joinCode);
      setConfirmingRegenerate(false);
      notify({ tone: 'success', message: t('inviteCodeRegenerated') });
    } catch (caught) {
      setError(caught);
    } finally {
      setRegenerating(false);
    }
  };

  // A link too long for the local encoder just drops the QR; copy and share still work.
  const qr = (() => {
    if (link === null) return null;
    try {
      return createLocalQr(link);
    } catch {
      return null;
    }
  })();
  const copyButton = (
    <Button variant={canShare ? 'secondary' : 'primary'} onClick={() => void copyLink()}>
      <span aria-live="polite">{copied ? t('inviteCopied') : t('copyInviteLink')}</span>
    </Button>
  );
  return (
    <Dialog
      title={t('invitePlayers')}
      closeLabel={t('closeDialog', { title: t('invitePlayers') })}
      onClose={onClose}
    >
      <DialogBody>{t('inviteDescription')}</DialogBody>
      {error !== null && (
        <Notice tone="error">{apiErrorMessage(error, t, 'inviteCodeFailed')}</Notice>
      )}
      {link !== null && code !== undefined && (
        <GlassSurface
          as="section"
          variant="card"
          tinted
          className="invite-card mt-(--mb-space-4) grid justify-items-center gap-(--mb-space-4) overflow-hidden p-(--mb-space-5) text-center"
          aria-label={t('invitePlayers')}
        >
          <div className="grid justify-items-center gap-(--mb-space-1)">
            <span className="text-meta font-bold tracking-meta text-secondary uppercase">
              {t('inviteCodeLabel')}
            </span>
            <button
              type="button"
              className="min-h-11 cursor-pointer rounded-control border-0 bg-transparent px-(--mb-space-3) font-money text-[length:clamp(1.75rem,8vw,2.5rem)] leading-tight font-bold tracking-[0.2em] text-primary focus-visible:outline-offset-2"
              aria-label={t('inviteCopyCodeAria', { code: formatJoinCode(code) })}
              onClick={() => void copyCode()}
            >
              {formatJoinCode(code)}
            </button>
            <small className="text-secondary">{t('inviteTapToCopy')}</small>
          </div>
          {qr !== null && <LocalQr matrix={qr} label={t('inviteQrLabel')} />}
          <div className="grid w-full grid-cols-2 gap-(--mb-space-2) text-start">
            {playerCount !== undefined && (
              <StatTile label={t('invitePlayersInLobby')} value={playerCount} />
            )}
            {hasPassword !== undefined && (
              <StatTile
                label={t('inviteTablePassword')}
                value={hasPassword ? t('inviteTablePasswordSet') : t('inviteTablePasswordNone')}
              />
            )}
          </div>
        </GlassSurface>
      )}
      {link !== null && (
        <SheetActions>
          {canShare ? (
            <>
              {copyButton}
              <Button variant="primary" onClick={() => void share()}>
                {t('shareInvite')}
              </Button>
            </>
          ) : (
            copyButton
          )}
        </SheetActions>
      )}
      {canRegenerate && gameId !== undefined && link !== null && (
        <div className="mt-(--mb-space-3) grid gap-(--mb-space-2)">
          {confirmingRegenerate ? (
            <Notice tone="info" as="div" className="mb-0! flex-col items-stretch">
              <p>{t('inviteRegenerateWarning')}</p>
              <SheetActions>
                <Button
                  variant="secondary"
                  disabled={regenerating}
                  onClick={() => setConfirmingRegenerate(false)}
                >
                  {t('cancel')}
                </Button>
                <Button variant="primary" disabled={regenerating} onClick={() => void regenerate()}>
                  {regenerating ? t('inviteRegenerating') : t('inviteRegenerateConfirm')}
                </Button>
              </SheetActions>
            </Notice>
          ) : (
            <Button variant="quiet" onClick={() => setConfirmingRegenerate(true)}>
              {t('inviteRegenerate')}
            </Button>
          )}
        </div>
      )}
    </Dialog>
  );
}
