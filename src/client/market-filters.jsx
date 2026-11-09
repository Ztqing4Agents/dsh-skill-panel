/**
 * The market toolbar: search box, source menu, sort menu, category chips.
 *
 * The search box is debounced here, not in the store: the store holds the text and the
 * committed keyword, and this component owns the one timer that bridges them (the host
 * market page uses the same 250ms pause). Enter and the clear button skip the timer.
 *
 * The menus are the host's `Menu` anchored on a `Button` - the same control the host's
 * market page uses for "which index" and "which sort". `portal` is skipped when there is
 * no document: a portal cannot be server-rendered, and the panel has to stay renderable
 * to a string for the structural tests.
 */
import { useEffect, useState } from 'react';
import {
  Button,
  Input,
  Menu,
  Pill,
  StateDot,
  IconChevronDownOutlineRegular,
  IconCloseOutlineRegular,
  IconSearchOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives';

import { cn } from './styles.js';
import {
  MARKET_SORTS,
  MARKET_DEFAULT_SOURCE,
  chipList,
  countText,
  sourceDescriptors,
  sourceLabelOf,
  visibleCategories,
} from './market-model.js';

/** Typing pause before the keyword is committed, in milliseconds (host value). */
const TEXT_DELAY_MS = 250;

/** A portal needs a document; without one the menu renders in place (string render). */
const CAN_PORTAL = typeof document !== 'undefined';

/**
 * One labelled menu anchored on a ghost button.
 * @param {{name: string, label: string, value: string, items: {id: string, label: string}[],
 *   menu: string|null, className?: string, onToggle: Function, onSelect: Function}} props - the
 *   menu's identity, its current value, its options, which menu is open, an optional class, and
 *   the two handlers.
 * @returns {import('react').ReactElement} the anchored menu.
 */
function Select({ name, label, value, items, menu, className, onToggle, onSelect }) {
  const open = menu === name;
  const current = items.find((item) => item.id === value);
  return (
    <Menu
      open={open}
      onClose={() => onToggle(name)}
      portal={CAN_PORTAL}
      autoFocus
      selectedId={value}
      items={items}
      onSelect={(id) => onSelect(name, id)}
      anchor={(
        <Button
          variant="ghost"
          size="sm"
          className={className}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={label}
          onClick={() => onToggle(name)}
        >
          <span className={cn('marketSelectLabel')}>{current === undefined ? label : current.label}</span>
          <IconChevronDownOutlineRegular size={12} aria-hidden="true" />
        </Button>
      )}
    />
  );
}

/**
 * Render the market toolbar and the category row.
 * @param {{market: object, t: Function, busy: boolean, onInput: Function, onCommit: Function,
 *   onFilter: Function}} props - market state, translate, whether a request is in flight,
 *   and the three handlers.
 * @returns {import('react').ReactElement} the toolbar.
 */
export function MarketFilters({ market, t, busy, onInput, onCommit, onFilter }) {
  const [menu, setMenu] = useState(null);
  const chips = visibleCategories(market);
  const selectedSource = market.filters.source ?? MARKET_DEFAULT_SOURCE;
  const selectedSort = market.filters.sort ?? MARKET_SORTS[0];
  const sourceItems = sourceDescriptors(market)
    .map((source) => ({ id: source.id, label: sourceLabelOf(source.id, t) }));
  const sortItems = MARKET_SORTS.map((value) => ({ id: value, label: t(`market.sort.${value}`) }));

  useEffect(() => {
    if (market.input === market.keyword) return undefined;
    const timer = setTimeout(() => onCommit(market.input), TEXT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [market.input, market.keyword, onCommit]);

  const onToggle = (name) => setMenu(menu === name ? null : name);
  const onSelect = (name, id) => {
    setMenu(null);
    onFilter(name === 'source' ? { source: id } : { sort: id });
  };

  return (
    <>
      <div className={cn('marketToolbar')}>
        <Input
          className={cn('marketSearch')}
          type="search"
          icon={<IconSearchOutlineRegular size={14} aria-hidden="true" />}
          value={market.input}
          placeholder={t('market.searchPlaceholder')}
          aria-label={t('market.searchLabel')}
          onChange={(event) => onInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            onCommit(event.currentTarget.value);
          }}
        />
        {market.input === '' ? null : (
          <Button
            variant="ghost"
            size="sm"
            icon={<IconCloseOutlineRegular size={13} aria-hidden="true" />}
            aria-label={t('market.clearSearch')}
            title={t('market.clearSearch')}
            onClick={() => onCommit('')}
          />
        )}
        <Select
          name="source"
          label={t('market.sourceLabel')}
          value={selectedSource}
          items={sourceItems}
          menu={menu}
          className={cn('marketSelect')}
          onToggle={onToggle}
          onSelect={onSelect}
        />
        <Select
          name="sort"
          label={t('market.sortLabel')}
          value={selectedSort}
          items={sortItems}
          menu={menu}
          onToggle={onToggle}
          onSelect={onSelect}
        />
        {busy ? (
          <span className={cn('statusWithDot')} role="status">
            <span className={cn('progressAnnouncement')}>{t('market.searching')}</span>
            <StateDot state="ongoing" size={13} />
          </span>
        ) : null}
      </div>
      {chips.visible ? (
        <div className={cn('marketChips')} role="group" aria-label={t('market.categoriesLabel')}>
          {chipList(chips.items, { total: market.total, countsOk: market.countsOk }).map((chip) => {
            const count = countText(chip.count);
            return (
              <Pill
                key={chip.value === null ? 'category-all' : chip.value}
                active={market.filters.category === chip.value}
                aria-pressed={market.filters.category === chip.value}
                onClick={() => onFilter({ category: chip.value })}
              >
                {chip.value === null ? t('market.category.all') : chip.label}
                {count === null ? null : <span className={cn('marketChipCount')}>{count}</span>}
              </Pill>
            );
          })}
        </div>
      ) : null}
      {!chips.visible && chips.unavailable
        ? <p className={cn('marketScope')}>{t('market.categoriesUnavailable')}</p>
        : null}
    </>
  );
}
