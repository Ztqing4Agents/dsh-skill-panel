/**
 * One market card: letter avatar, title as the click target, source badge, one-line
 * summary, meta line, and the install action.
 *
 * Clickability has exactly one mechanism, copied from the host's own market card:
 * the title button's `::after` covers the whole card (`inset: 0`), and the action's
 * seat carries `z-index: 1` so the button floats above that layer. Nothing here is an
 * `<a href>`, and the card itself is not a button - a card that looks clickable in two
 * ways is a card whose clicks land somewhere unexpected.
 *
 * The avatar is the installed tab's own tile (`.skc_cardIcon` + `avatar.js`): the
 * container keeps the host's border, radius and 48px box, unchanged. When the upstream
 * item carries a real icon it is drawn inside that box and the letter is only what is
 * left when there is none - see `MarketIcon`.
 */
import { Button, StateDot, Tag } from '@deepseek-ai/dsh-client-ui-primitives';

import { tileElement, useIconFailure } from './icon-tile.jsx';
import { cn } from './styles.js';
import { iconUrlOf, installViewOf, marketKeyOf, metaSegments, sourceLabelOf } from './market-model.js';

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
 * It calls `tileElement` / `useIconFailure` instead of rendering `<IconTile/>` so that a
 * caller looking at this component's own output sees the tile itself, not a component
 * element - the drawing and the failure state still have exactly one implementation.
 * @param {{item: object, title: string, market: object, className?: string}} props - the
 *   market item, its display title, the market state (for progressively fetched icons),
 *   and an extra class for the box.
 * @returns {import('react').ReactElement} the tile.
 */
export function MarketIcon({ item, title, market, className }) {
  const iconUrl = iconUrlOf(item, market);
  const { showIcon, onError } = useIconFailure(iconUrl);
  return tileElement({ iconUrl, title, className }, showIcon, onError);
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
  const view = installViewOf(market, key);
  const source = sourceLabelOf(item.sourceId, t);
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
          <Tag>{source}</Tag>
        </div>
        {typeof item.summary === 'string' && item.summary !== ''
          ? <p className={cn('marketDesc')}>{item.summary}</p>
          : null}
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
      {view.state === 'failed' && view.reason !== ''
        ? <p className={cn('reason')} role="alert">{view.reason}</p>
        : null}
    </li>
  );
}
