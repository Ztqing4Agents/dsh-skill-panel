/**
 * One skill row: icon, name, description, and the one control the row owns.
 *
 * The icon is a letter avatar (`avatar.js`): the name's first letter on a pastel tile
 * whose colour is derived from the name, so rows are told apart before they are read.
 * It is decoration only - `aria-hidden`, because the name sits right next to it.
 *
 * The row opens the skill's detail view, and there is exactly one way that is allowed to
 * happen (hard constraint 9): the title is a button whose `::after` covers the whole row,
 * while the switch seat floats above it on its own layer. Nothing else in the row is
 * clickable, and the `<li>` itself stays a plain list item. A symlinked skill renders a
 * static read-only marker in the switch's seat instead of a switch, because this panel
 * never writes through a symlink - and the marker is not a control.
 */
import { StateDot, Switch, IconLinkOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives';

import { IconTile } from './icon-tile.jsx';
import { cn } from './styles.js';
import { isPending, rowKey, rowViewState, switchMode } from './model.js';

/**
 * The static marker a symlinked skill carries.
 * @param {{row: object, t: Function}} props - the row and the translate function.
 * @returns {import('react').ReactElement} the marker.
 */
export function ReadonlyTag({ row, t }) {
  return (
    <span className={cn('roTag')} title={t('row.symlinkTitle', { path: row.realPath ?? '' })}>
      <IconLinkOutlineRegular size={12} aria-hidden="true" />
      {t('row.symlinkReadonly')}
    </span>
  );
}

/**
 * The switch seat: a fixed-width progress slot plus the host Switch.
 * @param {{row: object, t: Function, pending: boolean, onToggle: Function}} props - row, translate, state, and handler.
 * @returns {import('react').ReactElement} the seat.
 */
export function EnableSwitch({ row, t, pending, onToggle }) {
  return (
    <span className={cn('bundleToggle')}>
      <span className={cn('toggleProgress')} role="status">
        <span className={cn('progressAnnouncement')}>
          {pending ? t('row.applying', { name: row.name }) : ''}
        </span>
        {pending ? <StateDot state="ongoing" /> : null}
      </span>
      <Switch
        checked={row.enabled}
        label={t('row.enable', { name: row.name })}
        title={t(row.enabled ? 'row.disable' : 'row.enable', { name: row.name })}
        disabled={pending}
        onChange={(next) => onToggle(row, next)}
      />
    </span>
  );
}

/**
 * Render one row of the list.
 * @param {{row: object, t: Function, rows: Map<string, object>, onToggle: Function,
 *   onOpen: Function, iconUrl?: string|null, title?: string}} props - the row, the
 *   translate function, per-row runtime state, the switch handler, the detail handler, the
 *   icon its `upstream` identity resolved to (null when it has no identity or no icon - the
 *   tile then draws the letter), and the visible title when the caller resolved one (see
 *   `rowTitleOf`).
 * @returns {import('react').ReactElement} the row.
 */
export function SkillRow({ row, t, rows, onToggle, onOpen, iconUrl = null, title }) {
  const key = rowKey(row);
  const view = rowViewState(row, rows);
  const reason = rows?.get?.(key)?.reason ?? null;
  const mode = switchMode(row);
  // Without a resolved title the row is exactly what it used to be: the kebab name in the
  // text, the local display name (if any) in the tooltip. The page always passes a title,
  // and then the tooltip carries the kebab name - the string the model is invoked by.
  const label = title ?? row.name;
  const tooltip = title === undefined ? (row.displayName ?? undefined) : row.name;
  const end = mode === null
    ? (row.readonlyReason === 'symlink' ? <ReadonlyTag row={row} t={t} /> : null)
    : <EnableSwitch row={row} t={t} pending={isPending(rows, key)} onToggle={onToggle} />;
  return (
    <li className={cn('card')} data-skc-row={key} data-skc-state={view}>
      <div className={cn('cardHead')}>
        <IconTile iconUrl={iconUrl} title={row.name} />
        <div className={cn('cardMain')}>
          <div className={cn('titleRow')}>
            <button
              type="button"
              className={cn('cardTitle', 'cardOpen')}
              title={tooltip}
              onClick={() => onOpen?.(row)}
            >
              {label}
            </button>
          </div>
          <span className={cn('cardDesc')} title={row.description}>{row.description}</span>
        </div>
        {end === null ? null : <div className={cn('cardEnd')}>{end}</div>}
      </div>
      {reason === null ? null : <p className={cn('reason')} role="alert">{reason}</p>}
    </li>
  );
}
