/**
 * One skill row: icon, name, description, and the one control the row owns.
 *
 * The icon is a letter avatar (`avatar.js`): the name's first letter on a pastel tile
 * whose colour is derived from the name, so rows are told apart before they are read.
 * It is decoration only - `aria-hidden`, because the name sits right next to it.
 *
 * The row itself is not clickable - there is no detail view in this version, and a
 * hover highlight on something that does not open anything is a lie about what a
 * click will do. A symlinked skill renders a static read-only marker in the switch's
 * seat instead of a switch, because this panel never writes through a symlink.
 */
import { StateDot, Switch, IconLinkOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives';

import { avatarOf } from './avatar.js';
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
 * @param {{row: object, t: Function, rows: Map<string, object>, onToggle: Function}} props
 *   the row, the translate function, per-row runtime state, and the switch handler.
 * @returns {import('react').ReactElement} the row.
 */
export function SkillRow({ row, t, rows, onToggle }) {
  const key = rowKey(row);
  const view = rowViewState(row, rows);
  const reason = rows?.get?.(key)?.reason ?? null;
  const avatar = avatarOf(row.name);
  const mode = switchMode(row);
  const end = mode === null
    ? (row.readonlyReason === 'symlink' ? <ReadonlyTag row={row} t={t} /> : null)
    : <EnableSwitch row={row} t={t} pending={isPending(rows, key)} onToggle={onToggle} />;
  return (
    <li className={cn('card')} data-skc-row={key} data-skc-state={view}>
      <div className={cn('cardHead')}>
        <span
          className={cn('cardIcon')}
          style={{ '--skc-avatar-bg': avatar.bg, '--skc-avatar-ink': avatar.ink }}
          aria-hidden="true"
        >
          {avatar.letter}
        </span>
        <div className={cn('cardMain')}>
          <div className={cn('titleRow')}>
            <span className={cn('cardTitle')} title={row.displayName ?? undefined}>{row.name}</span>
          </div>
          <span className={cn('cardDesc')} title={row.description}>{row.description}</span>
        </div>
        {end === null ? null : <div className={cn('cardEnd')}>{end}</div>}
      </div>
      {reason === null ? null : <p className={cn('reason')} role="alert">{reason}</p>}
    </li>
  );
}
