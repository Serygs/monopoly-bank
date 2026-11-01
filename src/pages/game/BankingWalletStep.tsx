import { WalletMenu } from '../../components/game/WalletMenu';
import { Button, FieldHint, MoneyValue, Notice } from '../../components/ui';
import { formatMoney } from '../../utils/money';
import { loanOutstanding } from '../../utils/loans';
import { balanceClass, bankruptcyClass } from './banking-dialog-styles';
import { primaryItems, walletMenuGroups } from './banking-wallet-menu';
import type { BankingForm } from './useBankingDialog';

function OverdueNotice({ form }: { form: BankingForm }) {
  const { t, money, d, handlers } = form;
  const loan = d.loan.bankLoan;
  if (loan?.rounds?.overdue !== true) return null;
  return (
    <Notice tone="error" className="mb-(--mb-space-3)">
      <span className="block">
        {t('settleLoanPrompt', { amount: money(loanOutstanding(loan)), round: loan.rounds.round })}
      </span>
      <Button
        variant="danger"
        className="mt-(--mb-space-2)"
        onClick={() => handlers.settleBankLoan(loan)}
      >
        {t('settleLoan')}
      </Button>
    </Notice>
  );
}

function MenuHints({ form }: { form: BankingForm }) {
  const { t, inputs, auctionBusy, canAuction } = form;
  const potFilled = inputs.rules.freeParkingJackpot && inputs.jackpot > 0;
  return (
    <>
      {canAuction && auctionBusy && <FieldHint>{t('auctionActionBusy')}</FieldHint>}
      {potFilled && (
        <FieldHint>{t('jackpotPotHint', { amount: form.money(inputs.jackpot) })}</FieldHint>
      )}
    </>
  );
}

function BalanceCard({ form }: { form: BankingForm }) {
  const { t, inputs, funds } = form;
  const { player, currency } = inputs;
  return (
    <section
      className={balanceClass}
      aria-label={t('walletBalanceAria', {
        name: player.name,
        balance: formatMoney(funds.available, currency),
      })}
    >
      <span>{t('availableBalance')}</span>
      <strong>
        <MoneyValue amount={funds.available} currency={currency} />
      </strong>
    </section>
  );
}

export function BankingWalletStep({ form }: { form: BankingForm }) {
  const { t, inputs, props, funds, fields, transactionError } = form;
  const { player, rules } = inputs;
  return (
    <>
      {transactionError !== null && <Notice tone="error">{transactionError}</Notice>}
      <BalanceCard form={form} />
      {funds.reserved > 0 && (
        <FieldHint>{t('auctionReservedYours', { amount: form.money(funds.reserved) })}</FieldHint>
      )}
      <OverdueNotice form={form} />
      <WalletMenu
        primary={primaryItems(form)}
        exactGo={
          rules.doubleRewardOnExactGo
            ? {
                label: t('passGoExact'),
                checked: fields.exactGoChosen,
                onChange: (exactGoChosen) => form.handlers.patchField({ exactGoChosen }),
              }
            : undefined
        }
        groups={walletMenuGroups(form)}
      >
        <MenuHints form={form} />
        <Button variant="quiet" onClick={() => props.onViewHistory(player)}>
          {t('viewPlayerHistory', { name: player.name })}
        </Button>
        {/* Last and quiet: a final step should not be the brightest thing in the menu. */}
        <button type="button" className={bankruptcyClass} onClick={props.onBankrupt}>
          {t('declareBankrupt')}
        </button>
      </WalletMenu>
    </>
  );
}
