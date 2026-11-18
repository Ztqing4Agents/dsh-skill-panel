/**
 * A stand-in for `@deepseek-ai/dsh-client-ui-primitives` inside node.
 *
 * The real package is a browser-seed module: outside the GUI its imports
 * (`clsx`, `simple-icons`, `shiki`, `*.module.css`) do not resolve, so a node
 * test cannot load it. This stub is a faithful transcription of the parts the
 * panel uses, read out of
 * `node_modules/@deepseek-ai/dsh-client-ui-primitives/lib/index.js`:
 *
 *   Switch          button[role=switch][aria-checked][aria-label][title][disabled]
 *   SegmentedTabs   div[role=tablist][aria-label] + button[role=tab][aria-selected]
 *   Button          button[type=button] with `icon` wrapped in a span
 *   Tooltip         renders its child (the bubble only exists after measuring)
 *   Toast           div[role=alert] with the localized text
 *   StateDot        an svg/span carrying `data-state`
 *   Icon*           an svg carrying `data-icon` and the requested size
 *   Tag             span[data-tone] wrapping its children
 *   Pill            span when inert, button[type=button][data-active] when clickable
 *   Input           span wrapping an optional icon slot plus a real `input`
 *   Menu            span wrapping the anchor, plus a [role=menu] list when open
 *                   (`items` rows and/or `children` component rows, `listClassName` on the card)
 *   MenuItemButton  div.itemWrap > button[role=menuitem][disabled] > span(icon) + span(label)
 *   Modal           div[role=dialog][aria-modal][aria-label] with title/body/footer
 *   MarkdownText    div carrying the raw text (no markdown pipeline in node)
 *   fileSizeText    the host's byte-count formatter, transcribed verbatim
 *   PluginArtworkDefault
 *                   svg[data-artwork=plugin-default] with the host's own path geometry,
 *                   default `size` 36, fixed `#54ECE7 -> #658EFF` gradient (never
 *                   `currentColor`); the host's figure for a package head with no icon
 *
 * Anything the panel imports has to exist here first: a missing export fails the whole
 * L3 batch with `No matching export`, not just the case that needed it. The pieces that
 * turn that on are `MenuItemButton`, the two icons U22 added
 * (`IconDownloadOutlineRegular` / `IconAgentPresetOutlineRegular`), and `Menu` in its
 * children form — the add menu passes `children` rows plus `listClassName` on the card,
 * so a stub that only accepted an `items` array would paint an empty menu instead of
 * failing loudly.
 *
 * Two deviations from the real package are deliberate and required by SSR:
 * `Modal` renders in place instead of through `createPortal(document.body)`, and
 * `Menu` never portals. Everything else is shape-faithful: this stub proves
 * *structure and prop wiring*, not that the host paints the same pixels.
 * Geometry, dark mode and docking stay in the real-machine checklist.
 */
import { jsx, jsxs } from 'react/jsx-runtime';

/**
 * Render a host-shaped button.
 * @param {object} props - host Button props.
 * @returns {import('react').ReactElement} the button.
 */
export function Button({ variant, size, icon, className, children, ...rest }) {
  return jsxs('button', {
    type: 'button',
    className,
    ...rest,
    children: [
      // The host renders the icon node itself inside a span (`Button.icon`); keeping the
      // node (rather than a placeholder) is what lets a test assert which icon a state
      // picked - e.g. refresh vs a progress dot.
      icon === undefined || icon === null ? null : jsx('span', { className: 'stub_icon', children: icon }),
      children,
    ],
  });
}

/**
 * Render a host-shaped switch.
 * @param {object} props - host Switch props.
 * @returns {import('react').ReactElement} the switch.
 */
export function Switch({ checked, onChange, label, disabled = false, title, className }) {
  return jsx('button', {
    type: 'button',
    role: 'switch',
    'aria-checked': checked,
    'aria-label': label,
    title,
    disabled,
    className,
    onClick: () => onChange(!checked),
    children: jsx('span', { className: 'stub_thumb' }),
  });
}

/**
 * Render a host-shaped segmented tab list.
 * @param {object} props - host SegmentedTabs props.
 * @returns {import('react').ReactElement} the tab list.
 */
export function SegmentedTabs({ items, value, onChange, label, className }) {
  return jsxs('div', {
    role: 'tablist',
    'aria-label': label,
    className,
    children: items.map((item) => jsx('button', {
      type: 'button',
      role: 'tab',
      id: item.id,
      'aria-selected': value === item.value,
      'aria-controls': item.panelId,
      onClick: () => onChange(item.value),
      children: item.label,
    }, item.value)),
  });
}

/**
 * Render a host-shaped state dot.
 * @param {{state?: string, size?: number}} props - dot state.
 * @returns {import('react').ReactElement} the dot.
 */
export function StateDot({ state = 'idle', size }) {
  return jsx('svg', { 'data-state': state, 'data-size': size, 'aria-hidden': 'true' });
}

/**
 * Render a host-shaped tooltip: SSR sees only the anchor.
 * @param {object} props - host Tooltip props.
 * @returns {import('react').ReactNode} the anchor.
 */
export function Tooltip({ label, children }) {
  return children;
}

/**
 * Render a host-shaped toast.
 * @param {{text?: string, icon?: unknown}} props - toast content.
 * @returns {import('react').ReactElement} the toast.
 */
export function Toast({ text, icon }) {
  return jsx('div', { role: 'alert', className: 'stub_toast', children: text });
}

/**
 * Render a host-shaped tag.
 * @param {{tone?: string, className?: string, children?: unknown}} props - tag props.
 * @returns {import('react').ReactElement} the tag.
 */
export function Tag({ tone = 'outline', className, children }) {
  return jsx('span', { className, 'data-tone': tone, children });
}

/**
 * Render a host-shaped pill: a button only when it can be pressed.
 *
 * The real component picks its element by the presence of `onClick`, which matters
 * here: a clickable chip must be reachable by keyboard, an inert one must not be a
 * button at all.
 * @param {{active?: boolean, className?: string, children?: unknown, onClick?: Function}} props - pill props.
 * @returns {import('react').ReactElement} the pill.
 */
export function Pill({ active = false, className, children, onClick, ...rest }) {
  if (typeof onClick !== 'function') {
    return jsx('span', { className, 'data-active': active, children });
  }
  return jsx('button', {
    type: 'button',
    className,
    'data-active': active,
    onClick,
    ...rest,
    children,
  });
}

/**
 * Render a host-shaped input: the wrapper, the icon slot, and the real field.
 * @param {{icon?: unknown, className?: string, type?: string, placeholder?: string,
 *   value?: string, name?: string}} props - input props.
 * @returns {import('react').ReactElement} the wrapper.
 */
export function Input({ icon, className, ...rest }) {
  return jsxs('span', {
    className,
    children: [
      icon === undefined || icon === null ? null : jsx('span', { className: 'stub_inputIcon', children: icon }),
      jsx('input', rest),
    ],
  });
}

/**
 * Render a host-shaped menu: the anchor always, the rows when it is open.
 *
 * `portal` is ignored on purpose - a portal needs `document.body`, and these tests
 * render to a string. The row shape (`button[role=menuitem]` carrying `data-menu-id`)
 * is what the assertions read.
 * @param {{open?: boolean, anchor?: unknown, items?: object[], selectedId?: string,
 *   onSelect?: Function, onClose?: Function, className?: string}} props - menu props.
 * @returns {import('react').ReactElement} the menu root.
 */
export function Menu({
  open, anchor, items = [], children, selectedId, onSelect, className, listClassName,
}) {
  const rows = items.filter((item) => typeof item?.id === 'string' && item?.label !== undefined);
  // The host renders its `items` data rows and its `children` component rows into the same
  // list; `listClassName` is the only hook that reaches a portaled card, so a page that
  // styles the dropdown has to pass it here.
  return jsxs('span', {
    className,
    children: [
      anchor,
      open === true
        ? jsx('div', {
          role: 'menu',
          className: listClassName === undefined ? 'stub_menu' : `stub_menu ${listClassName}`,
          children: [
            ...rows.map((item) => jsx('button', {
              type: 'button',
              role: 'menuitem',
              'data-menu-id': item.id,
              'aria-current': item.id === selectedId ? 'true' : undefined,
              onClick: () => onSelect?.(item.id),
              children: item.label,
            }, item.id)),
            children ?? null,
          ],
        })
        : null,
    ],
  });
}

/**
 * Render one host-shaped `role="menuitem"` row (the component-row flavour of `Menu`).
 *
 * Transcribed from the host's `MenuItemButton`: the row is a `button[role=menuitem]`
 * wrapped in a `div`, the icon gets its own span, and `onSelect` is the row's own click -
 * closing the menu stays the owner's decision.
 * @param {{children?: unknown, shortcut?: object, icon?: unknown, disabled?: boolean,
 *   danger?: boolean, separatorBefore?: boolean, onSelect?: Function}} props - row props.
 * @returns {import('react').ReactElement} the row.
 */
export function MenuItemButton({
  children, shortcut, icon, disabled = false, danger = false, separatorBefore = false, onSelect,
}) {
  return jsxs('div', {
    className: 'stub_menuItemWrap',
    children: [
      separatorBefore ? jsx('div', { role: 'separator' }) : null,
      jsxs('button', {
        type: 'button',
        role: 'menuitem',
        className: danger ? 'stub_menuItem stub_danger' : 'stub_menuItem',
        disabled,
        'aria-keyshortcuts': shortcut?.aria,
        onClick: onSelect,
        children: [
          icon === undefined || icon === null ? null : jsx('span', { className: 'stub_menuItemIcon', children: icon }),
          jsx('span', { className: 'stub_menuItemLabel', children }),
          shortcut === undefined ? null : jsx('span', { 'aria-hidden': 'true', className: 'stub_shortcut' }),
        ],
      }),
    ],
  });
}

/**
 * Render a host-shaped modal.
 *
 * Deviates from the host in exactly one way: no `createPortal`, because a string
 * render has no `document.body`. The dialog semantics (`role`, `aria-modal`,
 * `aria-label`) are the host's own, so structure assertions transfer.
 * @param {{open?: boolean, onClose?: Function, title?: string, closeLabel?: string,
 *   children?: unknown, footer?: unknown, className?: string}} props - modal props.
 * @returns {import('react').ReactElement|null} the dialog, or null when closed.
 */
export function Modal({ open, onClose, title, closeLabel, children, footer, className }) {
  if (!open) return null;
  return jsxs('div', {
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': title,
    className,
    children: [
      jsxs('div', {
        className: 'stub_modalHead',
        children: [
          jsx('h2', { children: title }),
          jsx('button', { type: 'button', 'aria-label': closeLabel, onClick: onClose, children: 'x' }),
        ],
      }),
      children === undefined ? null : jsx('div', { className: 'stub_modalBody', children }),
      footer === undefined ? null : jsx('div', { className: 'stub_modalFooter', children: footer }),
    ],
  });
}

/**
 * Render third-party markdown as its own text.
 *
 * The host runs a real markdown pipeline; node cannot (shiki, CSS modules). Keeping
 * the text verbatim inside one wrapper is enough to assert *that* the overview
 * reached the renderer, which is the only thing the panel is responsible for.
 * @param {{text?: string, variant?: string}} props - markdown props.
 * @returns {import('react').ReactElement} the text block.
 */
export function MarkdownText({ text, variant = 'body' }) {
  return jsx('div', { 'data-stub-markdown': variant, children: text ?? '' });
}

/**
 * Byte count as compact text; transcribed from the host helper, GB branch included.
 * @param {number} bytes - byte count.
 * @returns {string} the display text.
 */
export function fileSizeText(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)}KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)}MB`;
  const gb = mb / 1024;
  return `${gb < 10 ? gb.toFixed(1) : Math.round(gb)}GB`;
}

/**
 * The host artwork's path, verbatim from the real package (see `PluginArtworkDefault` below).
 */
const PLUGIN_ARTWORK_DEFAULT_PATH = 'M24.6294 8.63696C26.2862 8.63705 27.6294 9.98016 27.6294 11.637V12.7825C27.6292 14.4391 26.2861 15.7824 24.6294 15.7825H23.4839C22.6519 15.7825 21.5454 16.3459 21.5454 17.1778V18.1573C21.5454 18.7757 22.216 19.1966 22.8345 19.1965H24.6294C26.2861 19.1965 27.6292 20.5398 27.6294 22.1965V23.9924C27.6292 25.6491 26.2861 26.9924 24.6294 26.9924H22.8345C21.1778 26.9924 19.8347 25.649 19.8345 23.9924V22.1965C19.8345 21.7148 19.4957 21.2327 19.014 21.2327H16.4792C15.7975 21.2327 15.3374 22.0061 15.3374 22.6877V23.8333C15.3373 25.49 13.9942 26.8333 12.3374 26.8333H11.1919C9.53509 26.8333 8.19198 25.49 8.19189 23.8333V22.6877C8.19189 21.0309 9.53504 19.6877 11.1919 19.6877H12.3374C13.1964 19.6877 14.3999 19.0959 14.3999 18.2369V16.0185C14.3999 14.9518 15.2646 14.0872 16.3312 14.0872H19.435C20.0596 14.0872 20.484 13.4071 20.4839 12.7825V11.637C20.4839 9.98011 21.827 8.63696 23.4839 8.63696H24.6294ZM13.4116 11.2468C13.4116 12.6882 12.2431 13.8567 10.8018 13.8567C9.36037 13.8567 8.19189 12.6882 8.19189 11.2468C8.19189 9.80544 9.36037 8.63696 10.8018 8.63696C12.2431 8.63696 13.4116 9.80544 13.4116 11.2468Z';

/**
 * The host's default package artwork, i.e. the figure the host draws for a plugin that ships
 * no icon of its own (and for one whose icon fails to decode).
 *
 * Transcribed from `lib/index.js` of the real package, the block starting
 * `const PluginArtworkDefault = ({ size = 36, className }) => {` and ending with its
 * `linearGradient` `defs`: same `viewBox="0 0 36 36"`, same `path` `d` (copied verbatim),
 * same fixed two-stop gradient `#54ECE7 -> #658EFF` at `y1 9.94188 / y2 13.6375` on the
 * `x 15.1481` axis. Geometry and palette are the host's, so a test that reads this stub is
 * reading the host's drawing, not our imitation of it.
 *
 * Two deliberate deviations, both required by a string render: the gradient id is a constant
 * instead of `useArtworkId()`'s per-instance id (no document in node, so nothing to collide
 * with), and `data-artwork="plugin-default"` is added as a stable hook so an assertion can
 * say "this is the host's package figure" without matching raw path data. `size` still
 * defaults to 36 and still drives `width`/`height`, which is what the panel's 36px seat
 * depends on.
 * @param {{size?: number, className?: string}} props - the square edge and the class.
 * @returns {import('react').ReactElement} the svg.
 */
export function PluginArtworkDefault({ size = 36, className }) {
  return jsxs('svg', {
    'data-artwork': 'plugin-default',
    width: size,
    height: size,
    className,
    viewBox: '0 0 36 36',
    fill: 'none',
    xmlns: 'http://www.w3.org/2000/svg',
    children: [
      jsx('path', { d: PLUGIN_ARTWORK_DEFAULT_PATH, fill: 'url(#stub-plugin-artwork-a)' }),
      jsx('defs', {
        children: jsxs('linearGradient', {
          id: 'stub-plugin-artwork-a',
          x1: '15.1481',
          y1: '9.94188',
          x2: '15.1481',
          y2: '13.6375',
          gradientUnits: 'userSpaceOnUse',
          children: [
            jsx('stop', { stopColor: '#54ECE7' }),
            jsx('stop', { offset: '1', stopColor: '#658EFF' }),
          ],
        }),
      }),
    ],
  });
}

/**
 * Build one icon component.
 * @param {string} name - icon id used by the assertions.
 * @returns {Function} the icon component.
 */
function iconOf(name) {
  return function Icon({ size, ...rest }) {
    return jsx('svg', { 'data-icon': name, width: size, height: size, ...rest });
  };
}

export const IconSkillOutlineRegular = iconOf('skill');
export const IconLinkOutlineRegular = iconOf('link');
export const IconInfoOutlineRegular = iconOf('info');
export const IconRefreshOutlineRegular = iconOf('refresh');
export const IconPlusOutlineRegular = iconOf('plus');
export const IconChevronDownOutlineRegular = iconOf('chevron');
export const IconWarningOutlineRegular = iconOf('warning');
export const IconSearchOutlineRegular = iconOf('search');
export const IconCloseOutlineRegular = iconOf('close');
export const IconTrashOutlineRegular = iconOf('trash');
export const IconCopyOutlineRegular = iconOf('copy');
export const IconDownloadOutlineRegular = iconOf('download');
export const IconAgentPresetOutlineRegular = iconOf('agent-preset');
export const IconCheckOutlineRegular = iconOf('check');
