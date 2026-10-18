import { applyPwaUpdate } from '../../pwa';
import { useLanguage } from '../../i18n/language-context';
import { Button } from '../ui';
import { cx } from '../ui/class-names';

const bannerClass = cx(
  'fixed z-40 m-auto w-[min(var(--mb-layout-content-max),calc(100%_-_2_*_var(--mb-space-3)))]',
  'rounded-md border border-[color:color-mix(in_srgb,var(--mb-color-highlight)_65%,transparent)]',
  'bg-surface-inverse px-(--mb-space-4) py-(--mb-space-3) text-on-inverse shadow-md',
);

interface AppBannersProps {
  online: boolean;
  updateReady: boolean;
  paymentFlowOpen: boolean;
  onDismissUpdate: () => void;
}

export function AppBanners({
  online,
  updateReady,
  paymentFlowOpen,
  onDismissUpdate,
}: AppBannersProps) {
  const { t } = useLanguage();
  return (
    <>
      {!online && (
        <p className={cx('offline-banner', bannerClass)} role="status">
          {t('staleSnapshot')}
        </p>
      )}
      {updateReady && !paymentFlowOpen && (
        <section
          className={cx(
            'update-banner',
            bannerClass,
            'flex items-center justify-end gap-(--mb-space-2) [&_span]:mr-auto',
          )}
          role="status"
        >
          <span>{t('updateReady')}</span>
          <Button variant="primary" onClick={applyPwaUpdate}>
            {t('updateApp')}
          </Button>
          <Button variant="quiet" onClick={onDismissUpdate}>
            {t('updateLater')}
          </Button>
        </section>
      )}
    </>
  );
}
