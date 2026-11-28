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

/** The action's own label per resting state; the two in-flight states draw their own seat. */
const VIEW_LABELS = {
  ready: 'market.install',
  installed: 'market.installed',
  latest: 'detail.upToDate',
  update: 'detail.update',
  failed: 'market.retryInstall',
};

/** The label of the disabled seat while a request is in flight, one per verb. */
const BUSY_LABELS = {
  installing: 'market.installing',
  updating: 'detail.updating',
};

/**
 * The install / update seat: one of seven states, never an eighth.
 *
 * Two of them are in flight, one is a verdict ("up to date"), two are resting and clickable
 * ("install", "update"), and the last is a failure that offers the request it came from. The
 * retry is not a plain re-send: it opens the dialog again, so the reader sees the versions
 * once more before a directory is replaced.
 * @param {{item: object, market: object, t: Function, size?: string, className?: string,
 *   onInstall: Function, onUpdate?: Function}} props - the item, the market state, translate,
 *   button size, extra class, and the install / update handlers.
 * @returns {import('react').ReactElement} the action.
 */
export function InstallAction({ item, market, t, size = 'sm', className, onInstall, onUpdate }) {
  const view = installViewOf(market, marketKeyOf(item), item);
  const name = item.displayName || item.slug || '';
  if (view.state === 'installing' || view.state === 'updating') {
    return (
      <span className={cn('bundleToggle')}>
        <span className={cn('toggleProgress')} role="status">
          {view.state === 'installing'
            ? <span className={cn('progressAnnouncement')}>{t('market.installStarted', { name })}</span>
            : null}
          <StateDot state="ongoing" />
        </span>
        <Button variant="outline" size={size} className={className} disabled>
          {t(BUSY_LABELS[view.state])}
        </Button>
      </span>
    );
  }
  const done = view.state === 'installed' || view.state === 'latest';
  // A failed update retries the update: installing over a directory that already exists is the
  // `E_ALREADY_INSTALLED` refusal, not a retry.
  const run = view.state === 'update' || view.mode === 'update' ? (onUpdate ?? onInstall) : onInstall;
  return (
    <Button
      variant={done ? 'ghost' : 'outline'}
      size={size}
      className={className}
      disabled={done}
      title={view.state === 'installed' && view.path !== '' ? t('market.installedTitle', { path: view.path }) : undefined}
      onClick={done ? undefined : () => run(item)}
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
 * @param {{item: object, market: object, t: Function, onOpen: Function, onInstall: Function,
 *   onUpdate: Function}} props - the market item, the market state, translate, and the three
 *   handlers.
 * @returns {import('react').ReactElement} the card.
 */
export function MarketCard({ item, market, t, onOpen, onInstall, onUpdate }) {
  const key = marketKeyOf(item);
  const title = item.displayName || item.slug || '';
  const segments = metaSegments(item);
  const stats = statSegments(item, market.locale);
  // One defensive read: the normalization rules (cap, dedupe, truncation) live in the Host
  // and are not copied here.
  const tags = Array.isArray(item.tags) ? item.tags : [];
  const view = installViewOf(market, key, item);
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
          <InstallAction item={item} market={market} t={t} onInstall={onInstall} onUpdate={onUpdate} />
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
