/**
 * The market's inline detail view: breadcrumb back, head, facts, overview, file list.
 *
 * It replaces the grid in place, the way the host's own plugin market does it - the list
 * state lives in the store, not here, so "back to the market" lands on the same loaded
 * pages at the same scroll offset without re-fetching anything.
 *
 * The overview is third-party markdown, so it is rendered by the host's own renderer
 * through `markdown.jsx` (the same unit the installed tab's detail uses): the panel does
 * not grow a second markdown pipeline, and it does not hand-roll a sanitizer.
 */
import {
  Button,
  StateDot,
  Tag,
  IconChevronDownOutlineRegular,
  fileSizeText,
} from '@deepseek-ai/dsh-client-ui-primitives';

import { cn } from './styles.js';
import { InstallAction, MarketIcon } from './market-card.jsx';
import { detailFacts, marketKeyOf } from './market-model.js';
import { MarkdownBlock } from './markdown.jsx';

/**
 * A definition-list table of label/value rows, one line per fact.
 * @param {{rows: {label: string, value: string, code?: boolean}[]}} props - the rows.
 * @returns {import('react').ReactElement} the table.
 */
export function FactsTable({ rows }) {
  return (
    <dl className={cn('marketFacts')}>
      {rows.map((row) => (
        <div key={row.label}>
          <dt>{row.label}</dt>
          <dd>{row.code === true ? <code>{row.value}</code> : row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Render the detail view of one market item.
 * @param {{detail: object, market: object, t: Function, onBack: Function, onRetry: Function,
 *   onInstall: Function}} props - the detail state, the market state, translate, and the
 *   back / retry / install handlers.
 * @returns {import('react').ReactElement} the detail view.
 */
export function MarketDetail({ detail, market, t, onBack, onRetry, onInstall }) {
  const data = detail?.status === 'ready' ? detail.data : null;
  const item = data?.item ?? detail?.item ?? {};
  const title = item.displayName || item.slug || '';
  const overview = typeof data?.overview === 'string' ? data.overview.trim() : '';
  const files = Array.isArray(data?.files) ? data.files : [];
  return (
    <div className={cn('marketDetail')} data-skc-market-detail={marketKeyOf(item)}>
      <button type="button" className={cn('marketCrumb')} onClick={onBack}>
        <IconChevronDownOutlineRegular size={13} className={cn('marketCrumbIcon')} aria-hidden="true" />
        <span>{t('market.detailBack')}</span>
      </button>
      <div className={cn('marketDetailHead')}>
        <MarketIcon item={item} title={title} market={market} />
        <div className={cn('marketMain')}>
          <div className={cn('marketTitleRow')}>
            <h3 className={cn('marketDetailTitle')}>{title}</h3>
            {typeof item.version === 'string' && item.version !== ''
              ? <Tag tone="neutral">{item.version}</Tag>
              : null}
            <Tag>{t(`market.source.${item.sourceId}`)}</Tag>
          </div>
        </div>
        <InstallAction item={item} market={market} t={t} onInstall={onInstall} />
      </div>
      {detail?.status === 'loading' ? <p className={cn('marketScope')}>{t('market.detailLoading')}</p> : null}
      {detail?.status === 'error' ? (
        <div className={cn('marketFailure')}>
          <p className={cn('marketError')} role="alert">
            <StateDot state="error" />
            {t('market.detailError')}
          </p>
          <Button variant="outline" size="sm" onClick={onRetry}>{t('market.retry')}</Button>
        </div>
      ) : null}
      {data === null ? null : (
        <>
          <FactsTable rows={detailFacts(data, market, t)} />
          {data.nameValid === false
            ? <p className={cn('marketError')}>{t('market.nameInvalidNote')}</p>
            : null}
          <section className={cn('marketDetailSection')}>
            <h4 className={cn('marketSectionTitle')}>{t('market.detailOverview')}</h4>
            {overview === ''
              ? <p className={cn('marketScope')}>{t('market.detailNoOverview')}</p>
              : <MarkdownBlock text={overview} fallbackClassName="marketDetailDesc" t={t} />}
          </section>
          <section className={cn('marketDetailSection')}>
            <h4 className={cn('marketSectionTitle')}>{t('market.detailFiles')}</h4>
            {files.length === 0
              ? <p className={cn('marketScope')}>{t('market.detailFilesEmpty')}</p>
              : (
                <ul className={cn('marketFiles')}>
                  {files.map((file) => (
                    <li key={file.path}>
                      <span className={cn('marketFileName')}>{file.path}</span>
                      {Number.isFinite(file.size)
                        ? <span className={cn('marketFileSize')}>{fileSizeText(file.size)}</span>
                        : null}
                    </li>
                  ))}
                </ul>
              )}
          </section>
        </>
      )}
    </div>
  );
}
