import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../i18n/LanguageProvider';
import { NumericKeypad } from './NumericKeypad';

function mount(digits: string, onChange = vi.fn()) {
  window.localStorage.setItem('monopoly-bank-language', 'en');
  render(
    <LanguageProvider>
      <NumericKeypad digits={digits} unit="ONES" onChange={onChange} />
    </LanguageProvider>,
  );
  return { onChange, key: screen.getByRole('button', { name: '5' }) };
}

describe('NumericKeypad hardware keyboard', () => {
  it('types digits and deletes with Backspace while a key has focus', () => {
    const { onChange, key } = mount('12');
    fireEvent.keyDown(key, { key: '7' });
    expect(onChange).toHaveBeenLastCalledWith('127');
    fireEvent.keyDown(key, { key: 'Backspace' });
    expect(onChange).toHaveBeenLastCalledWith('1');
  });

  it('leaves Enter and shortcuts alone', () => {
    const { onChange, key } = mount('12');
    fireEvent.keyDown(key, { key: 'Enter' });
    fireEvent.keyDown(key, { key: '7', ctrlKey: true });
    expect(onChange).not.toHaveBeenCalled();
  });
});
