/**
 * One builtin provider's page: the skills it ships, each with its own switch.
 *
 * It is the second level of the installed tab: the list shows one block per provider, this
 * page shows what is inside, and a row here opens that skill's own detail page. The back
 * chain is therefore list -> provider -> skill, and each level restores its own offset.
 *
 * There is no version block and no repository link on this page: a builtin skill has no
 * upstream identity to compare or to link to (the rule settled for local skills applies to
 * them as well - see docs/contracts/installed-detail.md).
 */
import { DetailCrumb } from './installed-detail.jsx';
import { IconTile } from './icon-tile.jsx';
import { cn } from './styles.js';
import { EnableSwitch, ReadonlyTag } from './row.jsx';
import { isPending, rowKey, switchMode } from './model.js';

/**
 * One skill inside a provider page, as the component row both detail pages use.
 *
 * It is the same 74-high row as the call-name block on a skill page - 41 icon, name, two
 * lines of description - with the switch in the row's one action seat. The row opens the
 * skill's own page through the title button, whose `::after` covers the row (hard
 * constraint 9); nothing here intercepts events.
 * @param {{row: object, t: Function, rows: Map<string, object>, onToggle: Function,
 *   onOpen: Function}} props - the skill, translate, per-row write state and both handlers.
 * @returns {import('react').ReactElement} the row.
 */
function SkillCallRow({ row, t, rows, onToggle, onOpen }) {
  const key = rowKey(row);
  const mode = switchMode(row);
  const end = mode === null
    ? (row.readonlyReason === 'symlink' ? <ReadonlyTag row={row} t={t} /> : null)
    : <EnableSwitch row={row} t={t} pending={isPending(rows, key)} onToggle={onToggle} />;
  return (
    <div className={cn('callRow', 'callRowOpen')} data-skc-row={key}>
      <IconTile title={row.name} className="callIcon" />
      <div className={cn('callBody')}>
        <button
          type="button"
          className={cn('cardTitle', 'cardOpen', 'callName')}
          title={row.displayName ?? undefined}
          onClick={() => onOpen?.(row)}
        >
          {row.displayName ?? row.name}
        </button>
        {row.description === '' ? null : <p className={cn('callDesc')}>{row.description}</p>}
      </div>
      {end === null ? null : <div className={cn('cardEnd')}>{end}</div>}
    </div>
  );
}

/**
 * Render one provider's page.
 * @param {{block: {key: string, provider: string, iconUrl: string|null, skills: object[]},
 *   t: Function, rows: Map<string, object>, onBack: Function, onToggle: Function,
 *   onOpenRow: Function}} props - the block, translate, per-row write state, and the back /
 *   switch / open handlers.
 * @returns {import('react').ReactElement} the page.
 */
export function PluginDetail({ block, t, rows, onBack, onToggle, onOpenRow }) {
  return (
    <div className={cn('marketDetail')} data-skc-plugin-detail={block.provider} data-skc-plugin-pkg={block.key}>
      <DetailCrumb t={t} onBack={onBack} />
      {/* Same head row and title group as a skill page; the right side stays empty - a
          provider has neither an uninstall nor a switch of its own. */}
      <div className={cn('detailTop')}>
        <IconTile iconUrl={block.iconUrl ?? null} title={block.key} className="detailIcon" />
      </div>
      <div className={cn('detailIntro')}>
        <div className={cn('marketTitleRow')}>
          <h3 className={cn('marketDetailTitle')}>{block.key}</h3>
        </div>
        <p className={cn('marketDetailDesc')}>{t('plugin.skillsCount', { count: block.skills.length })}</p>
      </div>
      <section className={cn('marketDetailSection')}>
        <h4 className={cn('marketSectionTitle')}>{t('plugin.skills')}</h4>
        <div className={cn('cards')}>
          {block.skills.map((row) => (
            <SkillCallRow
              key={row.name}
              row={row}
              t={t}
              rows={rows}
              onToggle={onToggle}
              onOpen={onOpenRow}
            />
          ))}
        </div>
      </section>
      <section className={cn('marketDetailSection')}>
        <h4 className={cn('marketSectionTitle')}>{t('detail.sectionSource')}</h4>
        <dl className={cn('marketFacts')}>
          <div>
            <dt>{t('detail.factCodeSource')}</dt>
            <dd>{t('detail.sourceBuiltin')}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
