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
 *   Modal           div[role=dialog][aria-modal][aria-label] with title/body/footer
 *   MarkdownText    div carrying the raw text (no markdown pipeline in node)
 *   fileSizeText    the host's byte-count formatter, transcribed verbatim
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
export function Menu({ open, anchor, items = [], selectedId, onSelect, className }) {
  const rows = items.filter((item) => typeof item?.id === 'string' && item?.label !== undefined);
  return jsxs('span', {
    className,
    children: [
      anchor,
      open === true
        ? jsx('div', {
          role: 'menu',
          className: 'stub_menu',
          children: rows.map((item) => jsx('button', {
            type: 'button',
            role: 'menuitem',
            'data-menu-id': item.id,
            'aria-current': item.id === selectedId ? 'true' : undefined,
            onClick: () => onSelect?.(item.id),
            children: item.label,
          }, item.id)),
        })
        : null,
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
export const IconCheckOutlineRegular = iconOf('check');
