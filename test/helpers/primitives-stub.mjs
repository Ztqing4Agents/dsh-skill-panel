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
 *
 * Consequence for the report: the L3 tests prove *structure and prop wiring*
 * through this contract, not that the host paints the same pixels. Geometry,
 * dark mode and docking stay in the real-machine checklist.
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
      icon === undefined || icon === null ? null : jsx('span', { className: 'stub_icon' }, 'icon'),
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
