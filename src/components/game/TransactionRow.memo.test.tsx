import { act, render } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { buildPlayer, buildTransaction } from '../../../shared/test-support/fixtures';
import type * as dateTime from '../../utils/date-time';
import { dateTimeFormat } from '../../utils/date-time';
import { TransactionRow } from './TransactionRow';

// Every draw of a row formats its time, so this counts how often a row is drawn.
vi.mock('../../utils/date-time', async (importOriginal) => {
  const actual = await importOriginal<typeof dateTime>();
  return { ...actual, dateTimeFormat: vi.fn(actual.dateTimeFormat) };
});

type Props = ComponentProps<typeof TransactionRow>;

function setup(initial: Props) {
  const tree = (props: Props) => (
    <ol>
      <TransactionRow {...props} />
    </ol>
  );
  const view = render(tree(initial));
  const before = vi.mocked(dateTimeFormat).mock.calls.length;
  return {
    update: (props: Props) => act(() => view.rerender(tree(props))),
    redraws: () => vi.mocked(dateTimeFormat).mock.calls.length - before,
  };
}

const base = (): Props => ({
  transaction: buildTransaction({ id: 't1', createdAt: '2026-10-16T12:00:00.000Z' }),
  players: [buildPlayer({ id: 'p1', name: 'Ada' }), buildPlayer({ id: 'p2', name: 'Bob' })],
  currency: 'USD',
  language: 'en',
  locale: 'en-US',
});

describe('TransactionRow memo', () => {
  it('skips a redraw when a live event only hands over equal copies', () => {
    const props = base();
    const { update, redraws } = setup(props);
    update({
      ...props,
      transaction: { ...props.transaction },
      players: props.players.map((player) => ({ ...player, balance: player.balance + 5 })),
    });
    expect(redraws()).toBe(0);
  });

  it('redraws for a rename, a reversal and a reverse button appearing', () => {
    const props = base();
    const { update, redraws } = setup(props);
    update({ ...props, players: [{ ...props.players[0]!, name: 'Ada L.' }, props.players[1]!] });
    expect(redraws()).toBeGreaterThanOrEqual(1);
    const afterRename = redraws();
    update({ ...props, transaction: { ...props.transaction, reversedByTransactionId: 'r1' } });
    expect(redraws()).toBeGreaterThan(afterRename);
    const afterReversal = redraws();
    update({ ...props, onReverse: () => undefined });
    expect(redraws()).toBeGreaterThan(afterReversal);
  });
});
