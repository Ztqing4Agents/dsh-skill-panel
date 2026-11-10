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
import { SkillRow } from './row.jsx';

/**
 * Render one provider's page.
 * @param {{block: {provider: string, skills: object[]}, t: Function, rows: Map<string, object>,
 *   onBack: Function, onToggle: Function, onOpenRow: Function}} props - the block, translate,
 *   per-row write state, and the back / switch / open handlers.
 * @returns {import('react').ReactElement} the page.
 */
export function PluginDetail({ block, t, rows, onBack, onToggle, onOpenRow }) {
  return (
    <div className={cn('marketDetail')} data-skc-plugin-detail={block.provider}>
      <DetailCrumb t={t} onBack={onBack} />
      <div className={cn('pluginHead')}>
        <IconTile title={block.provider} />
        <div className={cn('cardMain')}>
          <h3 className={cn('marketDetailTitle')}>{block.provider}</h3>
          <p className={cn('cardDesc')}>{t('plugin.skillsCount', { count: block.skills.length })}</p>
        </div>
      </div>
      <section className={cn('marketDetailSection')}>
        <h4 className={cn('marketSectionTitle')}>{t('plugin.skills')}</h4>
        <ul className={cn('cards')}>
          {block.skills.map((row) => (
            <SkillRow
              key={row.name}
              row={row}
              t={t}
              rows={rows}
              onToggle={onToggle}
              onOpen={onOpenRow}
              title={row.displayName ?? undefined}
            />
          ))}
        </ul>
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
