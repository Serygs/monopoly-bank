import { memo, useId } from 'react';
import type { BoardDefinition, BoardSpace, BuildingBank, GameProperty, Player } from '../../shared/types/monopoly';
import { useLanguage } from '../i18n/language-context';
import { playerNameWithGameId } from '../utils/player-display';
import { freeSpaces, groupSpaces, propertyOf, spacesOwnedBy } from '../utils/property-view';
import { DeedChip, GroupBadge } from './SpacePicker';

interface PropertyPanelProps {
  board: BoardDefinition;
  boardSpaces: BoardSpace[];
  properties: GameProperty[];
  buildingBank: BuildingBank;
  players: Player[];
  /** Spectators and finished games see the deeds but cannot open the action sheet. */
  interactive: boolean;
  onSelect: (space: BoardSpace) => void;
}

/**
 * Every deed on the table, per owner and by colour, with the bank's unsold
 * deeds folded away. Memoised on the board slice so a heartbeat or presence
 * event never repaints twenty-eight chips.
 */
export const PropertyPanel = memo(function PropertyPanel({ boardSpaces, properties, buildingBank, players, interactive, onSelect }: PropertyPanelProps) {
  const { t } = useLanguage();
  const titleId = useId();
  const state = { boardSpaces, properties };
  const free = freeSpaces(state);
  const chip = (space: BoardSpace) => <DeedChip key={space.id} space={space} property={propertyOf(properties, space.id)} onClick={interactive ? () => onSelect(space) : undefined} />;
  return <section className="property-panel banknote-panel" data-testid="property-panel" aria-labelledby={titleId}>
    <header><div><h2 id={titleId}>{t('propertyPanel')}</h2><p className="muted">{interactive ? t('propertyPanelHint') : t('buildingBankStatus', { houses: buildingBank.housesAvailable, hotels: buildingBank.hotelsAvailable })}</p></div>{interactive && <span className="status-pill">{t('buildingBankStatus', { houses: buildingBank.housesAvailable, hotels: buildingBank.hotelsAvailable })}</span>}</header>
    <div className="property-owners">
      {players.map((player) => {
        const owned = spacesOwnedBy(state, player.id);
        return <section className="property-owner" key={player.id} style={{ borderInlineStartColor: player.color }} aria-label={playerNameWithGameId(player, players)}>
          <h3><span className="player-color" style={{ backgroundColor: player.color }} aria-hidden="true" />{playerNameWithGameId(player, players)}</h3>
          {owned.length === 0 ? <p className="muted">{t('noDeeds')}</p> : groupSpaces(owned).map(({ group, spaces }) => <div className="property-group" key={group}><GroupBadge group={group} /><div className="deed-list">{spaces.map(chip)}</div></div>)}
        </section>;
      })}
    </div>
    <details className="property-free"><summary>{t('freeSpaces')} <span className="status-pill">{t('freeSpacesCount', { count: free.length })}</span></summary>
      {groupSpaces(free).map(({ group, spaces }) => <div className="property-group" key={group}><GroupBadge group={group} /><div className="deed-list">{spaces.map(chip)}</div></div>)}
    </details>
  </section>;
});
