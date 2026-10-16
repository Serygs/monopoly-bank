import { useEffect, useRef, useState } from 'react';
import type { AuctionResponse } from '../../../shared/contracts/api';
import type { Auction, Currency, GameSettings, Player } from '../../../shared/types/monopoly';
import { MonopolyBankApiError, monopolyBankApi } from '../../api/monopoly-bank-api';
import { Dialog } from '../../components/Dialog';
import { Button, DialogActions, MoneyValue, Notice } from '../../components/ui';
import { apiErrorMessage } from '../../i18n/api-errors';
import { useLanguage } from '../../i18n/language-context';
import {
  auctionReserveFor,
  availableCash,
  nextBidAmount,
  useAuctionCountdown,
} from '../../utils/auction';
import { formatMoney } from '../../utils/money';

export interface AuctionDialogProps {
  gameId: string;
  auction: Auction;
  players: Player[];
  /** Wallets the viewer can bid with (may be empty for a spectator). */
  controlledPlayerIds: string[];
  currency: Currency;
  settings: GameSettings | null;
  /** Bids are refused while the game is not running or the device is offline. */
  canMutate: boolean;
  onClose: () => void;
  /** A bid was accepted, or the server sent a newer auction with an error. */
  onUpdated: (response: AuctionResponse) => void;
  /** Ask the server for the auction again (the countdown ended but no result arrived yet). */
  onRefresh: () => void;
}

/** How long to wait between refreshes while the time is up but the result has not arrived. */
const SETTLE_RETRY_MS = 1500;

const statClass =
  'grid gap-[4px] rounded-control border border-border bg-surface-subtle p-(--mb-space-4) [&>span]:text-small [&>span]:text-secondary [&>strong]:font-money [&>strong]:text-[1.75rem] [&>strong]:leading-[1.1] [&>strong]:tabular-nums [&>strong]:text-primary';
const bidGridClass = 'grid grid-cols-2 gap-(--mb-space-2)';

/** The live auction for everyone at the table: lot, leader, countdown and bid buttons. */
export function AuctionDialog({
  gameId,
  auction,
  players,
  controlledPlayerIds,
  currency,
  settings,
  canMutate,
  onClose,
  onUpdated,
  onRefresh,
}: AuctionDialogProps) {
  const { t } = useLanguage();
  const remaining = useAuctionCountdown(auction);
  const [chosenBidderId, setChosenBidderId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown | null>(null);
  const submittingRef = useRef(false);
  const active = auction.state === 'ACTIVE';
  const expired = active && remaining <= 0;
  const open = active && !expired;
  const minBid = settings?.auctionMinBid ?? 0;
  const steps = settings?.auctionBidSteps ?? [];
  const nameOf = (id: string | null) =>
    id === null ? null : (players.find((player) => player.id === id)?.name ?? t('playerFallback'));
  const leader = nameOf(auction.currentBidderId);

  const wallets = controlledPlayerIds
    .map((id) => players.find((player) => player.id === id))
    .filter((player): player is Player => player !== undefined && player.status !== 'BANKRUPT');
  const leading = (player: Player) => auction.currentBidderId === player.id;
  const canAfford = (player: Player, step: number) =>
    availableCash(player, auction) >= nextBidAmount(auction, step, minBid);
  const eligible = (player: Player) =>
    !leading(player) && steps.some((step) => canAfford(player, step));
  const bidder =
    wallets.find((player) => player.id === chosenBidderId) ??
    wallets.find(eligible) ??
    wallets[0] ??
    null;

  // Once the time is up, keep asking for the result in case the live event was missed.
  useEffect(() => {
    if (!expired) return;
    const first = window.setTimeout(onRefresh, 500);
    const timer = window.setInterval(onRefresh, SETTLE_RETRY_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [expired, onRefresh]);

  const bid = async (step: number) => {
    if (submittingRef.current || bidder === null) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      onUpdated(
        await monopolyBankApi.placeBid(
          gameId,
          {
            bidderPlayerId: bidder.id,
            auctionId: auction.id,
            expectedVersion: auction.version,
            step,
          },
          crypto.randomUUID(),
        ),
      );
    } catch (caught) {
      setError(caught);
      // A stale bid carries the newer auction; show it and keep the dialog open.
      const latest = caught instanceof MonopolyBankApiError ? caught.details?.auction : undefined;
      if (latest !== undefined && latest !== null && typeof latest === 'object')
        onUpdated({ auction: latest as Auction });
      else if (caught instanceof MonopolyBankApiError && caught.code !== 'NETWORK_ERROR')
        onRefresh();
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const title = t('auctionDialogTitle');
  const reservedForViewer = wallets.find((player) => auctionReserveFor(auction, player.id) > 0);
  const hint =
    !open || bidder === null
      ? null
      : leading(bidder)
        ? t('auctionAlreadyLeadingHint')
        : steps.every((step) => !canAfford(bidder, step))
          ? t('auctionNotEnoughCash')
          : null;
  const seconds = Math.ceil(remaining / 1000);

  return (
    <Dialog title={title} closeLabel={t('closeDialog', { title })} onClose={onClose}>
      <h3 className="m-0 text-[1.25rem] font-semibold wrap-anywhere">{auction.lotName}</h3>
      <p className="mt-(--mb-space-1) mb-(--mb-space-3) text-small text-secondary">
        {t('auctionOfferedBy', { name: nameOf(auction.initiatorPlayerId) ?? '' })}
      </p>
      {error !== null && <Notice tone="error">{apiErrorMessage(error, t, 'unableBid')}</Notice>}
      {auction.state === 'SOLD' && (
        <Notice tone="success">
          {t('auctionSoldTo', {
            name: leader ?? t('playerFallback'),
            amount: formatMoney(auction.currentBid, currency),
          })}
        </Notice>
      )}
      {auction.state === 'NO_SALE' && <Notice tone="info">{t('auctionNoSale')}</Notice>}
      <div className="grid grid-cols-2 gap-(--mb-space-3)">
        <p className={statClass}>
          <span>{t('auctionCurrentBid')}</span>
          <strong>
            {auction.currentBid > 0 ? (
              <MoneyValue amount={auction.currentBid} currency={currency} />
            ) : (
              '—'
            )}
          </strong>
          <span>
            {auction.currentBid > 0 && leader !== null
              ? t('auctionLeading', { name: leader })
              : t('auctionNoBids')}
          </span>
        </p>
        {active && (
          <p className={statClass}>
            <span>{t('auctionTimeLeft')}</span>
            <strong aria-live="off">
              {expired ? t('auctionClosing') : t('auctionSecondsLeft', { seconds })}
            </strong>
          </p>
        )}
      </div>
      {reservedForViewer !== undefined && active && (
        <p className="mt-(--mb-space-2) text-small text-secondary">
          {t('auctionReservedYours', {
            amount: formatMoney(auction.currentBid, currency),
          })}
        </p>
      )}
      {active && (
        <>
          {wallets.length === 0 ? (
            <p className="mt-(--mb-space-3) text-secondary">{t('auctionNoEligibleWallet')}</p>
          ) : (
            <>
              {wallets.length > 1 && (
                <fieldset className="mt-(--mb-space-3) m-0 border-0 p-0">
                  <legend className="mb-(--mb-space-2) text-small font-semibold text-secondary">
                    {t('auctionBidAs')}
                  </legend>
                  <div className="flex flex-wrap gap-(--mb-space-2)">
                    {wallets.map((player) => (
                      <Button
                        key={player.id}
                        variant="secondary"
                        aria-pressed={bidder?.id === player.id}
                        onClick={() => setChosenBidderId(player.id)}
                      >
                        {player.name}
                      </Button>
                    ))}
                  </div>
                </fieldset>
              )}
              <div className="mt-(--mb-space-3)" role="group" aria-label={t('auctionBidSteps')}>
                <div className={bidGridClass}>
                  {steps.map((step) => (
                    <Button
                      key={step}
                      variant="primary"
                      disabled={
                        !canMutate ||
                        !open ||
                        submitting ||
                        bidder === null ||
                        leading(bidder) ||
                        !canAfford(bidder, step)
                      }
                      aria-label={t('auctionBidAria', {
                        step: formatMoney(step, currency),
                        total: formatMoney(nextBidAmount(auction, step, minBid), currency),
                      })}
                      onClick={() => void bid(step)}
                    >
                      +{formatMoney(step, currency)}
                    </Button>
                  ))}
                </div>
              </div>
              {hint !== null && (
                <p className="mt-(--mb-space-2) text-small text-secondary">{hint}</p>
              )}
            </>
          )}
        </>
      )}
      <DialogActions>
        <Button variant="secondary" onClick={onClose}>
          {t('close')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
