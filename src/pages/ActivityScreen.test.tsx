import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { monopolyBankApi } from '../api/monopoly-bank-api';
import { LanguageContext } from '../i18n/language-context';
import { languageLocale, translate, type Language } from '../i18n/translations';
import { ActivityScreen } from './ActivityScreen';

function renderActivity(language: Language) {
  return render(
    <LanguageContext
      value={{
        language,
        locale: languageLocale(language),
        setLanguage: () => {},
        t: (key, values) => translate(language, key, values),
      }}
    >
      <ActivityScreen
        gameId="game-1"
        players={[]}
        currency="K"
        liveTransactions={[]}
        onClose={() => {}}
      />
    </LanguageContext>,
  );
}

describe('activity accessibility', () => {
  beforeEach(() => {
    vi.spyOn(monopolyBankApi, 'getActivity').mockResolvedValue({
      transactions: [],
      paymentRequests: [],
      nextCursor: null,
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(['en', 'uk'] as const)(
    'connects tabs to one keyboard-focusable panel in %s',
    async (language) => {
      renderActivity(language);
      await screen.findByText(translate(language, 'noActivity'));

      expect(screen.getByRole('tablist')).toBeInTheDocument();
      const tabs = screen.getAllByRole('tab');
      expect(tabs).toHaveLength(3);
      expect(tabs.filter((tab) => tab.hasAttribute('aria-controls'))).toHaveLength(3);
      expect(screen.getAllByRole('tab', { selected: true })).toHaveLength(1);
      expect(tabs.filter((tab) => tab.getAttribute('tabindex') === '-1')).toHaveLength(2);

      const panel = screen.getByRole('tabpanel');
      expect(panel.getAttribute('aria-labelledby')).toMatch(/.+/);
      expect(panel).toHaveAttribute('tabindex', '0');
    },
  );

  it('moves selection between tabs with the arrow, Home and End keys', async () => {
    const user = userEvent.setup();
    renderActivity('en');
    await screen.findByText(translate('en', 'noActivity'));

    const allTab = screen.getByRole('tab', { name: translate('en', 'activityAll') });
    const mineTab = screen.getByRole('tab', { name: translate('en', 'activityMine') });
    const pendingTab = screen.getByRole('tab', { name: translate('en', 'activityPending') });
    await user.click(allTab);
    expect(allTab).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(mineTab).toHaveFocus();
    expect(mineTab).toHaveAttribute('aria-selected', 'true');
    expect(allTab).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', mineTab.id);

    await user.keyboard('{End}');
    expect(pendingTab).toHaveFocus();
    expect(pendingTab).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{ArrowRight}');
    expect(allTab).toHaveFocus();
    expect(allTab).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{ArrowLeft}');
    expect(pendingTab).toHaveFocus();

    await user.keyboard('{Home}');
    expect(allTab).toHaveFocus();
    expect(screen.getAllByRole('tab', { selected: true })).toEqual([allTab]);
    await screen.findByText(translate('en', 'noActivity'));
  });
});
