/**
 * The refresh-failure toast, mounted in the shell's overlay.
 *
 * It lives outside the page on purpose: a refresh can fail after the user has
 * clicked back into a conversation, and the failure still has to be visible.
 */
import { useSyncExternalStore } from 'react';
import { Toast, IconWarningOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives';

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
  if (notice === null || notice.kind !== 'refresh-failed') return null;
  return (
    <Toast
      key={notice.seq}
      text={t('page.refreshError')}
      icon={<IconWarningOutlineRegular />}
      onDone={() => store.actions.dismissNotice(notice.seq)}
    />
  );
}
