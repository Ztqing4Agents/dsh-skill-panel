/**
 * One builtin provider's page: the skills it ships, each with its own switch.
 *
 * It is the second level of the installed tab: the list shows one block per provider and
 * this page shows what is inside. Its rows are read-only information rows - a builtin skill
 * has nothing worth opening - so the only level below is the list, and the only action a
 * row offers is its own switch.
 *
 * There is no version block and no repository link on this page: a builtin skill has no
 * upstream identity to compare or to link to (the rule settled for local skills applies to
 * them as well - see docs/contracts/installed-detail.md).
 */
import { Tag } from '@deepseek-ai/dsh-client-ui-primitives';

import { DetailCrumb } from './installed-detail.jsx';
import { IconTile } from './icon-tile.jsx';
import { cn } from './styles.js';
import { EnableSwitch, ReadonlyTag } from './row.jsx';
import { isPending, rowKey, switchMode } from './model.js';

/**
 * One skill inside a provider page, as the component row this page lists skills with.
 *
 * Same 10/10 padded row as the host's component list: 41 icon, name and up to two lines of
 * description, which puts the row back on the host's 74. The row is not clickable -
 * a builtin skill has no page below - so it carries no click layer and no hover, and the
 * switch stays the row's only action (hard constraint 9).
 * @param {{row: object, t: Function, rows: Map<string, object>, onToggle: Function}} props -
 *   the skill, translate, per-row write state and the switch handler.
 * @returns {import('react').ReactElement} the row.
 */
function SkillCallRow({ row, t, rows, onToggle }) {
  const key = rowKey(row);
  const mode = switchMode(row);
  const end = mode === null
    ? (row.readonlyReason === 'symlink' ? <ReadonlyTag row={row} t={t} /> : null)
    : <EnableSwitch row={row} t={t} pending={isPending(rows, key)} onToggle={onToggle} />;
  return (
    <div className={cn('callRow')} data-skc-row={key}>
      <IconTile title={row.name} className="callIcon" />
      <div className={cn('callBody')}>
        <p className={cn('callName')}>{row.displayName ?? row.name}</p>
        {row.description === '' ? null : <p className={cn('callDesc')}>{row.description}</p>}
      </div>
      <div className={cn('cardEnd')}>
        <span className={cn('pluginState')}>
          <span className={cn('pluginDot', row.enabled === true ? '' : 'pluginDotOff')} aria-hidden="true" />
          {t(row.enabled === true ? 'plugin.running' : 'plugin.stopped')}
        </span>
        {end}
      </div>
    </div>
  );
}

/**
 * Render one provider's page.
 * @param {{block: {key: string, provider: string, iconUrl: string|null, version: string|null,
 *   description: string|null, skills: object[]}, t: Function, rows: Map<string, object>,
 *   onBack: Function, onToggle: Function}} props - the block, translate, per-row write state
 *   and the back / switch handlers.
 * @returns {import('react').ReactElement} the page.
 */
export function PluginDetail({ block, t, rows, onBack, onToggle }) {
  const running = block.skills.filter((row) => row.enabled === true).length;
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
          {block.version === null
            ? null
            : <Tag tone="neutral">{t('market.metaVersion', { version: block.version })}</Tag>}
        </div>
        {block.description === null
          ? null
          : <p className={cn('marketDetailDesc', 'pluginDesc')}>{block.description}</p>}
      </div>
      <section className={cn('marketDetailSection')}>
        <div className={cn('sectionHead')}>
          <h4 className={cn('marketSectionTitle')}>{t('plugin.skills')}</h4>
          <span className={cn('pluginCount')}>
            {t('plugin.countRunning', { count: block.skills.length, running })}
          </span>
        </div>
        <div className={cn('cards')}>
          {block.skills.map((row) => (
            <SkillCallRow
              key={row.name}
              row={row}
              t={t}
              rows={rows}
              onToggle={onToggle}
            />
          ))}
        </div>
      </section>
      <section className={cn('marketDetailSection')}>
        <h4 className={cn('marketSectionTitle')}>{t('detail.sectionSource')}</h4>
        <dl className={cn('marketFacts')}>
          <div>
            <dt>{t('detail.factCodeSource')}</dt>
            <dd>
              <code>{block.version === null ? block.key : `${block.key}@${block.version}`}</code>
            </dd>
          </div>
          {block.version === null ? null : (
            <div>
              <dt>{t('detail.factVersion')}</dt>
              <dd><code>{block.version}</code></dd>
            </div>
          )}
        </dl>
      </section>
    </div>
  );
}
