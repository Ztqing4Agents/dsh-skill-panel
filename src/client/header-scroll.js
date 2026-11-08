/**
 * The header's sticky behaviour: measure, then interpolate.
 *
 * A plain `position: sticky` cannot do what the host page does, because the header
 * changes its own layout as it docks: the intro line slides away, the tabs change
 * rows, and the buttons lose their labels. The host solves it by cloning the bar
 * into an inert copy, measuring both the resting and the compact layout there, and
 * then interpolating every part between the two measured positions while the scroll
 * offset runs.
 *
 * Measuring in the clone is what keeps the list's scroll range constant: the real
 * header keeps its resting footprint the whole time, and only painted copies move.
 *
 * `interpolateParts` is pure so the geometry can be tested without a browser.
 */

/** The parts of the header the scroll moves, in document order. */
const PARTS = ['title', 'intro', 'toolbar', 'tabs'];

/**
 * @typedef {Object} PartGeometry
 * @property {{x: number, y: number, width: number}} from resting position
 * @property {{x: number, y: number, width: number}} to   compact position
 * @property {number} distance scroll distance this part travels over
 * @property {number} [clipStart] first offset at which the part is clipped away
 * @property {number} [clipEnd] offset at which the part is fully clipped
 */

/**
 * @typedef {Object} Frame
 * @property {string} translate CSS translate value
 * @property {string} width CSS width value
 * @property {string|null} clipPath CSS clip-path value, or null to clear it
 * @property {boolean} inert whether the part is no longer interactive
 */

/**
 * Interpolate every header part for one scroll offset.
 *
 * Pure: no DOM, no clock. `offset` is clamped at zero, so an elastic overscroll
 * cannot push parts past their resting position.
 * @param {PartGeometry[]} parts - measured geometries.
 * @param {number} offset - scroll offset of the page body, in pixels.
 * @returns {Frame[]} one frame per part, in the same order.
 */
export function interpolateParts(parts, offset) {
  const clamped = Number.isFinite(offset) && offset > 0 ? offset : 0;
  return parts.map((part) => {
    const distance = Math.max(1, part.distance);
    const progress = Math.min(1, clamped / distance);
    const translateX = (part.to.x - part.from.x) * progress;
    const translateY = (part.to.y - part.from.y) * progress;
    const width = part.from.width + (part.to.width - part.from.width) * progress;
    let clipPath = null;
    if (part.clipStart !== undefined && part.clipEnd !== undefined) {
      const span = Math.max(1, part.clipEnd - part.clipStart);
      const clip = Math.max(0, Math.min(1, (clamped - part.clipStart) / span));
      clipPath = `inset(${clip * 100}% 0 0)`;
    }
    const inert = part.clipEnd !== undefined && clamped >= part.clipEnd;
    return {
      translate: `${translateX}px ${translateY}px`,
      width: `${width}px`,
      clipPath,
      inert,
    };
  });
}

/**
 * Measure both layouts in an inert clone.
 * @param {HTMLElement} bar - the live page bar.
 * @returns {{height: number, compactHeight: number, boxes: Map<string, {x: number, y: number, width: number, height: number}>,
 *   compactBoxes: Map<string, {x: number, y: number, width: number, height: number}>}|null} the measurements.
 */
function measure(bar) {
  const body = bar.parentElement;
  if (body === null) return null;
  const clone = /** @type {HTMLElement} */ (bar.cloneNode(true));
  clone.removeAttribute('data-natural');
  clone.removeAttribute('data-compact');
  clone.removeAttribute('data-scrolled');
  clone.setAttribute('data-measuring', '');
  clone.setAttribute('aria-hidden', 'true');
  clone.style.width = `${bar.getBoundingClientRect().width}px`;
  for (const element of clone.querySelectorAll('[id], [data-skc-header-part]')) {
    element.removeAttribute('id');
    if (element.hasAttribute('data-skc-header-part')) element.removeAttribute('style');
  }
  body.append(clone);
  const snapshot = () => {
    const head = clone.querySelector('header');
    if (head === null) return { height: clone.getBoundingClientRect().height, boxes: new Map() };
    const headBox = head.getBoundingClientRect();
    const boxes = new Map();
    for (const name of PARTS) {
      const element = clone.querySelector(`[data-skc-header-part="${name}"]`);
      if (element === null) continue;
      const box = element.getBoundingClientRect();
      boxes.set(name, {
        x: box.x - headBox.x,
        y: box.y - headBox.y,
        width: box.width,
        height: box.height,
      });
    }
    return { height: clone.getBoundingClientRect().height, boxes };
  };
  let resting;
  let compact;
  try {
    resting = snapshot();
    clone.setAttribute('data-compact', '');
    compact = snapshot();
  } finally {
    clone.remove();
  }
  return {
    height: resting.height,
    compactHeight: compact.height,
    boxes: resting.boxes,
    compactBoxes: compact.boxes,
  };
}

/**
 * Attach the dock behaviour to one page bar.
 * @param {HTMLElement} bar - the live page bar.
 * @returns {() => void} disposer removing every observer and listener.
 */
export function attachHeader(bar) {
  const body = bar.parentElement;
  if (body === null) return () => {};
  const parts = [];
  const state = { distance: 1, restHeight: 0, compactHeight: 0, disposed: false };

  const scroll = () => {
    const offset = Math.max(0, body.scrollTop);
    bar.toggleAttribute('data-compact', offset >= state.distance);
    bar.toggleAttribute('data-scrolled', offset > 0);
    const frames = interpolateParts(parts, offset);
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      const frame = frames[index];
      part.element.style.translate = frame.translate;
      part.element.style.width = frame.width;
      if (frame.clipPath === null) part.element.style.removeProperty('clip-path');
      else part.element.style.clipPath = frame.clipPath;
      if (part.element.dataset.skcHeaderPart === 'intro') part.element.inert = frame.inert;
    }
    bar.style.setProperty('--skc-header-paint-height', `${Math.max(state.compactHeight, state.restHeight - offset)}px`);
  };

  const remeasure = () => {
    if (state.disposed) return;
    body.style.setProperty('--skc-page-scrollbar-width', `${body.offsetWidth - body.clientWidth}px`);
    const measured = measure(bar);
    if (measured === null) return;
    state.restHeight = measured.height;
    state.compactHeight = measured.compactHeight;
    state.distance = Math.max(1, state.restHeight - state.compactHeight);
    parts.length = 0;
    const hasTabs = measured.boxes.has('tabs');
    const compactTitle = measured.compactBoxes.get('title');
    for (const name of PARTS) {
      const from = measured.boxes.get(name);
      if (from === undefined) continue;
      const element = bar.querySelector(`[data-skc-header-part="${name}"]`);
      if (element === null) continue;
      let to = measured.compactBoxes.get(name);
      let clipStart;
      let clipEnd;
      if (name === 'intro' || (name === 'title' && hasTabs)) {
        to = { ...from, y: -from.height };
        if (name === 'intro' && !hasTabs && compactTitle !== undefined) {
          clipStart = Math.max(0, from.y - compactTitle.y - compactTitle.height);
          clipEnd = clipStart + from.height;
          to = { ...from, y: from.y - clipEnd };
        }
      }
      if (to === undefined) continue;
      const travel = Math.max(1, Math.abs(to.y - from.y));
      state.distance = Math.max(state.distance, travel);
      element.style.setProperty('--skc-part-x', `${from.x}px`);
      element.style.setProperty('--skc-part-y', `${from.y}px`);
      element.style.setProperty('--skc-part-width', `${from.width}px`);
      parts.push({
        element,
        from,
        to,
        distance: travel,
        clipStart,
        clipEnd,
      });
    }
    bar.style.setProperty('--skc-header-rest-height', `${state.restHeight}px`);
    bar.style.setProperty('--skc-header-compact-height', `${state.compactHeight}px`);
    bar.style.setProperty('--skc-header-travel', `${state.distance}px`);
    body.style.setProperty('--skc-header-scroll-padding', `${state.compactHeight + 8}px`);
    bar.setAttribute('data-natural', '');
    scroll();
  };

  remeasure();
  const head = bar.querySelector('header');
  const resize = new ResizeObserver(remeasure);
  resize.observe(body);
  const mutation = head === null ? null : new MutationObserver(remeasure);
  mutation?.observe(head, {
    childList: true,
    characterData: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['hidden'],
  });
  body.addEventListener('scroll', scroll, { passive: true });
  const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
  fonts?.addEventListener('loadingdone', remeasure);
  return () => {
    state.disposed = true;
    resize.disconnect();
    mutation?.disconnect();
    body.removeEventListener('scroll', scroll);
    fonts?.removeEventListener('loadingdone', remeasure);
    body.style.removeProperty('--skc-header-scroll-padding');
    body.style.removeProperty('--skc-page-scrollbar-width');
  };
}
