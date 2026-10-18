import { AmountSelector } from '../../components/AmountSelector';
import { Button, FieldHint, MoneyValue } from '../../components/ui';
import type { BankingForm } from './useBankingDialog';

function FixedPayments({ form }: { form: BankingForm }) {
  const { t, inputs, handlers } = form;
  const { settings } = inputs;
  if (form.fields.action !== 'PLAYER_TO_BANK' || settings === null) return null;
  const chips = [
    ['incomeTax', settings.incomeTax],
    ['luxuryTax', settings.luxuryTax],
    ['jailFine', settings.jailFine],
  ] as const;
  return (
    <div className="grid gap-(--mb-space-2)" role="group" aria-label={t('fixedPayments')}>
      <span className="text-small font-semibold text-secondary">{t('fixedPayments')}</span>
      <div className="flex flex-wrap gap-(--mb-space-2)">
        {chips.map(([key, fixedAmount]) => (
          <Button
            key={key}
            variant="secondary"
            onClick={() =>
              handlers.reviewFixedPayment(
                t(key),
                fixedAmount,
                key !== 'jailFine' && inputs.rules.freeParkingJackpot,
              )
            }
          >
            {t(key)} · <MoneyValue amount={fixedAmount} currency={inputs.currency} />
          </Button>
        ))}
      </div>
    </div>
  );
}

function showsAmountSelector(form: BankingForm): boolean {
  const { action } = form.fields;
  const { loan } = form.d;
  if (!form.d.amountRequired || action === 'MORTGAGE_REDEMPTION') return false;
  return action !== 'LOAN_REPAYMENT' || (loan.selected !== null && !loan.isBankRepayment);
}

export function BankingAmountFields({ form }: { form: BankingForm }) {
  const { t, inputs, fields, props, presets, handlers, d } = form;
  return (
    <>
      {d.requestAction === 'TO_JACKPOT' && <FieldHint>{t('payToPotHint')}</FieldHint>}
      {showsAmountSelector(form) && (
        <AmountSelector
          value={fields.amount}
          onChange={handlers.changeAmount}
          currency={inputs.currency}
          favorites={props.favoriteAmounts}
          recent={props.recentAmounts}
          presets={presets}
          onToggleFavorite={props.onToggleFavorite}
          onQuickAmountSelect={handlers.reviewQuickAmount}
        />
      )}
      <FixedPayments form={form} />
    </>
  );
}
