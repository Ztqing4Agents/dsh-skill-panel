/**
 * The avatar slot: an upstream icon when there is one, the letter tile when there is not.
 *
 * This is the only place that knows how a tile is drawn, and it is split in two so that
 * both entry points can share it without one being a wrapper around the other:
 *
 *   - `tileElement()` is a plain function with no hooks - it returns the element for one
 *     render and never holds state, so a caller may invoke it from its own fiber;
 *   - `useIconFailure()` owns the one piece of state a tile has: which URL failed to load.
 *
 * `IconTile` is the component form. `MarketIcon` (market-card.jsx) resolves a URL from a
 * market item and then calls the same two pieces - it deliberately does not render
 * `<IconTile/>`, because that would put a component between a caller and the tile's DOM
 * and change nothing visually while making the tile harder to inspect.
 *
 * The container is the host's own `.skc_cardIcon` (48x48, .5px hairline, 16px radius,
 * padding-box background). Nothing here changes it: the image is a flex child that fills
 * the *content* box, which is what keeps the hairline painted on top of it.
 *
 * A failed load is remembered per URL and never retried: a tile that flickers between
 * image and letter is worse than a letter. `alt=""` plus `aria-hidden` on the box because
 * the name is always rendered next to it - the tile is decoration.
 *
 * No `onClick`, no link, no `tabIndex`: a tile is never a click target (the installed row
 * owns exactly one control, its switch; the market card's click layer is its own thing).
 */
import { useState } from 'react';

import { avatarOf } from './avatar.js';
import { cn } from './styles.js';

/**
 * The tile's markup for one render. No hooks, no state: safe to call from any component.
 * @param {{iconUrl?: string|null, title?: string, className?: string}} props - the image
 *   URL (null when there is none), the name whose initial and colours the tile uses, and
 *   an optional extra class for the box.
 * @param {boolean} showIcon - whether to draw the image this render.
 * @param {Function} onError - called when the image fails to load.
 * @returns {import('react').ReactElement} the tile.
 */
export function tileElement({ iconUrl = null, title = '', className }, showIcon, onError) {
  const avatar = avatarOf(title);
  return (
    <span
      className={cn('cardIcon', className)}
      style={{ '--skc-avatar-bg': avatar.bg, '--skc-avatar-ink': avatar.ink }}
      aria-hidden="true"
    >
      {showIcon ? (
        <img
          className={cn('marketIconImg')}
          src={iconUrl}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={onError}
        />
      ) : avatar.letter}
    </span>
  );
}

/**
 * The tile's only state: which URL failed. Keyed by URL, so a different skill's icon gets
 * its own chance to load instead of inheriting a neighbour's failure.
 * @param {string|null} iconUrl - the URL this render would draw.
 * @returns {{showIcon: boolean, onError: Function}} whether to draw it, and the handler.
 */
export function useIconFailure(iconUrl) {
  const [failedUrl, setFailedUrl] = useState(null);
  const showIcon = typeof iconUrl === 'string' && iconUrl !== '' && failedUrl !== iconUrl;
  return { showIcon, onError: () => setFailedUrl(iconUrl) };
}

/**
 * Render one avatar tile.
 * @param {{iconUrl?: string|null, title?: string, className?: string}} props - the image
 *   URL (null when there is none), the name whose initial and colours the tile uses, and
 *   an optional extra class for the box.
 * @returns {import('react').ReactElement} the tile.
 */
export function IconTile({ iconUrl = null, title = '', className }) {
  const { showIcon, onError } = useIconFailure(iconUrl);
  return tileElement({ iconUrl, title, className }, showIcon, onError);
}
