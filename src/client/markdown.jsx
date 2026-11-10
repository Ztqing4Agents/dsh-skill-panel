/**
 * The one place a markdown body is rendered: both detail views use it.
 *
 * The text is third-party or user content, so it goes through the host's own renderer
 * (`MarkdownText`, the one the conversation uses): the panel does not grow a second
 * markdown pipeline, and it does not hand-roll a sanitizer. A renderer that throws must
 * not take the panel with it, so the boundary below turns any failure into the raw text.
 */
import { Component, useMemo } from 'react';

import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives';

import { cn } from './styles.js';

/** Fallback translate, used only when a caller renders without a locale. */
const identityTranslate = (key) => key;

/**
 * Catches a failed markdown render and shows the fallback instead.
 *
 * The boundary is deliberately tiny: its only job is the fallback, and its only child is
 * the host renderer.
 */
export class MarkdownBoundary extends Component {
  /**
   * @param {object} props - `{fallback, children}`.
   */
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  /**
   * Switch to the fallback after a render error.
   * @returns {{failed: boolean}} the next state.
   */
  static getDerivedStateFromError() {
    return { failed: true };
  }

  /**
   * @returns {import('react').ReactNode} the children, or the fallback once they failed.
   */
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * The chrome the host renderer cannot invent.
 *
 * `labels` is required, not optional: every fenced code block reads `labels.code.copyLabel`
 * and footnote chrome reads `labels.footnotes`, so a missing object throws on the very first
 * fence and the boundary then shows the whole document as plain text - tables, lists and
 * fences alike. That is why this is passed on every call instead of defaulted in the host.
 * @param {Function} t - translate function bound to this plugin's namespace.
 * @returns {{code: object, footnotes: string}} the markdown labels object.
 */
function labelsOf(t) {
  return {
    code: {
      copyLabel: t('markdown.codeCopy'),
      copiedLabel: t('markdown.codeCopied'),
      toolbarLabels: {
        codeLabel: t('markdown.codePlain'),
        wrapLabel: t('markdown.codeWrap'),
        unwrapLabel: t('markdown.codeUnwrap'),
      },
    },
    footnotes: t('markdown.footnotes'),
  };
}

/**
 * The host renderer with its labels.
 *
 * A component of its own so the labels object can be memoized: the host discards its
 * streaming render cache when `labels` changes identity, so a fresh object per render would
 * re-parse every chunk. `useMemo` keyed on the translate function keeps one identity per
 * locale for the life of the mount.
 * @param {{text: string, t: Function}} props - the markdown and the translate function.
 * @returns {import('react').ReactElement} the rendered document.
 */
function MarkdownBody({ text, t }) {
  const translate = typeof t === 'function' ? t : identityTranslate;
  const labels = useMemo(() => labelsOf(translate), [translate]);
  return <MarkdownText text={text} variant="body" labels={labels} />;
}

/**
 * Render one markdown body, falling back to the same text as a plain paragraph.
 * @param {{text: string, fallbackClassName?: string, t: Function}} props - the markdown,
 *   the class the fallback paragraph carries (each caller keeps its own type scale), and
 *   the translate function the host renderer's labels come from.
 * @returns {import('react').ReactElement} the rendered body.
 */
export function MarkdownBlock({ text, fallbackClassName, t }) {
  return (
    <MarkdownBoundary fallback={<p className={cn(fallbackClassName)}>{text}</p>}>
      <MarkdownBody text={text} t={t} />
    </MarkdownBoundary>
  );
}
