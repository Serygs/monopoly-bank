import { useLanguage } from '../../i18n/language-context';
import { Dialog } from '../Dialog';
import { Button, DialogBody, SheetActions } from '../ui';

interface DiscardDraftDialogProps {
  onKeepEditing: () => void;
  onDiscard: () => void;
}

export function DiscardDraftDialog({ onKeepEditing, onDiscard }: DiscardDraftDialogProps) {
  const { t } = useLanguage();
  return (
    <Dialog
      title={t('discardDraftTitle')}
      closeLabel={t('closeDialog', { title: t('discardDraftTitle') })}
      onClose={onKeepEditing}
    >
      <DialogBody>{t('discardDraftBody')}</DialogBody>
      <SheetActions>
        <Button variant="secondary" onClick={onKeepEditing}>
          {t('keepEditing')}
        </Button>
        <Button variant="primary" onClick={onDiscard}>
          {t('discardDraft')}
        </Button>
      </SheetActions>
    </Dialog>
  );
}
