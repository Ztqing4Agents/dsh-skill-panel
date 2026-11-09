/**
 * One market card: avatar, title as the click target, the source's own brand mark, the
 * bookmark toggle, a two-line summary, the author line, three fixed figure slots, and
 * the install action.
 *
 * Clickability has exactly one mechanism, copied from the host's own market card:
 * the title button's `::after` covers the whole card (`inset: 0`), and the two action
 * seats carry their own z-index (`cardEnd` 1, `marketFavorite` 2) so they float above
 * that layer. Nothing here is an `<a href>`, and the card itself is not a button - a
 * card that looks clickable in two ways is a card whose clicks land somewhere
 * unexpected. The figure row deliberately has no z-index: it sits *under* the click
 * layer, so tapping a number is tapping blank space, which opens the detail view. That
 * is the one arrangement where nothing looks clickable without being clickable.
 *
 * The avatar is the installed tab's own tile (`.skc_cardIcon` + `avatar.js`): the
 * container keeps the host's border, radius and 48px box, unchanged. When the upstream
 * item carries a real icon it is drawn inside that box and the letter is only what is
 * left when there is none - see `MarketIcon`.
 *
 * The three figures are always three slots, even when a source reports nothing: the
 * slot is a position in a fixed track, so the same column lands on the same x in every
 * card of a row. A slot with no value draws nothing at all (no icon, no zero) and is
 * hidden from screen readers; when all three are empty the line is dropped.
 */
import { Button, StateDot } from '@deepseek-ai/dsh-client-ui-primitives';

import { tileElement, useIconState } from './icon-tile.jsx';
import { BookmarkMark, SourceMark, StatMark } from './market-marks.jsx';
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
 * The save button: the card's second and last action seat.
 *
 * `aria-pressed` is the only expression of the state - the filled bookmark is its
 * picture, not a second source of truth. The label changes with the state so a screen
 * reader hears what the click will do. The button is never disabled: two quick clicks
 * are two opposite intentions and the last one wins, while a disabled button would drop
 * the keyboard focus in the middle of the request.
 * @param {{item: object, saved: boolean, t: Function, onToggle: Function}} props - the item,
 *   whether this machine has it saved, translate, and the toggle handler.
 * @returns {import('react').ReactElement} the button.
 */
function FavoriteAction({ item, saved, t, onToggle }) {
  const title = item.displayName || item.slug || '';
  return (
    <button
      type="button"
      className={cn('marketFavorite', saved ? 'marketFavoriteOn' : null)}
      aria-pressed={saved}
      aria-label={t(saved ? 'market.unfavorite' : 'market.favorite', { name: title })}
      title={t(saved ? 'market.unfavoriteTitle' : 'market.favoriteTitle')}
      onClick={() => onToggle(item)}
    >
      <BookmarkMark filled={saved} />
    </button>
  );
}

/**
 * Render one card of the market grid.
 * @param {{item: object, market: object, t: Function, onOpen: Function, onInstall: Function,
 *   onToggleFavorite: Function}} props - the market item, the market state, translate, and
 *   the three handlers (open the detail view, install, save/unsave).
 * @returns {import('react').ReactElement} the card.
 */
export function MarketCard({ item, market, t, onOpen, onInstall, onToggleFavorite }) {
  const key = marketKeyOf(item);
  const title = item.displayName || item.slug || '';
  const segments = metaSegments(item);
  const stats = statSegments(item);
  const view = installViewOf(market, key);
  const source = sourceLabelOf(item.sourceId, t);
  const saved = market?.favorites?.[key] === true;
  return (
    <li className={cn('marketCard')} data-skc-market-id={key}>
      <div className={cn('marketMain')}>
        <div className={cn('marketTitleRow')}>
          <MarketIcon item={item} title={title} market={market} />
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
          <FavoriteAction item={item} saved={saved} t={t} onToggle={onToggleFavorite} />
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
        {typeof item.summary === 'string' && item.summary !== ''
          ? <p className={cn('marketDesc')}>{item.summary}</p>
          : null}
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
      <div className={cn('marketCardEnd')}>
        <InstallAction item={item} market={market} t={t} onInstall={onInstall} />
      </div>
      {view.state === 'failed' && view.reason !== ''
        ? <p className={cn('reason')} role="alert">{view.reason}</p>
        : null}
    </li>
  );
}
