/**
 * One market card: a head row and a body block.
 *
 * The head is `[48px tile][title row (title + source mark) / author line][install seat]` in
 * a single row, so the action sits at the top right exactly where the sketch puts it. The
 * row does not wrap (the flex default): when the install label grows to "installing" the
 * title block shrinks into an ellipsis instead, and the seat never drops to a second line.
 * The seat's vertical position comes from the head's `align-items: center` - the same
 * recipe as the installed tab's own row, and it keeps the button still when the card grows.
 *
 * The body is the description, the tag chips and the three figures, all full width and all
 * from the card's left edge.
 *
 * Clickability has exactly one mechanism, copied from the host's own market card: the
 * title button's `::after` covers the whole card (`inset: 0`), and the single action seat
 * carries `z-index: 1` so it floats above that layer. Nothing here is an `<a href>`, and the
 * card itself is not a button - a card that looks clickable in two ways is a card whose
 * clicks land somewhere unexpected. The body deliberately has no z-index and no position:
 * it sits *under* the click layer, so tapping a tag or a figure is tapping blank space,
 * which opens the detail view. That is the one arrangement where nothing looks clickable
 * without being clickable.
 *
 * The avatar is the installed tab's own tile (`.skc_cardIcon` + `avatar.js`): the container
 * keeps the host's border, radius and 48px box, unchanged. When the upstream item carries a
 * real icon it is drawn inside that box and the letter is only what is left when there is
 * none - see `MarketIcon`.
 *
 * The three figures are always three slots, even when a source reports nothing: the slot is
 * a position in a fixed track, so the same column lands on the same x in every card of a
 * row. A slot with no value draws nothing at all (no icon, no zero) and is hidden from
 * screen readers; when all three are empty the line is dropped.
 */
import { Button, StateDot } from '@deepseek-ai/dsh-client-ui-primitives';

import { tileElement, useIconState } from './icon-tile.jsx';
import { SourceMark, StatMark } from './market-marks.jsx';
import { cn } from './styles.js';
import {
  iconUrlOf,
  installViewOf,
  marketKeyOf,
  metaSegments,
  sourceLabelOf,
  statSegments,
} from './market-model.js';

/** The action's own label per state; `installing` draws its own seat above. */
const VIEW_LABELS = {
  ready: 'market.install',
  installed: 'market.installed',
  failed: 'market.retryInstall',
};

/**
 * The install seat: one of four states, never a fifth.
 * @param {{item: object, market: object, t: Function, size?: string, className?: string,
 *   onInstall: Function}} props - the item, the market state, translate, button size,
 *   extra class, and the install handler.
 * @returns {import('react').ReactElement} the action.
 */
export function InstallAction({ item, market, t, size = 'sm', className, onInstall }) {
  const view = installViewOf(market, marketKeyOf(item));
  const name = item.displayName || item.slug || '';
  if (view.state === 'installing') {
    return (
      <span className={cn('bundleToggle')}>
        <span className={cn('toggleProgress')} role="status">
          <span className={cn('progressAnnouncement')}>{t('market.installStarted', { name })}</span>
          <StateDot state="ongoing" />
        </span>
        <Button variant="outline" size={size} className={className} disabled>
          {t('market.installing')}
        </Button>
      </span>
    );
  }
  const installed = view.state === 'installed';
  return (
    <Button
      variant={installed ? 'ghost' : 'outline'}
      size={size}
      className={className}
      disabled={installed}
      title={installed && view.path !== '' ? t('market.installedTitle', { path: view.path }) : undefined}
      onClick={installed ? undefined : () => onInstall(item)}
    >
      {t(VIEW_LABELS[view.state])}
    </Button>
  );
}

/**
 * The market's avatar tile: the shared tile, with the URL resolved from the item.
 *
 * It calls `tileElement` / `useIconState` instead of rendering `<IconTile/>` so that a
 * caller looking at this component's own output sees the tile itself, not a component
 * element - the drawing and the failure state still have exactly one implementation.
 * @param {{item: object, title: string, market: object, className?: string}} props - the
 *   market item, its display title, the market state (for progressively fetched icons),
 *   and an extra class for the box.
 * @returns {import('react').ReactElement} the tile.
 */
export function MarketIcon({ item, title, market, className }) {
  const iconUrl = iconUrlOf(item, market);
  return tileElement({ iconUrl, title, className }, useIconState(iconUrl));
}

/**
 * Render one card of the market grid.
 * @param {{item: object, market: object, t: Function, onOpen: Function, onInstall: Function}} props
 *   the market item, the market state, translate, and the two handlers.
 * @returns {import('react').ReactElement} the card.
 */
export function MarketCard({ item, market, t, onOpen, onInstall }) {
  const key = marketKeyOf(item);
  const title = item.displayName || item.slug || '';
  const segments = metaSegments(item);
  const stats = statSegments(item);
  // One defensive read: the normalization rules (cap, dedupe, truncation) live in the Host
  // and are not copied here.
  const tags = Array.isArray(item.tags) ? item.tags : [];
  const view = installViewOf(market, key);
  const source = sourceLabelOf(item.sourceId, t);
  return (
    <li className={cn('marketCard')} data-skc-market-id={key}>
      <div className={cn('marketHead')}>
        <MarketIcon item={item} title={title} market={market} />
        <div className={cn('marketMain')}>
          <div className={cn('marketTitleRow')}>
            <button
              type="button"
              className={cn('marketCardOpen')}
              aria-label={t('market.cardOpen', { name: title })}
              title={title}
              onClick={() => onOpen(item)}
            >
              {title}
            </button>
            <SourceMark sourceId={item.sourceId} label={source} />
          </div>
          {segments.length === 0 ? null : (
            <p className={cn('marketMeta')}>
              {segments.map((segment, index) => (
                <span key={segment.key}>
                  {index === 0 ? null : ' · '}
                  {t(segment.key, { [segment.param]: segment.value })}
                </span>
              ))}
            </p>
          )}
        </div>
        <div className={cn('marketCardEnd')}>
          <InstallAction item={item} market={market} t={t} onInstall={onInstall} />
        </div>
      </div>
      <div className={cn('marketBody')}>
        {typeof item.summary === 'string' && item.summary !== ''
          ? <p className={cn('marketDesc')}>{item.summary}</p>
          : null}
        {tags.length === 0 ? null : (
          <ul className={cn('marketTags')}>
            {tags.map((tag) => <li key={tag} className={cn('marketTag')} title={tag}>{tag}</li>)}
          </ul>
        )}
        {stats.every((slot) => slot.present === false) ? null : (
          <p className={cn('marketStats')}>
            {stats.map((slot) => (slot.present
              ? (
                <span
                  key={slot.slot}
                  className={cn('marketStat')}
                  role="img"
                  aria-label={t(slot.labelKey, { [slot.param]: slot.value })}
                  title={slot.slot === 'rating'
                    ? t('market.metaRatingHint')
                    : t(slot.labelKey, { [slot.param]: slot.value })}
                >
                  <StatMark slot={slot.slot} />
                  <span className={cn('marketStatValue')}>{slot.value}</span>
                </span>
              )
              : <span key={slot.slot} className={cn('marketStat')} aria-hidden="true" />))}
          </p>
        )}
      </div>
      {view.state === 'failed' && view.reason !== ''
        ? <p className={cn('reason')} role="alert">{view.reason}</p>
        : null}
    </li>
  );
}
