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
 */
import { useEffect, useRef, useState } from 'react';
import {
  Button,
  StateDot,
  Tag,
  IconCheckOutlineRegular,
  IconChevronDownOutlineRegular,
  IconCopyOutlineRegular,
  IconLinkOutlineRegular,
  IconRefreshOutlineRegular,
  IconTrashOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives';

import { IconTile } from './icon-tile.jsx';
import { FactsTable } from './market-detail.jsx';
import { MarkdownBlock } from './markdown.jsx';
import { cn } from './styles.js';
import { detailFactsOf, isPending, partitionTagKey, rowKey, switchMode } from './model.js';
import { EnableSwitch, ReadonlyTag } from './row.jsx';

/** How long the copy button shows the tick, in milliseconds. */
const COPIED_MS = 1500;

/**
 * The copy affordance of the invocation name.
 *
 * The text beside it is selectable, so this is the second way in, not the only one: a
 * browser that refuses clipboard access (or a non-secure origin) leaves the button doing
 * nothing at all, which is why the name itself is plain selectable text.
 * @param {{name: string, t: Function}} props - the kebab name and the translate function.
 * @returns {import('react').ReactElement} the button and its announcement.
 */
function CopyName({ name, t }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);
  const copy = () => {
    const clipboard = typeof navigator === 'undefined' ? null : navigator.clipboard;
    if (clipboard === null || typeof clipboard.writeText !== 'function') return;
    void clipboard.writeText(name).then(() => {
      setCopied(true);
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), COPIED_MS);
    }).catch(() => {
      // Silent by design: the name is right there to select, and a toast for a failed
      // clipboard write would be the only notice of its kind in the panel.
    });
  };
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        aria-label={t('detail.copy')}
        title={t('detail.copy')}
        onClick={copy}
        icon={copied ? <IconCheckOutlineRegular size={13} /> : <IconCopyOutlineRegular size={13} />}
      />
      <span className={cn('progressAnnouncement')} role="status">{copied ? t('detail.copied') : ''}</span>
    </>
  );
}

/**
 * Render the detail view of one installed skill.
 * @param {{detail: object|null, row: object|null, rows: Map<string, object>, t: Function,
 *   status: string, check?: object|null, iconUrl?: string|null, title?: string,
 *   onBack: Function, onRetry: Function, onToggle: Function, onCheck?: Function}} props - the
 *   detail state, the row the list still carries (null once it is gone), per-row write state,
 *   translate, the detail status, the update check's verdict, the row's icon and visible
 *   title, and the back / retry / switch / check handlers.
 * @returns {import('react').ReactElement} the detail view.
 */
export function InstalledDetail({
  detail, row, rows, t, status, check = null, iconUrl = null, title, onBack, onRetry, onToggle,
  onCheck,
}) {
  const crumb = (
    <button type="button" className={cn('marketCrumb')} onClick={onBack}>
      <IconChevronDownOutlineRegular size={14} className={cn('marketCrumbIcon')} aria-hidden="true" />
      <span>{t('detail.back')}</span>
    </button>
  );
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
  const reason = rows?.get?.(key)?.reason ?? null;
  const mode = switchMode(row);
  const partitionKey = partitionTagKey(row);
  const upstream = row.upstream ?? null;
  const version = typeof row.version === 'string' && row.version !== '' ? row.version : null;
  // The verdict belongs to this row only: a verdict left over from another skill must not
  // paint here (the store already drops it on open and close, this is the belt).
  const verdict = check !== null && check.key === key ? check : null;
  const checkStatus = verdict === null ? 'idle' : verdict.status;
  const checkedAt = verdict !== null && Number.isFinite(verdict.at)
    ? new Date(verdict.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
    : '';
  const busy = verdict !== null && verdict.busy === true;
  const faceText = checkStatus === 'upToDate'
    ? t('detail.upToDate')
    : (checkStatus === 'newer'
      ? t('detail.newerVersion', { version: verdict.latestVersion ?? '' })
      : t(checkStatus === 'unavailable'
        ? 'detail.checkUnavailable'
        : (checkStatus === 'error' ? 'detail.checkFailed' : 'detail.checkIdle')));
  const showMark = checkStatus === 'upToDate';
  const showAt = (showMark || checkStatus === 'newer') && checkedAt !== '';
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
            : <EnableSwitch row={row} t={t} pending={isPending(rows, key)} onToggle={onToggle} />}
        </div>
      </div>
      <div className={cn('detailIntro')}>
        <div className={cn('marketTitleRow')}>
          <h3 className={cn('marketDetailTitle')}>{title ?? row.name}</h3>
          {typeof row.version === 'string' && row.version !== ''
            ? <Tag tone="neutral">{t('market.metaVersion', { version: row.version })}</Tag>
            : null}
        </div>
        {upstream === null
          ? null
          : (
            <p className={cn('detailAuthor')}>
              {t('market.metaAuthor', { author: `${upstream.owner}/${upstream.slug}` })}
            </p>
          )}
        <div className={cn('detailIdentity')}>
          <span className={cn('marketScope')}>{t('detail.callName')}</span>
          <code className={cn('detailCallName')}>{row.name}</code>
          <CopyName name={row.name} t={t} />
        </div>
        {row.description === '' ? null : <p className={cn('marketDetailDesc')}>{row.description}</p>}
      </div>
      {reason === null ? null : <p className={cn('reason')} role="alert">{reason}</p>}
      <div className={cn('detailBodyBox')}>{bodyContent}</div>
      {partitionKey === null && row.readonlyReason !== 'symlink' ? null : (
        <ul className={cn('marketTags')}>
          {partitionKey === null ? null : <li className={cn('marketTag')}>{t(partitionKey)}</li>}
          {row.readonlyReason === 'symlink'
            ? <li className={cn('marketTag')}>{t('row.symlinkReadonly')}</li>
            : null}
        </ul>
      )}
      <FactsTable rows={detailFactsOf(row, t)} />
      <section className={cn('marketDetailSection')}>
        <div className={cn('detailVersionHead')}>
          <h4 className={cn('marketSectionTitle')}>{t('detail.sectionVersion')}</h4>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || checkStatus === 'unavailable'}
            onClick={onCheck}
            icon={busy ? <StateDot state="ongoing" size={13} /> : <IconRefreshOutlineRegular size={13} />}
          >
            {t(busy ? 'detail.checking' : 'detail.checkAgain')}
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
      </section>
      {upstream === null ? null : (
        <section className={cn('marketDetailSection')}>
          <h4 className={cn('marketSectionTitle')}>{t('detail.sectionSource')}</h4>
          <dl className={cn('marketFacts')}>
            <div>
              <dt>{t('detail.factCodeSource')}</dt>
              <dd><code>{version === null ? `${upstream.owner}/${upstream.slug}` : `${upstream.owner}/${upstream.slug}@${version}`}</code></dd>
            </div>
            {version === null ? null : (
              <div>
                <dt>{t('detail.factVersion')}</dt>
                <dd><code>{version}</code></dd>
              </div>
            )}
          </dl>
        </section>
      )}
      {typeof data?.repoUrl !== 'string' ? null : (
        <a className={cn('detailRepoLink')} href={data.repoUrl} target="_blank" rel="noopener noreferrer">
          {t('detail.viewRepo')}
          <IconLinkOutlineRegular size={12} aria-hidden="true" />
        </a>
      )}
    </div>
  );
}
