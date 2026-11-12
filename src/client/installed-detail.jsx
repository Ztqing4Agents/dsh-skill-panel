/**
 * The installed tab's inline detail: the local facts of one skill, plus the text read from
 * disk when it was opened.
 *
 * It replaces the three partitions in place, the way the market's detail replaces its grid:
 * the list snapshot stays in the store, so "back to the installed tab" lands on the same
 * rows at the same scroll offset without re-reading anything, while the body - the one part
 * that can change under the user - is read once, when the row is opened.
 *
 * The facts come from the row the list already carries; nothing here decides anything about
 * a skill, it only draws what the host said. A symlinked skill has no switch anywhere in the
 * panel (hard constraint 5), so this page shows its read-only marker and its real location
 * instead of pretending a control exists.
 *
 * The version block is the one place with a verdict of its own: it reads a cached answer
 * keyed by upstream identity and compares that answer's first row against **this row's**
 * version, so two directories holding the same skill can disagree without either being
 * wrong.
 */
import {
  Button,
  StateDot,
  Tag,
  IconCheckOutlineRegular,
  IconChevronDownOutlineRegular,
  IconLinkOutlineRegular,
  IconRefreshOutlineRegular,
  IconTrashOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives';

import { IconTile } from './icon-tile.jsx';
import { MarkdownBlock } from './markdown.jsx';
import { UpdateConfirm } from './market-confirm.jsx';
import { cn } from './styles.js';
import {
  clockText,
  dateText,
  identityOf,
  isPending,
  newerVersions,
  rowKey,
  switchMode,
  verdictOf,
} from './model.js';
import { EnableSwitch, ReadonlyTag } from './row.jsx';

/**
 * The one way back: a chevron and the word "skills". Shared by both installed views, so the
 * provider page and a skill page can never drift apart on their breadcrumb.
 * @param {{t: Function, onBack: Function}} props - translate and the back handler.
 * @returns {import('react').ReactElement} the crumb button.
 */
export function DetailCrumb({ t, onBack }) {
  return (
    <button type="button" className={cn('marketCrumb')} onClick={onBack}>
      <IconChevronDownOutlineRegular size={14} className={cn('marketCrumbIcon')} aria-hidden="true" />
      <span>{t('detail.back')}</span>
    </button>
  );
}

/**
 * Render the detail view of one installed skill.
 *
 * Deliberately hook-free: the tests - and the page's own two-level back - read this
 * component by calling it, so the two bits of view state it needs (is the version list
 * open, is the update dialog up) are props the page owns. Neither belongs in the store:
 * both are sub-states of "an update is available", and a store field could contradict it.
 * @param {{detail: object|null, row: object|null, rows: Map<string, object>, t: Function,
 *   status: string, check?: object|null, updating?: boolean, iconUrl?: string|null,
 *   title?: string, expanded?: boolean, updateTarget?: string|null, onBack: Function,
 *   onRetry: Function, onToggle: Function, onCheck?: Function, onUpdate?: Function,
 *   onExpand?: Function, onUpdatePrompt?: Function}} props - the detail state, the row the
 *   list still carries (null once it is gone), per-row write state, translate, the detail
 *   status, this identity's cached verdict, whether an update of it is in flight, the row's
 *   icon and visible title, the two view flags, and the back / retry / switch / check /
 *   update / expand / dialog handlers.
 * @returns {import('react').ReactElement} the detail view.
 */
export function InstalledDetail({
  detail, row, rows, t, status, check = null, updating = false, iconUrl = null, title,
  expanded = false, updateTarget = null, onBack, onRetry, onToggle, onCheck, onUpdate,
  onExpand, onUpdatePrompt,
}) {
  const crumb = <DetailCrumb t={t} onBack={onBack} />;
  // The row can disappear under the page (someone deleted the directory); the way back is
  // the only thing left to offer, and saying so beats an exception.
  if (row === null || row === undefined) {
    return (
      <div className={cn('marketDetail')} data-skc-detail-missing="">
        {crumb}
        <p className={cn('marketError')} role="alert">
          <StateDot state="error" />
          {t('error.E_NOT_FOUND')}
        </p>
      </div>
    );
  }
  const key = rowKey(row);
  const data = status === 'ready' ? detail?.data ?? null : null;
  const body = typeof data?.body === 'string' && data.body.trim() !== '' ? data.body : null;
  // An empty reason is "no reason": the store clears a failure by writing one, and the row
  // styles treat that as idle too.
  const rawReason = rows?.get?.(key)?.reason ?? null;
  const reason = typeof rawReason === 'string' && rawReason !== '' ? rawReason : null;
  const mode = switchMode(row);
  const upstream = row.upstream ?? null;
  const version = typeof row.version === 'string' && row.version !== '' ? row.version : null;
  // Where the code comes from, in the host's own four shapes: a package spec for a market
  // install, "link:<dir>" for a symlink, the plain directory otherwise, and the word for a
  // row that has no file at all. Built here, not on the host: it is one string, and a new
  // field on the detail payload would ripple into the route contract for nothing.
  const base = typeof row.realPath === 'string' && row.realPath !== ''
    ? row.realPath
    : (typeof row.path === 'string' && row.path !== '' ? row.path : null);
  const dir = base === null ? null : base.replace(/\/[^/]+$/, '');
  const codeSource = dir === null
    ? null
    : (upstream === null
      ? (row.symlink === true ? `link:${dir}` : dir)
      : (version === null ? `${upstream.owner}/${upstream.slug}` : `${upstream.owner}/${upstream.slug}@${version}`));
  // The verdict belongs to the identity, not the row: the store keys them by
  // `source:owner:slug`, so a verdict left over from another skill cannot paint here, and
  // the same verdict can read "up to date" on one directory and "available" on the next.
  const identity = upstream === null ? '' : identityOf(upstream);
  const verdict = identity !== '' && check !== null && check.key === identity ? check : null;
  const busy = verdict?.busy === true;
  const face = version === null ? 'failed' : verdictOf(verdict, version);
  const candidate = typeof verdict?.candidate === 'string' ? verdict.candidate : '';
  const newer = newerVersions(verdict?.versions ?? [], version, verdict?.total ?? 0);
  const checkedAt = clockText(Number.isFinite(verdict?.at) ? verdict.at : null);
  const showAt = (face === 'upToDate' || face === 'available') && checkedAt !== '';
  const faceText = face === 'upToDate'
    ? t('detail.upToDate')
    : (face === 'available'
      ? t('detail.newerVersion', { version: candidate })
      : (face === 'offline'
        ? t('detail.checkOffline')
        : (face === 'failed' ? t('detail.checkFailed') : t('detail.checking'))));
  const showMark = face === 'upToDate';
  // Same premise as the version block's own render condition: a symlinked skill gets no
  // block, and the action group must not offer a write the block does not back (the host
  // would answer it with E_SYMLINK_READONLY - a control that looks live and does nothing).
  const showUpdate = face === 'available' && candidate !== '' && row.symlink !== true;
  // The box holds one element in every state, so the host's "only the README is boxed" shape
  // stays true: loading / failure / empty all render in place instead of above the document.
  let bodyContent;
  if (status === 'loading') {
    bodyContent = <p className={cn('marketScope')}>{t('detail.loading')}</p>;
  } else if (status === 'error') {
    bodyContent = (
      <div className={cn('marketFailure')}>
        <p className={cn('marketError')} role="alert">
          <StateDot state="error" />
          {t('detail.error')}
        </p>
        <Button variant="outline" size="sm" onClick={onRetry}>{t('detail.retry')}</Button>
      </div>
    );
  } else if (body === null) {
    bodyContent = <p className={cn('marketScope')}>{t('detail.noBody')}</p>;
  } else {
    bodyContent = (
      <div className={cn('detailBody')}>
        <MarkdownBlock text={body} fallbackClassName="detailBody" t={t} />
        {data?.truncated === true ? <p className={cn('marketScope')}>{t('detail.truncated')}</p> : null}
      </div>
    );
  }
  return (
    <div className={cn('marketDetail')} data-skc-installed-detail={key}>
      {crumb}
      <div className={cn('detailTop')}>
        <IconTile iconUrl={iconUrl} title={row.name} className="detailIcon" />
        <div className={cn('detailActions')}>
          {/* The action group's order is the host's: update, uninstall, switch. Update is
              rendered only when there is something to install - a permanently disabled
              button would be one more control that never works (the add-skill button's
              disabled treatment is reserved for features that will exist). */}
          {showUpdate ? (
            <Button
              variant="outline"
              size="sm"
              disabled={updating || busy}
              onClick={() => onUpdatePrompt?.(candidate)}
              icon={updating
                ? <StateDot state="ongoing" size={13} />
                : <IconRefreshOutlineRegular size={13} />}
            >
              {t(updating ? 'detail.updating' : 'detail.update')}
            </Button>
          ) : null}
          {/* Uninstall is a placeholder: visible and disabled, with no handler, because the real
              one is a write route this version does not have (board M6). Disabled rather than
              absent is the same call the add-skill button makes (decisions C-3). */}
          <Button
            variant="outline"
            size="sm"
            className={cn('detailDanger')}
            disabled
            title={t('detail.uninstallSoon')}
            icon={<IconTrashOutlineRegular size={13} />}
          >
            {t('detail.uninstall')}
          </Button>
          {mode === null
            ? (row.readonlyReason === 'symlink' ? <ReadonlyTag row={row} t={t} /> : null)
            : (
              <EnableSwitch
                row={row}
                t={t}
                pending={isPending(rows, key) || updating}
                onToggle={onToggle}
              />
            )}
        </div>
      </div>
      <div className={cn('detailIntro')}>
        <div className={cn('marketTitleRow')}>
          <h3 className={cn('marketDetailTitle')}>{title ?? row.name}</h3>
          {typeof row.version === 'string' && row.version !== ''
            ? <Tag tone="neutral">{t('market.metaVersion', { version: row.version })}</Tag>
            : null}
        </div>
        {/* The call name sits where the author line used to be: it is what a person types to
            invoke the skill, so it belongs in the title group. The upstream identity still
            drives source, update check and repo link. */}
        <p className={cn('detailAuthor')}><code>{row.name}</code></p>
        {row.description === '' ? null : <p className={cn('marketDetailDesc')}>{row.description}</p>}
      </div>
      {reason === null ? null : <p className={cn('reason')} role="alert">{reason}</p>}
      <div className={cn('detailBodyBox')}>{bodyContent}</div>
      {upstream === null || row.symlink === true ? null : (
      <section className={cn('marketDetailSection')} data-skc-version-face={face}>
        <div className={cn('detailVersionHead')}>
          <h4 className={cn('marketSectionTitle')}>{t('detail.sectionVersion')}</h4>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || updating}
            onClick={() => onCheck?.(row)}
            icon={busy || updating
              ? <StateDot state="ongoing" size={13} />
              : <IconRefreshOutlineRegular size={13} />}
          >
            {t(updating ? 'detail.updating' : (busy ? 'detail.checking' : 'detail.checkAgain'))}
          </Button>
        </div>
        <div className={cn('detailVersionCard')}>
          <div className={cn('detailVersionRow')}>
            {showMark
              ? <span className={cn('detailVersionMark')} aria-hidden="true"><IconCheckOutlineRegular size={14} /></span>
              : null}
            <div className={cn('detailVersionText')}>
              <p className={cn('detailVersionTitle')}>{faceText}</p>
              {showAt ? <p className={cn('marketScope')}>{t('detail.checkedAt', { time: checkedAt })}</p> : null}
            </div>
          </div>
        </div>
        {face === 'available' && newer.count > 0 ? (
          <Button
            variant="outline"
            size="sm"
            aria-expanded={expanded}
            onClick={() => onExpand?.(!expanded)}
          >
            {expanded ? t('detail.collapse') : t('detail.newVersionCount', { count: newer.count })}
          </Button>
        ) : null}
        {face === 'available' && expanded ? (
          <ul className={cn('detailVersionList')}>
            {newer.items.map((entry, index) => {
              const current = entry.version === version;
              const offered = index === 0 && entry.version === candidate;
              return (
                <li className={cn('detailVersionItem')} key={entry.version}>
                  <span>
                    {t('market.metaVersion', { version: entry.version })}
                    {Number.isFinite(entry.publishedAt)
                      ? <span className={cn('marketScope')}> {t('detail.publishedAt', { date: dateText(entry.publishedAt) })}</span>
                      : null}
                  </span>
                  {current
                    ? <Tag tone="neutral">{t('market.installed')}</Tag>
                    : (offered
                      ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={updating || busy}
                          onClick={() => onUpdatePrompt?.(entry.version)}
                        >
                          {t('detail.updateTo', { version: entry.version })}
                        </Button>
                      )
                      : null)}
                </li>
              );
            })}
            {newer.more > 0 ? (
              <li className={cn('detailVersionItem')}>
                <span className={cn('marketScope')}>{t('detail.moreNewVersions', { count: newer.more })}</span>
              </li>
            ) : null}
          </ul>
        ) : null}
      </section>
      )}
      <section className={cn('marketDetailSection')}>
        <h4 className={cn('marketSectionTitle')}>{t('detail.sectionSource')}</h4>
        <dl className={cn('marketFacts')}>
          <div>
            <dt>{t('detail.factCodeSource')}</dt>
            <dd>{codeSource === null ? t('detail.sourceBuiltin') : <code>{codeSource}</code>}</dd>
          </div>
          {version === null ? null : (
            <div>
              <dt>{t('detail.factVersion')}</dt>
              <dd><code>{version}</code></dd>
            </div>
          )}
        </dl>
      </section>
      {typeof data?.repoUrl !== 'string' ? null : (
        <a className={cn('detailRepoLink')} href={data.repoUrl} target="_blank" rel="noopener noreferrer">
          {t('detail.viewRepo')}
          <IconLinkOutlineRegular size={12} aria-hidden="true" />
        </a>
      )}
      {updateTarget === null ? null : (
        <UpdateConfirm
          name={title ?? row.name}
          sourceId={upstream?.sourceId ?? ''}
          from={version ?? ''}
          to={updateTarget}
          target={dir ?? ''}
          t={t}
          onCancel={() => onUpdatePrompt?.(null)}
          onConfirm={() => {
            const to = updateTarget;
            onUpdatePrompt?.(null);
            onUpdate?.(row, to);
          }}
        />
      )}
    </div>
  );
}
