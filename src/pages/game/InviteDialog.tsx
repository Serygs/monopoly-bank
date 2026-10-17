import { Dialog } from '../../components/Dialog';
import { Button, SheetActions, DialogBody, StatPill, useFeedback } from '../../components/ui';
import { useLanguage } from '../../i18n/language-context';
import { createLocalQr } from '../../utils/local-qr';
import { LocalQr } from './LocalQr';

export interface InviteDialogProps {
  /** The game's one join code: what the link and QR open, and what the manual form accepts. */
  joinCode: string | undefined;
  onClose: () => void;
}

/** Invitation ticket: code beside the QR code, stacked below `md`. */
const ticketClass =
  'mt-[18px] grid grid-cols-[minmax(0,1fr)_136px] items-center gap-[20px] rounded-lg border border-s-[3px] border-border border-s-highlight bg-(--mb-background-invitation) p-[18px] max-md:grid-cols-1';
const ticketCopyClass = 'min-w-0';
const shortCodeClass =
  'mx-0 mt-[12px] mb-[4px] font-money text-[length:clamp(1.5rem,6vw,2.35rem)] leading-none font-bold tracking-[0.1em] text-primary';

function inviteLink(origin: string, joinCode: string): string {
  return `${origin}/games/join?code=${encodeURIComponent(joinCode)}`;
}

export function InviteDialog({ joinCode, onClose }: InviteDialogProps) {
  const { t } = useLanguage();
  const notify = useFeedback();
  const link = joinCode === undefined ? null : inviteLink(window.location.origin, joinCode);
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
  const qr = link === null ? null : createLocalQr(link);
  return (
    <Dialog
      title={t('invitePlayers')}
      closeLabel={t('closeDialog', { title: t('invitePlayers') })}
      onClose={onClose}
    >
      <DialogBody>{t('inviteDescription')}</DialogBody>
      {link !== null && (
        <section className={ticketClass}>
          <div className={ticketCopyClass}>
            <StatPill variant="pill">{t('inviteCodeLabel')}</StatPill>
            <p className={shortCodeClass}>{joinCode}</p>
          </div>
          {qr !== null && <LocalQr matrix={qr} label={t('inviteQrLabel')} />}
          <SheetActions>
            <Button variant="primary" onClick={() => void copy()}>
              {t('copyInviteLink')}
            </Button>
            {typeof navigator.share === 'function' && (
              <Button variant="secondary" onClick={() => void share()}>
                {t('shareInvite')}
              </Button>
            )}
          </SheetActions>
        </section>
      )}
    </Dialog>
  );
}
