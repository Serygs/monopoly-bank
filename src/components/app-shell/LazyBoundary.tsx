import { Component, Suspense, type ReactNode } from 'react';
import { useLanguage } from '../../i18n/language-context';
import { Button, Notice, PageShell, StatPill } from '../ui';

/**
 * Suspense plus a fallback for a chunk that fails to load (offline before it was cached, or a
 * deploy replaced it). `page` shows a full-page loading state; otherwise nothing while loading.
 */
export function LazyBoundary({ page = false, children }: { page?: boolean; children: ReactNode }) {
  return (
    <ChunkErrorBoundary fallback={<ChunkFailed />}>
      <Suspense fallback={page ? <PageLoading /> : null}>{children}</Suspense>
    </ChunkErrorBoundary>
  );
}

function PageLoading() {
  const { t } = useLanguage();
  return (
    <PageShell>
      <StatPill variant="status">{t('loadingPage')}</StatPill>
    </PageShell>
  );
}

function ChunkFailed() {
  const { t } = useLanguage();
  return (
    <PageShell>
      <Notice tone="error">{t('pageLoadFailed')}</Notice>
      <Button variant="primary" onClick={() => window.location.reload()}>
        {t('reloadApp')}
      </Button>
    </PageShell>
  );
}

class ChunkErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
