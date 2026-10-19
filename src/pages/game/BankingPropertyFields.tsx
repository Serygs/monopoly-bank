import { AmountSelector } from '../../components/AmountSelector';
import { Field, FieldError, FieldHint, MoneyValue, Toggle } from '../../components/ui';
import { BuildingStepper } from './BuildingStepper';
import { MortgageDetails, RedemptionPicker } from './MortgageFields';
import { TilePicker } from './TilePicker';
import type { BankingForm } from './useBankingDialog';

function PurchaseFields({ form }: { form: BankingForm }) {
  const { t, inputs, fields, d, items, handlers, presets } = form;
  return (
    <>
      <TilePicker
        currency={inputs.currency}
        legend={t('tileChooseBuy')}
        items={items.buy}
        value={fields.tileId}
        onChange={handlers.chooseTile}
      />
      {d.selectedTile !== null && (
        <div className="grid gap-(--mb-space-3)">
          <Toggle
            variant="inline"
            label={t('priceOverrideToggle')}
            checked={fields.overrideOn}
            onChange={handlers.changeOverrideOn}
          />
          {fields.overrideOn && (
            <AmountSelector
              value={fields.overridePrice}
              onChange={handlers.changeOverridePrice}
              currency={inputs.currency}
              presets={presets}
            />
          )}
        </div>
      )}
    </>
  );
}

function BuildFields({ form }: { form: BankingForm }) {
  const { inputs, d, funds, handlers } = form;
  if (d.board === null || d.build.buildMode === null) return null;
  return (
    <BuildingStepper
      board={d.board}
      views={d.views}
      playerId={inputs.player.id}
      mode={d.build.buildMode}
      groups={d.build.groupIds}
      group={d.build.group}
      onGroupChange={handlers.changeBuildGroup}
      levels={d.build.levels}
      onLevelsChange={handlers.changeBuildLevels}
      balance={funds.available}
      currency={inputs.currency}
    />
  );
}

function RentFields({ form }: { form: BankingForm }) {
  const { t, inputs, fields, d, items, handlers } = form;
  return (
    <>
      <TilePicker
        currency={inputs.currency}
        legend={t('tileChooseRent')}
        items={items.rent}
        value={fields.tileId}
        onChange={handlers.chooseTile}
      />
      {d.needsDiceSum && (
        <Field variant="dialog" label={t('rentDiceSum')}>
          <input
            value={fields.diceSum}
            inputMode="numeric"
            autoComplete="off"
            onChange={(event) => handlers.changeDiceSum(event.target.value)}
          />
        </Field>
      )}
      {d.diceSumInvalid && (
        <FieldError as="p" announce>
          {t('rentDiceSumInvalid')}
        </FieldError>
      )}
      {d.selectedTile !== null && d.rentAmount !== null && (
        <div className="flex items-baseline justify-between gap-(--mb-space-3)">
          <span className="text-secondary">{t('rentAmountLabel')}</span>
          <strong aria-live="polite">
            <MoneyValue amount={d.rentAmount} currency={inputs.currency} />
          </strong>
        </div>
      )}
      <FieldHint>{t('rentComputedHint')}</FieldHint>
    </>
  );
}

function MortgageFields({ form }: { form: BankingForm }) {
  const { t, inputs, fields, d, items, handlers } = form;
  if (d.board === null)
    return (
      <MortgageDetails
        propertyName={fields.propertyName}
        onPropertyNameChange={handlers.changePropertyName}
        noBuildings={fields.noBuildings}
        onNoBuildingsChange={(noBuildings) => handlers.patchField({ noBuildings })}
      />
    );
  return (
    <TilePicker
      currency={inputs.currency}
      legend={t('tileChooseMortgage')}
      items={items.mortgage}
      value={fields.tileId}
      onChange={handlers.chooseTile}
    />
  );
}

function RedeemFields({ form }: { form: BankingForm }) {
  const { t, inputs, fields, d, items, handlers } = form;
  if (d.board === null)
    return (
      <RedemptionPicker
        mortgages={d.mortgage.playerMortgages}
        currency={inputs.currency}
        value={fields.mortgageId}
        onChange={handlers.chooseMortgage}
      />
    );
  return (
    <TilePicker
      currency={inputs.currency}
      legend={t('tileChooseRedeem')}
      items={items.redeem}
      value={d.mortgage.selected?.tileId ?? ''}
      onChange={(view) => {
        const mortgage = items.tileMortgages.find((item) => item.tileId === view.tile.id);
        if (mortgage !== undefined) handlers.chooseMortgage(mortgage);
      }}
    />
  );
}

export function BankingPropertyPickers({ form }: { form: BankingForm }) {
  const { action } = form.fields;
  const onBoard = form.d.board !== null;
  return (
    <>
      {onBoard && action === 'PROPERTY_PURCHASE' && <PurchaseFields form={form} />}
      {onBoard && <BuildFields form={form} />}
      {onBoard && action === 'PAY_RENT' && <RentFields form={form} />}
      {action === 'MORTGAGE' && <MortgageFields form={form} />}
      {action === 'MORTGAGE_REDEMPTION' && <RedeemFields form={form} />}
    </>
  );
}

export function BankingPropertyHints({ form }: { form: BankingForm }) {
  const { t, fields, d } = form;
  const { action } = fields;
  return (
    <>
      {action === 'MORTGAGE' && (
        <FieldHint>{t(d.board === null ? 'mortgageValueHint' : 'tileMortgageHint')}</FieldHint>
      )}
      {action === 'PROPERTY_BUILD' && <FieldHint>{t('tileBuildHint')}</FieldHint>}
      {action === 'PROPERTY_SELL_BUILDING' && <FieldHint>{t('tileSellBuildingHint')}</FieldHint>}
      {action === 'PROPERTY_PURCHASE' && !fields.overrideOn && (
        <FieldHint>{t('tilePurchaseHint')}</FieldHint>
      )}
    </>
  );
}
