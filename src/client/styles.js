/**
 * The page stylesheet, in one string.
 *
 * Two sources, and only two: the host's `--dsw-*` tokens, and the rule bodies of
 * the host's own Plugins page, transcribed with a `skc_` prefix. Host class names
 * are build-hashed and cannot be reused; the rule bodies are stable, so they are
 * copied verbatim instead of reinvented. Nothing here declares a `--dsw-*`
 * variable - overriding a host token is `ctx.theme.overrideTokens`'s job, and a
 * second copy would outlive an uninstall.
 *
 * The one transparent literal (`border-color:#0000`) is the host's own.
 */
/** Prefix every class of this page carries, so no host class name is reused. */
const PREFIX = 'skc_';

/** The style element identity the host lets a plugin own. */
const STYLE_ID = 'dsh-skill-center/client.css';

/**
 * Build a class name from one of this stylesheet's own keys.
 * @param {...string} names - camelCase keys declared in the stylesheet.
 * @returns {string} the class attribute value.
 */
export function cn(...names) {
  // Call sites pass optional class names (`cn('cardIcon', className)`), so a missing one
  // must simply be absent - never `skc_undefined` in the DOM. Strings keep their exact
  // old behaviour, empty string included (`cn('')` has always been `skc_`, and
  // `test/styles.test.mjs` pins that).
  return names
    .filter((name) => typeof name === 'string')
    .map((name) => `${PREFIX}${name}`)
    .join(' ');
}

/** The stylesheet text. */
const CSS = `
/* page shell */
.skc_page{
  --skc-page-inset: clamp(24px, 4vw, 48px);
  --skc-page-top-inset: 28px;
  --skc-progress-size: 14px;
  --skc-toggle-gap: 8px;
  box-sizing: border-box; height: 100%; padding: 0 var(--skc-page-inset);
  color: var(--dsw-alias-label-primary);
  display: flex; flex-direction: column; align-items: center;
}
@media (width <= 767px){ .skc_page{ --skc-page-inset: 20px } }
.skc_page > *{ flex: none; width: 100%; max-width: 960px }

/* scroll container and header bar */
.skc_pageBody{
  min-height: 0;
  width: calc(100% + 2 * var(--skc-page-inset));
  max-width: none; margin-inline: calc(-1 * var(--skc-page-inset));
  box-sizing: border-box; padding: 0 var(--skc-page-inset) 48px;
  scroll-padding-top: var(--skc-header-scroll-padding, 0px);
  display: flex; flex: 1; flex-direction: column; align-items: center; gap: 32px;
  position: relative; overflow: hidden auto;
}
.skc_pageBody > *{ flex: none; width: 100%; max-width: 960px }
.skc_pageBar{
  width: calc(100% + 2 * var(--skc-page-inset) + var(--skc-page-scrollbar-width, 0px));
  max-width: none; margin-inline: calc(-1 * var(--skc-page-inset));
  box-sizing: border-box; padding-inline: var(--skc-page-inset);
  display: flex; flex-direction: column; align-self: flex-start;
  position: relative; container: skc-page-bar / inline-size;
}
.skc_pageBar > .skc_pageHead{ align-self: center; width: 100%; max-width: 960px }
.skc_pageBody > .skc_pageBar[data-measuring]{
  visibility: hidden; pointer-events: none; margin: 0; position: absolute; top: 0; left: 0;
}
.skc_pageBody > .skc_pageBar[data-natural]{ z-index: 2; pointer-events: none; position: sticky; top: 0 }
.skc_pageBar[data-natural] .skc_pageHead{
  height: var(--skc-header-rest-height);
  clip-path: inset(0 0 max(0px, calc(var(--skc-header-rest-height) - var(--skc-header-paint-height))) 0);
  pointer-events: auto; position: relative;
}
.skc_pageBar[data-natural] .skc_pageHeading{ display: contents }
.skc_pageBar[data-natural] [data-skc-header-part]{
  left: var(--skc-part-x); top: var(--skc-part-y); width: var(--skc-part-width);
  pointer-events: auto; margin: 0; position: absolute;
}
.skc_pageBar[data-natural] .skc_pageTabs{ z-index: 2; pointer-events: none }
.skc_pageBar[data-natural] .skc_pageTabList{ pointer-events: auto }
.skc_pageBar[data-natural]:before{
  content: ""; height: var(--skc-header-paint-height, var(--skc-header-rest-height));
  background: var(--dsw-alias-bg-base); pointer-events: none; position: absolute; inset: 0 0 auto;
}
.skc_pageBar[data-natural][data-compact]:after{
  content: ""; inset-inline: 0; height: var(--skc-header-compact-height);
  box-sizing: border-box; border-bottom: .5px solid var(--dsw-alias-border-l3);
  position: absolute; top: 0;
}

/* page head */
.skc_pageHead{
  box-sizing: border-box; padding-top: var(--skc-page-top-inset);
  display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-start; gap: 16px;
}
[data-platform=darwin] .skc_pageHead{
  padding-top: calc(var(--skc-page-top-inset) + var(--dsh-frame-top-clearance, 0px));
}
.skc_pageHeading{ order: 1; min-width: 0; max-width: 100% }
.skc_pageTitle{ margin: 0; font-size: 20px; font-weight: 500; line-height: 28px }
.skc_pageIntro{
  color: var(--dsw-alias-label-secondary);
  align-items: center; gap: 4px; margin: 4px 0 0; font-size: 13px; line-height: 20px; display: flex;
}
.skc_infoButton{ width: 20px; height: 20px; color: var(--dsw-alias-label-caption); flex: none; padding: 0 }
.skc_toolbar{
  white-space: nowrap; flex-wrap: wrap; flex: 0 auto; order: 2;
  justify-content: flex-end; align-items: center; gap: 8px 16px; min-width: 0; display: flex;
}
.skc_toolbar[hidden]{ display: none }
.skc_status{ color: var(--dsw-alias-label-tertiary); margin: 0; font-size: 12px; line-height: 18px }
.skc_addButton, .skc_addPrimary, .skc_addMore{
  border-radius: var(--dsw-radius-md); height: 32px; padding: 0 12px; font-size: 13px; line-height: 20px;
}
.skc_addGroup{ flex: none; align-items: stretch; display: inline-flex }
.skc_addPrimary{ border-top-right-radius: 0; border-bottom-right-radius: 0 }
.skc_addMore{
  border-left: .5px solid color-mix(in srgb, var(--dsw-alias-label-primary-foreground) 30%, transparent);
  border-top-left-radius: 0; border-bottom-left-radius: 0; width: 32px; padding: 0;
}
.skc_pageTabs{ flex: 100%; order: 3; display: flex }
.skc_pageTabList{ width: fit-content; min-width: 240px }

/* partitions */
.skc_installedPanel{ flex-direction: column; gap: 32px; display: flex }
.skc_tabPanel{ flex-direction: column; gap: 24px; display: flex }
.skc_group{ flex-direction: column; gap: 8px; display: flex }
.skc_groupHead{ align-items: center; gap: 8px; display: flex }
.skc_groupTitle{ flex: 1; margin: 0; font-size: 14px; font-weight: 500; line-height: 22px }

/* rows */
.skc_cards{ flex-direction: column; gap: 2px; margin: 0; padding: 0; list-style: none; display: flex }
.skc_card{ border-radius: var(--dsw-radius-xl); min-width: 0; margin: 0 -8px }
.skc_cardHead{ align-items: center; gap: 14px; padding: 8px; display: flex }
.skc_cardIcon{
  box-sizing: border-box;
  border: .5px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-lg);
  width: 48px; height: 48px; flex: none;
  background: var(--skc-avatar-bg, transparent); background-clip: padding-box;
  color: var(--skc-avatar-ink, var(--dsw-alias-label-secondary));
  font-size: 17px; font-weight: 700; line-height: 1; text-transform: uppercase; user-select: none;
  justify-content: center; align-items: center; display: inline-flex;
}
.skc_cardMain{ flex-direction: column; flex: 1; gap: 4px; min-width: 0; display: flex }
.skc_titleRow{ flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; display: flex }
.skc_cardTitle{
  text-overflow: ellipsis; white-space: nowrap;
  font-size: 14px; font-weight: 500; line-height: 20px; overflow: hidden;
}
.skc_cardDesc{
  color: var(--dsw-alias-label-tertiary); display: -webkit-box;
  -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden;
  font-size: 13px; line-height: 18px;
}
.skc_cardEnd{ z-index: 1; flex: none; align-items: center; gap: 8px; display: inline-flex; position: relative }

/* switch seat, read-only tag, skeleton */
.skc_bundleToggle{ align-items: center; gap: var(--skc-toggle-gap); display: inline-flex }
.skc_toggleProgress{ width: var(--skc-progress-size); height: var(--skc-progress-size); display: inline-flex }
.skc_toggleProgress > svg{ width: 100%; height: 100% }
.skc_progressAnnouncement{
  clip-path: inset(50%); white-space: nowrap; width: 1px; height: 1px; position: absolute; overflow: hidden;
}
.skc_roTag{
  border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-secondary); height: 18px; padding: 0 6px;
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 11px; line-height: 18px; white-space: nowrap;
}
.skc_roTag > svg{ width: 12px; height: 12px; flex: none }
.skc_skeletonFill{
  background: var(--dsw-alias-bg-skeleton);
  animation: 2s cubic-bezier(.36, 0, .64, 1) infinite skc-skeleton;
}
@keyframes skc-skeleton{ 0%{opacity:1} 40%{opacity:.6} 80%,100%{opacity:1} }
@media (prefers-reduced-motion: reduce){ .skc_skeletonFill{ animation: none } }
.skc_skeletonText{ align-items: center; height: 1lh; display: flex }
.skc_skeletonBar{ border-radius: var(--dsw-radius-xs); width: 100%; height: 12px }
.skc_skeletonHeading{ width: 48px }
.skc_skeletonTitle{ width: min(144px, 60%) }
.skc_skeletonDescription{ width: min(280px, 85%) }
/* the skeleton must not inherit the avatar tile: keep its background grey on its own rule,
   so a reordering of this stylesheet cannot let --skc-avatar-bg through. background-clip
   matches .skc_cardIcon: the host border is translucent, the fill must stay under it. */
.skc_skeletonIcon{
  border-color: #0000;
  background: var(--dsw-alias-bg-skeleton); background-clip: padding-box;
}
.skc_skeletonActions{ width: calc(36px + var(--skc-toggle-gap) + var(--skc-progress-size)); height: 20px }

/* empty, failure, inline reason, footer */
.skc_empty{ color: var(--dsw-alias-label-tertiary); margin: 0; font-size: 13px; line-height: 20px }
.skc_failure{ color: var(--dsw-alias-state-error-primary); align-items: center; gap: 10px; display: flex }
.skc_failure p{ color: var(--dsw-alias-label-tertiary); margin: 0; font-size: 13px; line-height: 20px }
.skc_reason{
  color: var(--dsw-alias-state-error-primary); overflow-wrap: anywhere; white-space: pre-wrap;
  margin: 0; font-size: 12px; line-height: 18px;
}
.skc_footer{ color: var(--dsw-alias-label-tertiary); margin: 0; font-size: 13px; line-height: 20px }

/* compact state without the sticky path */
.skc_pageBar[data-compact]:not([data-natural]){ --skc-page-top-inset: 16px; padding-bottom: 16px }[data-platform=darwin] .skc_pageBar[data-compact]:not([data-natural]) .skc_pageHead{
  padding-top: var(--skc-page-top-inset);
}
[data-platform=darwin] [data-sidebar-collapsed] .skc_pageBar[data-compact]:not([data-natural]) .skc_pageHead{
  --skc-page-top-inset: 8px;
  padding-top: calc(var(--skc-page-top-inset) + var(--dsh-frame-top-clearance, 0px));
}
.skc_pageBar[data-compact]:not([data-natural]):after{
  content: ""; inset-inline: 0; border-bottom: .5px solid var(--dsw-alias-border-l3);
  pointer-events: none; position: absolute; bottom: 0;
}
.skc_pageBar[data-compact]:not([data-natural]) .skc_pageHead{ align-items: center }
.skc_pageBar[data-compact]:not([data-natural]) .skc_pageIntro{ display: none }
.skc_pageBarWithTabs[data-compact]:not([data-natural]) .skc_pageHeading{
  clip: rect(0 0 0 0); white-space: nowrap; width: 1px; height: 1px; position: absolute; overflow: hidden;
}
.skc_pageBarWithTabs[data-compact]:not([data-natural]) .skc_pageTabs{ flex: none; order: 1 }

/* narrow pages */
@container skc-page-bar (width < 600px){
  .skc_pageBarWithTabs .skc_pageHead{ align-items: center }
  .skc_pageBarWithTabs .skc_pageHeading{ flex-basis: 100% }
  .skc_pageBarWithTabs .skc_pageTabs{ flex: none; order: 2 }
  .skc_pageBarWithTabs .skc_toolbar{ order: 3 }
  .skc_toolbarLabel{ display: none }
  .skc_pageHead .skc_addButton, .skc_pageHead .skc_addPrimary{
    width: 32px; min-width: 32px; padding-inline: 0;
  }
  .skc_toolbar{ flex-shrink: 0; max-width: 100% }
}
@container skc-page-bar (width < 372px){ .skc_pageTabList{ min-width: 0 } }

/* market: toolbar and chips, transcribed from the host market's DiscoverSection.
   One departure: the host's marketButton rule carries margin-left:-8px on both menus,
   which cancels the toolbar's 8px gap twice and welds all three controls into one run
   (the search box's border then sits flush against the first menu, and a typed keyword
   welds the clear button too). Here the first menu keeps its 8px; only the trailing menu
   cancels the gap, so the two menus read as one group - see decisions, appendix K. */
.skc_marketSection{ flex-direction: column; gap: 16px; display: flex }
.skc_marketToolbar{ flex-wrap: wrap; align-items: center; gap: 8px; display: flex }
/* The search box and its clear button are one control: the button sits inside the field,
   so showing or hiding it never moves the toolbar (measured: it used to sit 8px outside the
   right edge and shorten the field by 44px). The wrapper owns the flex sizing; the host
   Input's own span keeps the padding that the button floats over. */
.skc_marketSearchField{
  min-width: 120px; flex: 1; align-items: center; display: flex; position: relative;
}
.skc_marketSearch{
  padding-right: 32px; box-sizing: border-box; width: 100%; min-width: 0;
}
/* The input is type=search, so Blink paints its own cancel button inside the field the
   moment a keyword is typed - right beside the clear button this panel draws itself
   (which is the one with a label and a title). Keep ours, drop the native one. */
.skc_marketSearch input::-webkit-search-cancel-button{ -webkit-appearance: none; appearance: none; display: none }
.skc_marketClear{
  display: flex; position: absolute; top: 50%; right: 5px; transform: translateY(-50%);
  align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0;
  border: 0; border-radius: var(--dsw-radius-sm); background: 0 0; cursor: pointer;
  color: var(--dsw-alias-label-secondary); font: inherit;
}
@media (hover: hover){
  .skc_marketClear:hover{
    color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover);
  }
}
.skc_marketClear:focus-visible{
  outline: var(--dsw-focus-ring-width) solid
    var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px;
}
.skc_marketSelect{ max-width: 240px; font-weight: 500 }
/* A ghost button paints no box, so the gap between the two menus reads as the gap plus
   the trailing menu's own 10px inset: 8 + 10 = 18, against the 8 that separates the
   search box (which does paint a border) from the first menu. Cancel the gap for the
   trailing menu only - the pair then reads 8 / 10, and the boxes stay adjacent instead of
   the host's weld-everything -8 on both. */
.skc_marketSelectTrailing{ margin-left: -8px }
.skc_marketSelectLabel{ text-overflow: ellipsis; white-space: nowrap; overflow: hidden }
.skc_marketChips{ flex-wrap: wrap; align-items: center; gap: 6px; display: flex }
.skc_marketScope{ color: var(--dsw-alias-label-tertiary); margin: 0; font-size: 13px; line-height: 20px }
.skc_marketNotice{
  border-radius: var(--dsw-radius-md); background: var(--dsw-alias-state-warn-tertiary);
  color: var(--dsw-alias-label-secondary); align-items: flex-start; gap: 8px;
  margin: 0; padding: 10px 12px; font-size: 12px; line-height: 18px; display: flex;
}
.skc_marketNotice > svg{ color: var(--dsw-alias-state-warn-primary); flex: none; margin-top: 2px }

/* market: the grid and the card */
.skc_marketGrid{
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px;
  margin: 0; padding: 0; list-style: none; display: grid;
}
/* the upstream icon inside the untouched .skc_cardIcon box: a flex child, so it fills
   the *content* box and the .5px hairline still paints on top of it; the radius is the
   concentric inner one (the host box radius minus that hairline) */
/* contain, not cover: upstream icons come from a mixed bag of sources whose dimensions
   range from a 256x64 wordmark to 1024x1024, and cropping a wordmark into a square is
   worse than showing it whole on the pastel bed. Square icons look identical. */
.skc_marketIconImg{
  border-radius: calc(var(--dsw-radius-lg) - .5px); width: 100%; height: 100%;
  object-fit: contain; display: block;
}
/* the chip count rides inside the pill: 4px from the label, secondary, one step down in
   size - the pill's own height and hit area stay exactly as the primitive draws them */
.skc_marketChipCount{
  margin-left: 4px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px;
}
.skc_marketCard{
  border-radius: var(--dsw-radius-xl); align-items: stretch; gap: 8px; min-width: 0;
  padding: 14px; flex-direction: column; display: flex; position: relative;
}
@media (hover: hover){ .skc_marketCard:hover{ background: var(--dsw-alias-interactive-bg-hover) } }
/* the card's head: the 48px tile, the title/byline block and the one action seat in a
   single row. nowrap is the flex default and is what keeps the seat on this row: when the
   install label grows ("installing" is the widest of the four) the block shrinks into an
   ellipsis instead of pushing the seat to a second line. */
.skc_marketHead{ align-items: center; gap: 12px; min-width: 0; display: flex }
/* one rhythm inside the card: this gap is 8px, the same value the card itself uses between
   the head and this block, so all three gaps (head -> description -> tags -> figures) are
   8px and each has exactly one source. */
.skc_marketBody{ flex-direction: column; gap: 8px; min-width: 0; display: flex }
.skc_marketMain{ flex-direction: column; flex: 1; gap: 2px; min-width: 0; display: flex }
/* the title row is as wide as its content, not as wide as the block: align-self keeps it
   from being stretched by the column parent, so the source mark sits one 8px gap after the
   title instead of being pushed to the far right of the block. max-width:100% keeps a long
   title inside the card, and min-width:0 lets it ellipsise (the mark never shrinks).
   nowrap is load-bearing: a wrapping container breaks lines on the flex base size *before*
   any shrinking happens, so a long title would push the mark onto a second line (measured on
   two real cards: 20px row grew to 44px) instead of ellipsising. This row has exactly two
   children - the title and the mark - and nothing to wrap. */
.skc_marketTitleRow{
  flex-wrap: nowrap; align-items: center; gap: 8px; min-width: 0;
  align-self: flex-start; max-width: 100%; display: flex;
}
/* flex:0 1 auto - grow 0 (the title takes its content width, so the mark stays right after
   it), shrink 1 with min-width:0 (a long title gives way and ellipsises instead of pushing
   the mark or the action seat onto a second line). */
.skc_marketCardOpen{
  max-width: 100%; color: inherit; font: inherit; text-align: left; cursor: pointer;
  text-overflow: ellipsis; white-space: nowrap; background: 0 0; border: 0; padding: 0;
  flex: 0 1 auto; min-width: 0; font-size: 14px; font-weight: 500; line-height: 20px; overflow: hidden;
}
.skc_marketCardOpen::after{ content: ""; border-radius: var(--dsw-radius-xl); position: absolute; inset: 0 }
.skc_marketCardOpen:focus-visible{ outline: none }
.skc_marketCardOpen:focus-visible::after{
  outline: var(--dsw-focus-ring-width) solid
    var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
}
/* why 13/20: the leading is the loose end of the card's type scale on purpose - the three
   gaps are 8px, so the breathing room lives inside the paragraph and the block still reads as
   one piece. 20 is already on the scale (the title is 14/20), so no fourth line-height joins
   the card; three lines measure 60px.
   why the zero margin cannot be dropped: this is a <p> and the UA's 1em adds 13px above
   and below, which reads as a loose block and costs 26px of card height. all spacing here
   comes from the gaps (8px above and below). */
.skc_marketDesc{
  margin: 0; color: var(--dsw-alias-label-tertiary); -webkit-line-clamp: 3;
  -webkit-box-orient: vertical; font-size: 13px; line-height: 20px;
  display: -webkit-box; overflow: hidden;
}
/* the author line stays one line: an owner/slug handle can reach 129 characters, and
   letting it wrap would grow the head from 48px to 66px and jump the card height */
.skc_marketMeta{
  color: var(--dsw-alias-label-tertiary); margin: 0; text-overflow: ellipsis;
  white-space: nowrap; overflow: hidden; font-size: 12px; line-height: 18px;
}
/* market: the card's figures - three equal-width slots, rating / downloads / saves.
   The slots are fixed-width and always three, so the same column lands on the same x in
   every card of a row (they are empty, not absent, when a source does not report a
   number). tabular-nums keeps 1 and 8 the same width inside a slot. */
.skc_marketStats{
  grid-template-columns: repeat(3, minmax(0, 72px)); gap: 8px; justify-content: start;
  margin: 0; color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums;
  font-size: 12px; line-height: 18px; display: grid;
}
.skc_marketStat{
  align-items: center; gap: 3px; min-width: 0; white-space: nowrap;
  text-overflow: ellipsis; overflow: hidden; display: inline-flex;
}
.skc_marketStat > svg{ width: 13px; height: 13px; flex: none; opacity: .75 }
.skc_marketStatValue{ min-width: 0; overflow: hidden; text-overflow: ellipsis }
/* the source's own brand mark, 16px: a 32x32 PNG at 2x. Decoration, not a control. */
.skc_marketSourceMark{ border-radius: var(--dsw-radius-sm); width: 16px; height: 16px; flex: none; display: block }
/* tag chips: one line of rounded hairline boxes, tertiary text one step below the meta
   line. Wrapping is allowed (three labels can still exceed a 280px card) but each chip is
   clamped, so no single long topic can stretch the row. */
.skc_marketTags{ flex-wrap: wrap; gap: 6px; min-width: 0; margin: 0; padding: 0; display: flex; list-style: none }
.skc_marketTag{
  border: .5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm);
  color: var(--dsw-alias-label-tertiary); max-width: 100%; padding: 1px 6px;
  font-size: 11px; line-height: 16px; white-space: nowrap;
  text-overflow: ellipsis; overflow: hidden;
}
/* the one action seat: it sits in the head row, so its vertical position comes from the
   head's align-items; a flex-end self-alignment would push the button to the row's bottom and
   grow the row. z-index:1 floats it above the card-wide click layer (do not drop it). */
.skc_marketCardEnd{
  z-index: 1; flex: none; align-items: center; gap: 8px;
  display: inline-flex; position: relative;
}

/* market: empty, failure, tail */
.skc_marketEmpty{
  text-align: center; flex-direction: column; align-items: center; gap: 8px;
  padding: 64px 0; display: flex;
}
.skc_marketEmptyTitle{ margin: 8px 0 0; font-size: 14px; font-weight: 500; line-height: 20px }
.skc_marketEmpty > button{ margin-top: 8px }
.skc_marketError{
  color: var(--dsw-alias-state-error-primary); align-items: center; gap: 6px;
  margin: 0; font-size: 13px; line-height: 20px; display: inline-flex;
}
.skc_marketFailure{ align-items: center; gap: 10px; display: flex }
/* The list's own footers. skc_marketMore carries "no more" and the retry button;
   skc_marketLoadMore is the "loading" row - same rhythm, but it holds a dot and words
   rather than a control, so it centres them itself. */
.skc_marketMore{ align-self: center }
.skc_marketLoadMore{
  align-items: center; justify-content: center; gap: 6px; padding-top: 8px; display: flex;
  color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px;
}

/* market: the inline detail */
.skc_marketDetail{ flex-direction: column; gap: 16px; display: flex }
.skc_marketCrumb{
  color: var(--dsw-alias-label-tertiary); font: inherit; cursor: pointer; background: 0 0; border: 0;
  align-self: flex-start; align-items: center; gap: 6px; padding: 0; font-size: 12.5px; display: inline-flex;
}
@media (hover: hover){ .skc_marketCrumb:hover{ color: var(--dsw-alias-label-primary) } }
.skc_marketCrumb:focus-visible{
  outline: var(--dsw-focus-ring-width) solid
    var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
}
.skc_marketCrumbIcon{ transform: rotate(90deg) }
.skc_marketDetailHead{ align-items: center; gap: 14px; display: flex }
.skc_marketDetailTitle{ margin: 0; font-size: 20px; font-weight: 500; line-height: 28px }
.skc_marketDetailDesc{
  color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; margin: 0;
  font-size: 14px; line-height: 22px;
}
.skc_marketDetailSection{ flex-direction: column; gap: 12px; margin-top: 16px; display: flex }
.skc_marketSectionTitle{ margin: 0; font-size: 14px; font-weight: 500; line-height: 20px }
.skc_marketFacts{ margin: 0 }
.skc_marketFacts div{
  border-bottom: .5px solid var(--dsw-alias-border-l2); justify-content: space-between;
  align-items: center; gap: 16px; min-height: 44px; padding: 8px 2px; display: flex;
}
.skc_marketFacts dt{ color: var(--dsw-alias-label-secondary); flex: none; font-size: 13px; line-height: 20px }
.skc_marketFacts dd{
  text-align: end; overflow-wrap: anywhere; min-width: 0; margin: 0; font-size: 13px; line-height: 20px;
}
.skc_marketFacts code{
  background: var(--dsw-alias-bg-module-platform); box-decoration-break: clone;
  font-family: var(--ds-font-family-code); border-radius: 4px; padding: 2px 6px; font-size: 12px;
}
.skc_marketFiles{ margin: 0; padding: 0; list-style: none }
.skc_marketFiles li{
  border-bottom: .5px solid var(--dsw-alias-border-l2); justify-content: space-between;
  align-items: center; gap: 16px; min-height: 32px; padding: 6px 2px;
  font-size: 13px; line-height: 20px; display: flex;
}
.skc_marketFileName{
  overflow-wrap: anywhere; min-width: 0; font-family: var(--ds-font-family-code);
  font-size: 12px; line-height: 18px;
}
.skc_marketFileSize{ color: var(--dsw-alias-label-tertiary); flex: none; font-size: 12px; line-height: 18px }

/* market: confirm dialog and skeleton */
.skc_marketDialog{ width: min(480px, 100vw - 32px) }
.skc_marketConfirmBody{ flex-direction: column; gap: 12px; display: flex }
.skc_marketConfirmHead{ align-items: center; gap: 14px; display: flex }
.skc_marketSkeletonChip{ border-radius: var(--dsw-radius-lg); width: 64px; height: 26px }
.skc_marketSkeletonAction{ border-radius: var(--dsw-radius-md); width: 64px; height: 24px }
/* three figure placeholders in the real row's rhythm; the bed is the shared skeleton fill */
.skc_marketSkeletonStat{ border-radius: var(--dsw-radius-xs); width: 56px; height: 12px }
/* the tag placeholder is the real chip's box (48x19), so the skeleton keeps the body's rhythm */
.skc_marketSkeletonTag{ border-radius: var(--dsw-radius-sm); width: 48px; height: 19px }
.skc_marketToastHint{
  color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere;
  margin-top: 2px; font-size: 12px; line-height: 18px; display: block;
}
`;

/**
 * Install the stylesheet once per document, keyed by the plugin's own hook.
 * @returns {void}
 */
export function injectStyles() {
  if (typeof document === 'undefined') return;
  const selector = `style[data-plugin-css=${JSON.stringify(STYLE_ID)}]`;
  if (document.querySelector(selector) !== null) return;
  const tag = document.createElement('style');
  tag.dataset.pluginCss = STYLE_ID;
  tag.textContent = CSS;
  document.head.appendChild(tag);
}
