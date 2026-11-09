/**
 * The shell overlay's notices: a refresh that failed, and an install that landed.
 *
 * They live outside the page on purpose: a refresh can fail after the user has clicked
 * back into a conversation, and an install keeps running while they browse on. Both
 * therefore have to be visible without the page being mounted.
 *
 * One seat serves both: the notice's `kind` picks the copy and the icon, so an install
 * tells the user where the skill went and that it takes effect in a new conversation
 * without inventing a second overlay.
 */
import { useSyncExternalStore } from 'react';
import { Toast, IconWarningOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives';

import { cn } from './styles.js';

/** How long the install confirmation stays up, matching the refresh notice's rhythm. */
const INSTALL_HOLD_MS = 5000;

/** Fallback translate used only when the seat is rendered without a locale. */
const identityTranslate = (key) => key;

/**
 * Render the toast for the newest notice, or nothing.
 * @param {{t?: Function, store: object}} props - locale seat and page store.
 * @returns {import('react').ReactElement|null} the toast.
 */
export function ToastHost({ t = identityTranslate, store }) {
  const read = () => store.getSnapshot().notice;
  const notice = useSyncExternalStore(store.subscribe, read, read);
  if (notice === null) return null;
  const dismiss = () => store.actions.dismissNotice(notice.seq);
  if (notice.kind === 'install-ok') {
    return (
      <Toast
        key={notice.seq}
        holdMs={INSTALL_HOLD_MS}
        tone="success"
        text={(
          <>
            {t('market.installOk', { name: notice.name })}
            {typeof notice.path === 'string' && notice.path !== ''
              ? <span className={cn('marketToastHint')}>{t('market.installOkHint', { path: notice.path })}</span>
              : null}
          </>
        )}
        onDone={dismiss}
      />
    );
  }
  if (notice.kind !== 'refresh-failed') return null;
  return (
    <Toast
      key={notice.seq}
      text={t('page.refreshError')}
      icon={<IconWarningOutlineRegular />}
      onDone={dismiss}
    />
  );
}
