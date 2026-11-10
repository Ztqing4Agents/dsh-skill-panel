/**
 * Drive a function component through React's hook dispatcher, without a DOM.
 *
 * `renderToStaticMarkup` proves what a state *renders* but cannot fire an event into it,
 * and this repo has no jsdom. React's own dispatcher is the smallest thing that closes the
 * gap: the component under test is the real one, only the reconciler is replaced, so a test
 * can render, call a handler, and re-render against the same slots.
 *
 * The superset the component tests need, in one place:
 *   - `useState` with a controllable slot, `render()` re-runs against it;
 *   - `useRef` with a stable object per slot, so a component can read `ref.current`;
 *   - `useCallback` / `useMemo` without a dependency array: the harness re-renders by
 *     calling the component again, so "same deps" is trivially true and the identity
 *     question those hooks answer cannot change an outcome here;
 *   - `useId` as a per-mount counter, so two renders of the same mount give the same id;
 *   - `useSyncExternalStore` reading `getSnapshot()` once - the harness renders on demand,
 *     so there is nothing to subscribe to;
 *   - `useEffect` as a no-op: effects are the one thing this harness cannot run, which is
 *     why every transition under test here lives in an event handler or a pure function.
 */
import { createRequire } from 'node:module';

/** This process's React, so the dispatcher it installs is the one the component sees. */
const ReactCjs = createRequire(import.meta.url)('react');

/**
 * Mount one function component against a fake hook dispatcher.
 * @param {Function} component - the component to drive.
 * @param {object} initialProps - props of the first render.
 * @returns {{render: (nextProps?: object) => object}} a handle whose `render` re-runs the
 *   component (state written by a handler is visible to the next call).
 */
export function mountHooks(component, initialProps) {
  /** State slots, by call order. */
  const slots = [];
  /** Ref slots, by call order (their own counter: a component may mix the two freely). */
  const refs = [];
  const internals = ReactCjs.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
  const holder = internals.ReactCurrentDispatcher;
  const previous = holder.current;
  let props = initialProps;
  const render = (nextProps) => {
    if (nextProps !== undefined) props = nextProps;
    let index = 0;
    let refIndex = 0;
    let idIndex = 0;
    holder.current = {
      useEffect: () => {},
      useLayoutEffect: () => {},
      useCallback: (callback) => callback,
      useMemo: (factory) => factory(),
      useId: () => {
        const at = idIndex;
        idIndex += 1;
        return `:skc-test-r${at}:`;
      },
      useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
      useRef(initial) {
        const at = refIndex;
        refIndex += 1;
        if (!(at in refs)) refs[at] = { current: initial };
        return refs[at];
      },
      useState(initial) {
        const at = index;
        index += 1;
        if (!(at in slots)) slots[at] = typeof initial === 'function' ? initial() : initial;
        const set = (next) => {
          slots[at] = typeof next === 'function' ? next(slots[at]) : next;
        };
        return [slots[at], set];
      },
    };
    try {
      return component(props);
    } finally {
      holder.current = previous;
    }
  };
  return { render };
}
