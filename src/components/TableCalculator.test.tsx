import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { LanguageProvider } from '../i18n/LanguageProvider';
import { TableCalculator } from './TableCalculator';

function setup() {
  render(
    <LanguageProvider>
      <TableCalculator />
    </LanguageProvider>,
  );
  const user = userEvent.setup();
  const display = () => screen.getByLabelText('Calculator display');
  const press = async (...labels: string[]) => {
    for (const label of labels) await user.click(screen.getByRole('button', { name: label }));
  };
  return { user, display, press };
}

describe('TableCalculator', () => {
  it('chains operations from the keys', async () => {
    const { display, press } = setup();
    await press('2', 'Add', '3', 'Multiply', '4', 'Equals');
    expect(display()).toHaveTextContent('20');
    expect(display()).toHaveTextContent('5 × 4 =');
  });

  it('groups large results and takes decimals with the locale separator', async () => {
    const { display, press } = setup();
    await press(
      '1',
      '2',
      '0',
      '0',
      '0',
      '0',
      '0',
      'Multiply',
      '1',
      'Decimal separator',
      '5',
      'Equals',
    );
    expect(display()).toHaveTextContent('1 800 000');
  });

  it('highlights the pending operator', async () => {
    const { press } = setup();
    await press('8', 'Divide');
    expect(screen.getByRole('button', { name: 'Divide' })).toHaveAttribute('aria-pressed', 'true');
    await press('2');
    expect(screen.getByRole('button', { name: 'Divide' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('applies percent, sign change, backspace and clear', async () => {
    const { display, press } = setup();
    await press('2', '0', '0', 'Add', '1', '0', 'Percent', 'Equals');
    expect(display()).toHaveTextContent('220');
    await press('Clear', '9', '5', 'Backspace');
    expect(display()).toHaveTextContent('9');
    await press('Change sign');
    expect(display()).toHaveTextContent('-9');
  });

  it('reports division by zero and keeps working afterwards', async () => {
    const { display, press } = setup();
    await press('5', 'Divide', '0', 'Equals');
    expect(display()).toHaveTextContent('Cannot divide by zero');
    await press('7');
    expect(display()).toHaveTextContent('7');
  });

  it('lists recent calculations and reuses a result', async () => {
    const { display, press, user } = setup();
    await press('6', 'Multiply', '7', 'Equals', 'Clear');
    expect(screen.getByRole('region', { name: 'Recent calculations' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Use 42 from 6 × 7 =' }));
    expect(display()).toHaveTextContent('42');
  });

  it('works from the physical keyboard', async () => {
    const { display, user } = setup();
    screen.getByRole('button', { name: '1' }).focus();
    await user.keyboard('12+8*2=');
    expect(display()).toHaveTextContent('40');
    await user.keyboard('{Escape}');
    expect(display()).toHaveTextContent('0');
  });
});
