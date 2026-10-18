import { apiErrorMessage } from '../../i18n/api-errors';
import { useLanguage } from '../../i18n/language-context';
import { Button, Notice, PageShell, StatPill } from '../ui';

export function AccountLoading({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useLanguage();
  return (
    <PageShell>
      {error === null ? (
        <StatPill variant="status">{t('loadingAccount')}</StatPill>
      ) : (
        <>
          <Notice tone="error">{apiErrorMessage(error, t, 'unableLoadAccount')}</Notice>
          <Button variant="primary" onClick={onRetry}>
            {t('tryAgain')}
          </Button>
        </>
      )}
    </PageShell>
  );
}
