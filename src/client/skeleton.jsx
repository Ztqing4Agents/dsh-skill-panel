/**
 * The loading placeholder: one short group heading and four skeleton cards.
 *
 * The structure is the host Plugins page's own, so the first frame after opening
 * the panel has the same height and rhythm as the list that replaces it.
 */
import { cn } from './styles.js';

/** How many placeholder rows the skeleton draws. */
const ROWS = [0, 1, 2, 3];

/**
 * Render the loading placeholder.
 * @param {{label: string}} props - the loading label, used as the status text.
 * @returns {import('react').ReactElement} the skeleton.
 */
export function ListSkeleton({ label }) {
  return (
    <section className={cn('group')} role="status" aria-label={label} data-skc-loading="">
      <div className={cn('groupHead')} aria-hidden="true">
        <span className={cn('groupTitle', 'skeletonText', 'skeletonHeading')}>
          <span className={cn('skeletonFill', 'skeletonBar')} />
        </span>
      </div>
      <ul className={cn('cards')} aria-hidden="true">
        {ROWS.map((index) => (
          <li className={cn('card')} key={index}>
            <div className={cn('cardHead')}>
              <span className={cn('cardIcon', 'skeletonFill', 'skeletonIcon')} />
              <div className={cn('cardMain')}>
                <div className={cn('titleRow')}>
                  <span className={cn('cardTitle', 'skeletonText', 'skeletonTitle')}>
                    <span className={cn('skeletonFill', 'skeletonBar')} />
                  </span>
                </div>
                <span className={cn('cardDesc', 'skeletonText', 'skeletonDescription')}>
                  <span className={cn('skeletonFill', 'skeletonBar')} />
                </span>
              </div>
              <div className={cn('cardEnd', 'skeletonActions')} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
