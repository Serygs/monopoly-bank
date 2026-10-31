import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageProvider';
import { lazyNamed } from '../../utils/lazy-named';
import { LazyBoundary } from './LazyBoundary';

function mount(node: React.ReactNode) {
  window.localStorage.setItem('monopoly-bank-language', 'en');
  return render(<LanguageProvider>{node}</LanguageProvider>);
}

describe('LazyBoundary', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows a loading page, then the named export', async () => {
    let resolve: (module: { Page: () => React.ReactNode }) => void = () => undefined;
    const Page = lazyNamed(
      () => new Promise<{ Page: () => React.ReactNode }>((done) => (resolve = done)),
      'Page',
    );
    mount(
      <LazyBoundary page>
        <Page />
      </LazyBoundary>,
    );
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    resolve({ Page: () => 'loaded page' });
    expect(await screen.findByText('loaded page')).toBeInTheDocument();
  });

  it('offers a reload when the chunk cannot be fetched', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const Broken = lazyNamed(
      () => Promise.reject<{ Broken: () => null }>(new TypeError('Failed to fetch module')),
      'Broken',
    );
    mount(
      <LazyBoundary>
        <Broken />
      </LazyBoundary>,
    );
    expect(await screen.findByRole('button', { name: 'Reload' })).toBeInTheDocument();
    expect(screen.getByText(/could not load/u)).toBeInTheDocument();
  });
});
