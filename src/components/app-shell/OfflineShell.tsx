import { useLanguage } from '../../i18n/language-context';
import { BankSeal } from '../ui';
import { cx } from '../ui/class-names';

const offlineShellClass = cx(
  'offline-shell grid min-h-dvh content-center justify-items-start gap-(--mb-space-4) bg-surface-inverse text-on-inverse',
  '[&>:is(h1,p)]:m-0 [&>:is(h1,p)]:max-w-[34rem]',
  '[&>h1]:font-display [&>h1]:text-display [&>h1]:leading-tight [&>h1]:font-bold [&>h1]:tracking-display',
  '[&>p]:text-[color:color-mix(in_srgb,var(--mb-color-text-on-inverse)_76%,transparent)]',
);

export function OfflineShell() {
  const { t } = useLanguage();
  return (
    <main className={offlineShellClass}>
      <BankSeal variant="offline" />
      <h1>{t('offlineShellTitle')}</h1>
      <p>{t('offlineShellDescription')}</p>
    </main>
  );
}
