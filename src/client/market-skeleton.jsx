/**
 * The market's loading placeholder: the chip row and the card grid, in the same rhythm
 * as the list that replaces them.
 *
 * The bars reuse the installed tab's skeleton classes (`skc_skeletonFill` /
 * `skc_skeletonBar`), so the breathing animation and its reduced-motion switch are
 * shared rather than copied; only the market's own boxes are new.
 */
import { cn } from './styles.js';

/** How many placeholder cards the first screen draws: two rows of three at full width. */
const FIRST_SCREEN = [0, 1, 2, 3, 4, 5];

/** How many placeholder cards are appended while the next page is in flight. */
const TAIL = [0, 1, 2];

/** How many category chips the skeleton stands in for. */
const CHIPS = [0, 1, 2, 3, 4, 5];

/**
 * One placeholder card.
 * @returns {import('react').ReactElement} the card's skeleton.
 */
function SkeletonCard() {
  return (
    <li className={cn('marketCard')} aria-hidden="true">
      <div className={cn('marketMain')}>
        <div className={cn('marketTitleRow')}>
          <span className={cn('cardIcon', 'skeletonFill', 'skeletonIcon')} />
          <span className={cn('skeletonText', 'skeletonTitle')}>
            <span className={cn('skeletonFill', 'skeletonBar')} />
          </span>
        </div>
        <span className={cn('skeletonText', 'skeletonDescription')}>
          <span className={cn('skeletonFill', 'skeletonBar')} />
        </span>
      </div>
      <div className={cn('marketCardEnd')}>
        <span className={cn('skeletonFill', 'marketSkeletonAction')} />
      </div>
    </li>
  );
}

/**
 * The category row's place, drawn while `bootstrap` is in flight.
 * @returns {import('react').ReactElement} six chip-shaped bars.
 */
export function MarketChipsSkeleton() {
  return (
    <div className={cn('marketChips')} aria-hidden="true">
      {CHIPS.map((index) => (
        <span className={cn('skeletonFill', 'marketSkeletonChip')} key={index} />
      ))}
    </div>
  );
}

/**
 * The first screen's placeholder.
 * @param {{label: string}} props - the status text screen readers announce.
 * @returns {import('react').ReactElement} the skeleton grid.
 */
export function MarketSkeleton({ label }) {
  return (
    <ul className={cn('marketGrid')} role="status" aria-label={label} aria-busy="true">
      {FIRST_SCREEN.map((index) => <SkeletonCard key={index} />)}
    </ul>
  );
}

/**
 * The three cards that hold the bottom row while the next page loads.
 * @returns {import('react').ReactElement[]} three placeholder cards, to place inside the grid.
 */
export function MarketTailSkeleton() {
  return TAIL.map((index) => <SkeletonCard key={index} />);
}
