import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { monopolyBankApi } from '../api/monopoly-bank-api';
import { LanguageContext } from '../i18n/language-context';
import { languageLocale, translate } from '../i18n/translations';
import type { UserProfile } from '../../shared/contracts/api';
import { CreateGamePage } from './CreateGamePage';

const profile: UserProfile = {
  id: 'user-1',
  nickname: 'Alice',
  avatar: '🎩',
  accountType: 'GUEST',
  email: null,
  emailVerified: false,
  gamesPlayed: 0,
  gamesWon: 0,
  gamesLost: 0,
  winRate: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('create game colour picker', () => {
  it('does not submit the form when Enter is pressed on a colour option', async () => {
    const user = userEvent.setup();
    const createGame = vi.spyOn(monopolyBankApi, 'createGame');
    const { container } = render(
      <LanguageContext
        value={{
          language: 'en',
          locale: languageLocale('en'),
          setLanguage: () => {},
          t: (key, values) => translate('en', key, values),
        }}
      >
        <CreateGamePage profile={profile} onCancel={() => {}} onCreated={() => {}} />
      </LanguageContext>,
    );
    const form = container.querySelector('form');
    expect(form).not.toBeNull();
    const onSubmit = vi.fn();
    form?.addEventListener('submit', onSubmit);

    const selected = screen.getByRole('radio', { name: 'Select color red' });
    expect(selected).toHaveAttribute('aria-checked', 'true');
    selected.focus();
    await user.keyboard('{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();

    // Enter on another colour still selects it and still does not submit.
    const blue = screen.getByRole('radio', { name: 'Select color blue' });
    blue.focus();
    await user.keyboard('{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(blue).toHaveAttribute('aria-checked', 'true');
    expect(createGame).not.toHaveBeenCalled();
  });
});

describe('game name suggestions in the refactored form', () => {
  for (const language of ['en', 'uk'] as const) {
    it(`${language}: keeps suggestions editable and preserves the colour picker without submitting`, async () => {
      const user = userEvent.setup();
      const createGame = vi.spyOn(monopolyBankApi, 'createGame');
      const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
      render(
        <LanguageContext
          value={{
            language,
            locale: languageLocale(language),
            setLanguage: () => {},
            t: (key, values) => translate(language, key, values),
          }}
        >
          <CreateGamePage profile={profile} onCancel={() => {}} onCreated={() => {}} />
        </LanguageContext>,
      );
      const name = screen.getByLabelText(t('gameName'));
      const trigger = screen.getByRole('button', { name: t('suggestGameName') });
      await user.click(trigger);
      const suggestions = screen.getByRole('dialog', { name: t('suggestedGameNames') });
      const choices = Array.from(suggestions.querySelectorAll('button'));
      expect(choices).toHaveLength(6);
      await user.click(choices[0]);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(name).toHaveFocus();
      expect(name).not.toHaveValue('');
      await user.clear(name);
      await user.type(name, 'Edited name');
      expect(name).toHaveValue('Edited name');

      await user.click(trigger);
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(name).toHaveFocus();
      await user.click(trigger);
      await user.click(screen.getByLabelText(t('currency')));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getAllByRole('radio')).toHaveLength(6);
      expect(createGame).not.toHaveBeenCalled();
    });
  }
});
