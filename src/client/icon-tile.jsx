/**
 * The avatar slot: an upstream icon when there is one, the letter tile when there is not.
 *
 * This is the only place that knows how a tile is drawn, and it is split in two so that
 * both entry points can share it without one being a wrapper around the other:
 *
 *   - `tileElement()` is a plain function with no hooks - it returns the element for one
 *     render and never holds state, so a caller may invoke it from its own fiber;
 *   - `useIconState()` owns the two pieces of state a tile has: which URL failed and which
 *     URL finished loading.
 *
 * `IconTile` is the component form. `MarketIcon` (market-card.jsx) resolves a URL from a
 * market item and then calls the same two pieces - it deliberately does not render
 * `<IconTile/>`, because that would put a component between a caller and the tile's DOM
 * and change nothing visually while making the tile harder to inspect.
 *
 * **The tile is never empty.** An `<img>` only appears once its bytes are in; until then
 * the letter stays exactly where it is, and a hidden probe image (same URL, `eager`,
 * `display:none`) does the loading. Without the probe the order was "letter disappears →
 * blank tile → icon", and a 1024x1024 icon over a slow link left a hole in the list for
 * hundreds of milliseconds. Measured in this Chromium: a `display:none` image with
 * `loading="eager"` does request and fire `onload` (a `loading="lazy"` one never does), and
 * the visible image that follows reuses the decoded bitmap - one network request in total.
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
 * @param {{showIcon: boolean, probe: string|null, onLoad: Function, onError: Function}} state
 *   whether the image is ready, the URL still being probed (null when there is none), and
 *   the two image handlers.
 * @returns {import('react').ReactElement} the tile.
 */
export function tileElement({ iconUrl = null, title = '', className }, state) {
  const avatar = avatarOf(title);
  return (
    <span
      className={cn('cardIcon', className)}
      style={{ '--skc-avatar-bg': avatar.bg, '--skc-avatar-ink': avatar.ink }}
      aria-hidden="true"
    >
      {state.probe === null ? null : (
        <img
          src={state.probe}
          alt=""
          loading="eager"
          decoding="async"
          referrerPolicy="no-referrer"
          style={{ display: 'none' }}
          onLoad={state.onLoad}
          onError={state.onError}
        />
      )}
      {state.showIcon ? (
        <img
          className={cn('marketIconImg')}
          src={iconUrl}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={state.onLoad}
          onError={state.onError}
        />
      ) : avatar.letter}
    </span>
  );
}

/**
 * The tile's state: which URL failed, and which URL is decoded and ready to show.
 *
 * `showIcon` only becomes true once the image has actually loaded, so the letter is never
 * removed in favour of an empty box; `probe` is the URL that still needs loading, which
 * the caller renders as a hidden eager image.
 * @param {string|null} iconUrl - the URL this render would draw.
 * @returns {{showIcon: boolean, probe: string|null, onLoad: Function, onError: Function}}
 *   whether to draw the image, what to probe (or null), and the two handlers.
 */
export function useIconState(iconUrl) {
  const [failedUrl, setFailedUrl] = useState(null);
  const [loadedUrl, setLoadedUrl] = useState(null);
  const url = typeof iconUrl === 'string' && iconUrl !== '' ? iconUrl : null;
  const usable = url !== null && failedUrl !== url;
  return {
    showIcon: usable && loadedUrl === url,
    probe: usable && loadedUrl !== url ? url : null,
    onLoad: () => setLoadedUrl(url),
    onError: () => setFailedUrl(url),
  };
}

/**
 * Render one avatar tile.
 * @param {{iconUrl?: string|null, title?: string, className?: string}} props - the image
 *   URL (null when there is none), the name whose initial and colours the tile uses, and
 *   an optional extra class for the box.
 * @returns {import('react').ReactElement} the tile.
 */
export function IconTile({ iconUrl = null, title = '', className }) {
  return tileElement({ iconUrl, title, className }, useIconState(iconUrl));
}
