/**
 * The two dialogs of the installed tab's write actions: add a local directory, and
 * delete one skill's directory.
 *
 * Both are pure props components: neither reads the store nor calls the API, so each can
 * be rendered to a string in a test. The page owns the state machine (`idle` / `busy` /
 * `done` for add, one boolean each for delete) and the request; a dialog only draws what
 * it is handed and reports the click back.
 *
 * The host's own plugin page is the pattern for both seats: one `Modal`, a short body,
 * and a footer whose right-hand button is the action. The add dialog's field, its safety
 * note and its outcome screen are the host's install dialog; the delete confirmation is
 * the host's `ConfirmDialog` without a checkbox.
 */
import { useRef } from 'react';
import { Button, Input, Modal, StateDot, IconWarningOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives';

import { FactsTable } from './market-detail.jsx';
import { reasonKeyOf } from './market-model.js';
import { cn } from './styles.js';

/**
 * Render the add-a-skill dialog.
 *
 * Three states, and the footer changes with them: `idle` asks for a path, `busy` reports
 * the request and refuses to send a second one, `done` replaces the form with the outcome.
 * A failure never leaves this component in a state of its own - the page puts it back to
 * `idle` with the error code, and the line under the field says what the route refused,
 * with the typed path still in the box.
 * @param {{t: Function, status?: 'idle'|'busy'|'done', value?: string, code?: string|null,
 *   params?: object|null, result?: {name?: string, path?: string}|null, onChange?: Function,
 *   onSubmit?: Function, onClose: Function}} props - translate, the three states, the typed
 *   path, the failure code and its placeholders, the route's answer for the outcome line,
 *   and the change / submit / close handlers.
 * @returns {import('react').ReactElement} the dialog.
 */
export function AddSkillDialog({
  t, status = 'idle', value = '', code = null, params = null, result = null,
  onChange, onSubmit, onClose,
}) {
  /** True while an IME composition owns the field (pinyin/zhuyin/kana in progress). */
  const composing = useRef(false);
  const busy = status === 'busy';
  const done = status === 'done';
  const landed = typeof result?.path === 'string' && result.path !== '' ? result.path : '';
  const closeLabel = done ? t('add.close') : t('market.confirmCancel');

  const submit = () => {
    if (busy || done) return;
    onSubmit?.();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t('add.title')}
      closeLabel={closeLabel}
      className={cn('marketDialog')}
      footer={(
        <>
          {/* No cancel while the request runs: it cannot be called back, and a button that
              looked like it could would be a lie. The title-bar close still dismisses the
              dialog - and with it any further report of that request it started. */}
          {done || busy ? null : (
            <Button variant="outline" onClick={onClose}>{t('market.confirmCancel')}</Button>
          )}
          <Button
            variant="primary"
            autoFocus={done}
            disabled={busy || (!done && value.trim() === '')}
            onClick={done ? onClose : submit}
            icon={busy ? <StateDot state="ongoing" size={13} /> : null}
          >
            {t(done ? 'add.close' : (busy ? 'add.busy' : 'add.run'))}
          </Button>
        </>
      )}
    >
      <div className={cn('marketConfirmBody')} aria-busy={busy}>
        {done ? (
          <>
            <p className={cn('marketDetailTitle')} role="status">{t('add.done')}</p>
            {landed === '' ? null : <p className={cn('marketScope')}>{t('market.installOkHint', { path: landed })}</p>}
          </>
        ) : (
          <>
            <p className={cn('marketDetailDesc')}>{t('add.description')}</p>
            <Input
              type="text"
              value={value}
              placeholder={t('add.pathPlaceholder')}
              aria-label={t('add.pathLabel')}
              aria-invalid={code === null ? undefined : true}
              aria-busy={busy}
              data-modal-autofocus=""
              readOnly={busy}
              spellCheck={false}
              onChange={(event) => onChange?.(event.target.value)}
              onCompositionStart={() => {
                // An IME is mid-syllable: Enter must not submit half a path.
                composing.current = true;
              }}
              onCompositionEnd={() => {
                composing.current = false;
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                // keyCode 229 is what a composing Enter reports on Windows IMEs, where
                // `isComposing` is already false by the time React sees the event.
                if (composing.current || event.nativeEvent?.isComposing === true || event.keyCode === 229) return;
                submit();
              }}
            />
            {code === null ? null : (
              <p className={cn('marketError')} role="alert">
                <StateDot state="error" />
                {t(reasonKeyOf(code), params ?? undefined)}
              </p>
            )}
            <p className={cn('marketNotice')} role="note">
              <IconWarningOutlineRegular size={14} aria-hidden="true" />
              <span>{t('add.safety')}</span>
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}

/**
 * Render the delete confirmation.
 *
 * One fact and no checkbox: the directory being removed is the only thing the host asks
 * the reader to look at, because it is the one thing that cannot be undone. Closing the
 * dialog is the caller's job - and it happens before the request, so the page never
 * shows a confirmation of a deletion that already started.
 * @param {{name: string, target?: string, t: Function, onCancel: Function,
 *   onConfirm: Function}} props - the skill, the directory it occupies, translate, and the
 *   two handlers.
 * @returns {import('react').ReactElement} the dialog.
 */
export function DeleteConfirm({ name, target = '', t, onCancel, onConfirm }) {
  return (
    <Modal
      open
      onClose={onCancel}
      title={t('delete.title', { name })}
      closeLabel={t('market.confirmCancel')}
      className={cn('marketDialog')}
      footer={(
        <>
          <Button variant="outline" onClick={onCancel}>{t('market.confirmCancel')}</Button>
          <Button variant="outline" className={cn('detailDanger')} autoFocus onClick={onConfirm}>
            {t('delete.confirm')}
          </Button>
        </>
      )}
    >
      <div className={cn('marketConfirmBody')}>
        <p className={cn('marketDetailDesc')}>{t('delete.body')}</p>
        {target === '' ? null : <FactsTable rows={[{ label: t('delete.factDir'), value: target, code: true }]} />}
      </div>
    </Modal>
  );
}
