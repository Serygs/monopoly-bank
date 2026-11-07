import { useBuildingLabel } from '../../components/game/property-labels';
import { Button, Notice, SheetActions } from '../../components/ui';
import { cx } from '../../components/ui/class-names';
import { sellRefund } from '../../../shared/domain/property';
import { groupStreets } from '../../utils/property-view';
import { StepBody } from './banking-dialog-parts';
import { bankruptcyClass, stepFooterClass } from './banking-dialog-styles';
import { raiseTotals } from './banking-raise-plan';
import { BuildingStepper } from './BuildingStepper';
import { actionLabel } from './game-page-helpers';
import { TileMultiPicker } from './TilePicker';
import type { BankingForm } from './useBankingDialog';

const totalsClass =
  'm-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-(--mb-space-4) gap-y-(--mb-space-1) rounded-control border p-(--mb-space-3) text-small [&_dd]:m-0 [&_dd]:text-end [&_dd]:font-money [&_dd]:font-semibold [&_dd]:tabular-nums [&_dt]:text-secondary';
const plainTotalsClass = cx(totalsClass, 'border-border bg-surface-subtle');
/* Solid, not the glass tint: the choices scroll underneath it and must not show through. */
const pinnedTotalsClass = cx(
  totalsClass,
  'sticky top-0 z-1 border-border-strong bg-(--mb-glass-tint-solid) shadow-sm',
);
const headingClass = 'm-0 font-semibold text-primary';

function totalsOf(form: BankingForm) {
  const { funds, raise } = form;
  return raiseTotals(funds.available, funds.shortfall ?? 0, raise?.gain ?? 0, raise?.maxGain ?? 0);
}

/** A surplus left over, or how much is still missing, under the matching label. */
function Remainder({
  form,
  value,
  left,
  short,
}: {
  form: BankingForm;
  value: number;
  left: string;
  short: string;
}) {
  return (
    <>
      <dt>{value < 0 ? short : left}</dt>
      <dd className={cx(value < 0 && 'text-danger')}>{form.money(Math.abs(value))}</dd>
    </>
  );
}

/**
 * The figures that do not change with the choices come first and scroll away; what the choices
 * change stays pinned to the top of the step, so it is in view while choosing further down.
 */
function RaiseTotals({ form }: { form: BankingForm }) {
  const { t, money, funds, raise } = form;
  const totals = totalsOf(form);
  return (
    <>
      <dl className={plainTotalsClass}>
        <dt>{t('raiseNow')}</dt>
        <dd>{money(funds.available)}</dd>
        <dt>{t('raisePayment')}</dt>
        <dd>{money(totals.payment)}</dd>
        {raise !== null && (
          <>
            <dt>{t('raiseIfAll')}</dt>
            <dd>{money(totals.afterAll)}</dd>
            <Remainder
              form={form}
              value={totals.leftAfterAll}
              left={t('raiseIfAllLeft')}
              short={t('raiseIfAllShort')}
            />
          </>
        )}
      </dl>
      <dl className={pinnedTotalsClass} aria-live="polite">
        {raise !== null && (
          <>
            <dt>{t('raiseSelected')}</dt>
            <dd>+{money(raise.gain)}</dd>
            <dt>{t('raiseAfterSelected')}</dt>
            <dd>{money(totals.afterSelected)}</dd>
          </>
        )}
        <Remainder
          form={form}
          value={totals.left}
          left={t('raiseLeft')}
          short={t('raiseStillShort')}
        />
      </dl>
    </>
  );
}

/** Board games: choose buildings and tiles right here, with the totals above them. */
function BoardChoices({ form }: { form: BankingForm }) {
  const { t, money, inputs, d, raise, fields, handlers } = form;
  if (d.board === null || raise === null) return null;
  const { board } = d;
  return (
    <>
      {raise.groups.length > 0 && (
        <div className="grid gap-(--mb-space-3)">
          <h3 className={headingClass}>{t('raiseSellHeading')}</h3>
          {raise.groups.map(({ group, levels }) => (
            <BuildingStepper
              key={group}
              compact
              board={board}
              views={d.views}
              playerId={inputs.player.id}
              mode="SELL"
              groups={[group]}
              group={group}
              onGroupChange={() => undefined}
              levels={levels}
              onLevelsChange={(next) => handlers.changeRaiseLevels(group, next)}
              balance={form.funds.available}
              currency={inputs.currency}
            />
          ))}
        </div>
      )}
      {raise.mortgageable.length > 0 && (
        <TileMultiPicker
          currency={inputs.currency}
          legend={t('tileChooseMortgage')}
          items={raise.mortgageable.map((view) => ({
            view,
            caption: t('tilePickerMortgageFor', { amount: money(view.tile.mortgage) }),
          }))}
          values={fields.raisePlan.mortgageIds}
          onToggle={handlers.toggleRaiseMortgage}
        />
      )}
    </>
  );
}

function OtherWays({ form }: { form: BankingForm }) {
  const { t, money, inputs, d, fields, props, handlers, canAuction, auctionBusy } = form;
  const onBoard = d.board !== null;
  const { bankLoanMax } = d.loan;
  const canBorrow =
    inputs.rules.bankLoans && d.loan.bankLoan === null && bankLoanMax !== null && bankLoanMax > 0;
  const auctionable = fields.action === 'PLAYER_TO_BANK' || fields.action === 'PLAYER_TO_PLAYER';
  const onStartAuction = props.onStartAuction;
  return (
    <div className="grid gap-(--mb-space-2)">
      {!onBoard && (
        <>
          <Button variant="secondary" onClick={() => handlers.startRaise('MORTGAGE')}>
            {t('mortgageProperty')}
          </Button>
          <Button variant="secondary" onClick={() => handlers.startRaise('BANK_TO_PLAYER')}>
            {t('sellBuildingsToBank')}
          </Button>
        </>
      )}
      {canBorrow && (
        <Button variant="secondary" onClick={() => handlers.startRaise('BANK_LOAN')}>
          {actionLabel('BANK_LOAN', t)} · {t('raiseUpTo', { amount: money(bankLoanMax) })}
        </Button>
      )}
      {canAuction && !auctionBusy && auctionable && onStartAuction !== undefined && (
        <Button
          variant="secondary"
          onClick={() => onStartAuction(fields.comment.trim().slice(0, 60))}
        >
          {t('auctionInstead')}
        </Button>
      )}
      <button type="button" className={bankruptcyClass} onClick={props.onBankrupt}>
        {t('declareBankrupt')}
      </button>
    </div>
  );
}

function RaiseMenu({ form }: { form: BankingForm }) {
  const { t, raise, handlers, transactionError, raiseReady } = form;
  const nothingOnBoard =
    raise !== null && raise.groups.length === 0 && raise.mortgageable.length === 0;
  return (
    <>
      <StepBody>
        <div className="grid gap-(--mb-space-4)">
          {transactionError !== null && <Notice tone="error">{transactionError}</Notice>}
          <RaiseTotals form={form} />
          {nothingOnBoard && <Notice tone="info">{t('raiseNothing')}</Notice>}
          <BoardChoices form={form} />
          <OtherWays form={form} />
        </div>
      </StepBody>
      <SheetActions className={stepFooterClass}>
        <Button variant="secondary" onClick={handlers.closeRaise}>
          {t('back')}
        </Button>
        {raise !== null && (
          <Button variant="primary" disabled={!raiseReady} onClick={handlers.reviewRaise}>
            {t('reviewTransaction')}
          </Button>
        )}
      </SheetActions>
    </>
  );
}

function reviewLines(form: BankingForm, buildingLabel: (houses: number) => string | null) {
  const { t, money, d, raise } = form;
  if (d.board === null || raise === null) return [];
  const { board } = d;
  const none = t('buildingNone');
  const sales = raise.groups.flatMap(({ group, levels }) =>
    groupStreets(d.views, group).flatMap((view) => {
      const level = levels[view.tile.id];
      if (level === undefined || level === view.houses) return [];
      const label = t('buildingsSummaryLine', {
        name: view.tile.name,
        from: buildingLabel(view.houses) ?? none,
        to: buildingLabel(level) ?? none,
      });
      const refund = (view.houses - level) * sellRefund(board, view.tile.id);
      return [{ key: view.tile.id, label, amount: money(refund) }];
    }),
  );
  const mortgages = raise.mortgages.map((view) => ({
    key: `mortgage-${view.tile.id}`,
    label: t('raiseMortgageLine', { name: view.tile.name }),
    amount: money(view.tile.mortgage),
  }));
  return [...sales, ...mortgages];
}

/** One review for everything chosen; each operation is still recorded on its own. */
function RaiseReview({ form }: { form: BankingForm }) {
  const { t, money, inputs, raise, handlers, submitting } = form;
  const buildingLabel = useBuildingLabel();
  const totals = totalsOf(form);
  return (
    <>
      <StepBody>
        <div className="grid gap-(--mb-space-4)">
          <dl className={plainTotalsClass}>
            {reviewLines(form, buildingLabel).map(({ key, label, amount }) => (
              <div key={key} className="contents">
                <dt>{label}</dt>
                <dd>+{amount}</dd>
              </div>
            ))}
          </dl>
          <dl className={plainTotalsClass} aria-live="polite">
            <dt>{t('source')}</dt>
            <dd>{t('bank')}</dd>
            <dt>{t('destination')}</dt>
            <dd>{inputs.player.name}</dd>
            <dt>{t('total')}</dt>
            <dd>+{money(raise?.gain ?? 0)}</dd>
            <dt>{t('raiseAfterSelected')}</dt>
            <dd>{money(totals.afterSelected)}</dd>
            <Remainder
              form={form}
              value={totals.left}
              left={t('raiseLeft')}
              short={t('raiseStillShort')}
            />
          </dl>
        </div>
      </StepBody>
      <SheetActions className={stepFooterClass}>
        <Button variant="secondary" disabled={submitting} onClick={handlers.backFromRaiseReview}>
          {t('back')}
        </Button>
        <Button variant="primary" disabled={submitting} onClick={() => void form.submitRaise()}>
          {submitting ? t('recording') : t('confirmTransaction')}
        </Button>
      </SheetActions>
    </>
  );
}

export function BankingRaiseStep({ form }: { form: BankingForm }) {
  return form.fields.raiseConfirming ? <RaiseReview form={form} /> : <RaiseMenu form={form} />;
}
