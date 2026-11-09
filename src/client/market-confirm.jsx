/**
 * The install confirmation: the host's `Modal`, the skill's identity, the four facts
 * that matter before third-party text lands on disk, and the effect it will have.
 *
 * The dialog is the only place that asks anything. Cancelling closes it and produces no
 * request; confirming hands back to the panel, which is the only thing that talks to the
 * install route.
 */
import { Button, Modal, Tag, IconWarningOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives';

import { cn } from './styles.js';
import { MarketIcon } from './market-card.jsx';
import { FactsTable } from './market-detail.jsx';

/**
 * Render the install confirmation.
 * @param {{item: object, detail: object|null, t: Function, onCancel: Function,
 *   onConfirm: Function}} props - the item being installed, its detail when it is already
 *   loaded, translate, and the two handlers.
 * @returns {import('react').ReactElement} the dialog.
 */
export function MarketConfirm({ item, detail, t, onCancel, onConfirm }) {
  const title = item?.displayName || item?.slug || '';
  const data = detail?.status === 'ready' ? detail.data : null;
  const installTo = typeof data?.installTo === 'string' && data.installTo !== '' ? data.installTo : null;
  const unknown = t('market.factUnknown');
  const facts = [
    { label: t('market.factSource'), value: t(`market.source.${item?.sourceId}`), code: false },
    {
      label: t('market.factAuthor'),
      value: typeof item?.author === 'string' && item.author !== '' ? item.author : unknown,
      code: false,
    },
    {
      label: t('market.factVersion'),
      value: typeof item?.version === 'string' && item.version !== '' ? item.version : unknown,
      code: false,
    },
  ];
  if (installTo !== null) facts.push({ label: t('market.factInstallTo'), value: installTo, code: true });
  return (
    <Modal
      open
      onClose={onCancel}
      title={t('market.confirmTitle', { name: title })}
      closeLabel={t('market.confirmCancel')}
      className={cn('marketDialog')}
      footer={(
        <>
          <Button variant="outline" onClick={onCancel}>{t('market.confirmCancel')}</Button>
          <Button variant="primary" autoFocus onClick={() => onConfirm(item)}>
            {t('market.confirmInstall')}
          </Button>
        </>
      )}
    >
      <div className={cn('marketConfirmBody')}>
        <div className={cn('marketConfirmHead')}>
          <MarketIcon item={item} title={title} />
          <div className={cn('marketMain')}>
            <div className={cn('marketTitleRow')}>
              <span className={cn('marketDetailTitle')}>{title}</span>
              <Tag>{t(`market.source.${item?.sourceId}`)}</Tag>
            </div>
          </div>
        </div>
        <FactsTable rows={facts} />
        {data?.nameValid === false
          ? <p className={cn('marketError')}>{t('market.nameInvalidNote')}</p>
          : null}
        <p className={cn('marketNotice')} role="note">
          <IconWarningOutlineRegular size={14} aria-hidden="true" />
          <span>{t('market.confirmTrust')}</span>
        </p>
      </div>
    </Modal>
  );
}
