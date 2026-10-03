/** Joins the truthy class names in order; returns `undefined` when none remain. */
export function cx(...parts: readonly (string | false | null | undefined)[]): string | undefined {
  const joined = parts.filter((part) => typeof part === 'string' && part !== '').join(' ');
  return joined === '' ? undefined : joined;
}

/*
 * Shared text styles. The `eyebrow` / `lede` names stay as hooks for the contextual
 * `[&_.lede]` / `[&_.eyebrow]` variants on the game heading, the auth card and the saved-games
 * hero.
 */
/** Small uppercase kicker above a heading. */
export const eyebrowClass =
  'eyebrow mx-0 mt-0 mb-(--mb-space-2) text-meta font-bold tracking-meta text-accent uppercase';
/** Introductory paragraph under a page or card heading. */
export const ledeClass =
  'lede mx-0 mt-(--mb-space-3) mb-0 max-w-[62ch] text-[1.04rem] text-secondary';
/** Quiet supporting copy. */
export const mutedClass = 'text-muted';

export type NoticeTone = 'error' | 'success' | 'info';

/** Feedback tone surface shared by `Notice` and `Toast`. */
export const noticeToneClass: Record<NoticeTone, string> = {
  info: 'border-border bg-surface-elevated text-primary',
  success: 'border-status-border bg-status-surface text-status-text',
  error: 'border-danger-border bg-danger-soft text-danger',
};

/** Recessed banknote surface shared by `Card variant="banknote"` and the banknote auth card. */
export const banknotePanelClass =
  'rounded-card-large border border-border bg-surface-subtle text-primary';

/*
 * Button. `button`, `button-<variant>` and `icon-button` stay as hooks for the `[&_.button]`
 * parent variants and the e2e suite.
 *
 * Variant order decides the theme ties: `classic:` / `glass:` sort after the built-in state
 * variants (`active:`, `aria-*:`) but before `fine-pointer:`, so a theme colour replaces the base
 * rest and pressed colours, a hover colour still replaces the theme colour, and a theme's own
 * pressed colour is written with both variants (`glass:…:active:`).
 */
/**
 * Liquid Glass frosted control: secondary buttons, filter chips and the overflow trigger. A theme
 * rest colour has the specificity of a plain utility, so the shadow is repeated under `disabled:`
 * to outrank the core's `disabled:shadow-none`, as the old theme sheet did.
 */
export const glassControlClass = cx(
  'glass:border-[rgb(255_255_255/0.62)] glass:bg-[rgb(255_255_255/0.36)] glass:text-primary',
  'glass:shadow-[inset_0_1px_0_rgb(255_255_255/0.55),0_6px_18px_rgb(40_60_90/0.08)]',
  'glass:disabled:shadow-[inset_0_1px_0_rgb(255_255_255/0.55),0_6px_18px_rgb(40_60_90/0.08)]',
);

/** Liquid Glass frosted panel: the auth card and the table tools. */
export const glassPanelClass = cx(
  'glass:border-border glass:bg-[color-mix(in_srgb,var(--mb-color-surface-elevated)_90%,transparent)] glass:shadow-lg',
  'glass:backdrop-blur-[22px] glass:backdrop-saturate-[1.35]',
);

/** Every button: layout, type weight, motion, and the pressed/disabled states. */
export const buttonCoreClass = cx(
  'button inline-flex items-center gap-(--mb-space-2) border font-semibold',
  '[transition:transform_var(--mb-duration-fast)_var(--mb-ease-standard),box-shadow_var(--mb-duration-normal)_var(--mb-ease-standard),background-color_var(--mb-duration-fast)_var(--mb-ease-standard),border-color_var(--mb-duration-fast)_var(--mb-ease-standard),color_var(--mb-duration-fast)_var(--mb-ease-standard)]',
  '[-webkit-tap-highlight-color:transparent]',
  'not-disabled:active:transform-[translateY(1px)]',
  'disabled:transform-none disabled:opacity-48 disabled:shadow-none motion-reduce:transform-none!',
);

const buttonHoverLift =
  'fine-pointer:not-disabled:hover:transform-[translateY(-1px)] fine-pointer:not-disabled:hover:shadow-md';

/** Colour treatment per variant. */
export const buttonToneClass = {
  primary: cx(
    'button-primary border-transparent bg-accent text-on-accent shadow-sm',
    'not-disabled:active:bg-accent-pressed fine-pointer:not-disabled:hover:bg-accent-hover',
    buttonHoverLift,
    'classic:shadow-[0_5px_12px_rgb(10_63_46/0.16)] classic:disabled:shadow-[0_5px_12px_rgb(10_63_46/0.16)]',
    'glass:border-[rgb(255_255_255/0.3)] glass:text-white',
    'glass:[background:linear-gradient(180deg,rgb(48_65_86/0.8),rgb(28_41_58/0.86))]',
    'glass:shadow-[inset_0_1px_0_rgb(255_255_255/0.3),0_8px_20px_rgb(32_49_73/0.16)] glass:disabled:shadow-[inset_0_1px_0_rgb(255_255_255/0.3),0_8px_20px_rgb(32_49_73/0.16)]',
    'glass:not-disabled:active:bg-accent-pressed glass:not-disabled:active:bg-none',
    'glass:fine-pointer:not-disabled:hover:[background:linear-gradient(180deg,rgb(64_84_109/0.84),rgb(35_51_70/0.9))] glass:fine-pointer:not-disabled:hover:shadow-[inset_0_1px_0_rgb(255_255_255/0.36),0_10px_24px_rgb(32_49_73/0.2)]',
  ),
  /* Both styles replace the base border and fill, so the pressed colours are per style. */
  secondary: cx(
    'button-secondary border-border-strong bg-surface-elevated text-primary shadow-sm',
    'classic:border-highlight classic:bg-[#fff9ea] classic:dark:bg-surface-elevated',
    'classic:light:not-disabled:active:bg-surface-subtle',
    glassControlClass,
    'glass:not-disabled:active:bg-surface-subtle',
    'classic:not-disabled:active:border-accent glass:not-disabled:active:border-accent',
    buttonHoverLift,
    'fine-pointer:not-disabled:hover:border-accent',
  ),
  quiet: cx(
    'button-quiet border-transparent bg-transparent text-accent',
    'not-disabled:active:bg-accent-soft not-disabled:active:text-accent-pressed fine-pointer:not-disabled:hover:bg-accent-soft',
  ),
  danger: cx(
    'button-danger border-transparent bg-danger text-on-danger shadow-sm',
    'not-disabled:active:bg-danger-hover fine-pointer:not-disabled:hover:bg-danger-hover',
    buttonHoverLift,
  ),
} as const;

export type ButtonTone = keyof typeof buttonToneClass;

/** Standard size; feature buttons without a variant bring their own. */
export const buttonShapeClass =
  'min-h-(--mb-control-height-md) justify-center rounded-control px-(--mb-space-4) py-[10px] text-button leading-[1.15]';
/** Square icon size (`icon-button`), without the type size so a caller can set its own. */
export const iconButtonShapeClass =
  'icon-button min-h-(--mb-control-height-md) min-w-(--mb-control-height-md) justify-center rounded-md p-0';

/** Full class list of a variant button, for hand-written buttons and labels. */
export function buttonClass(tone: ButtonTone, iconOnly = false): string {
  return cx(
    buttonCoreClass,
    buttonToneClass[tone],
    iconOnly ? cx(iconButtonShapeClass, 'text-button leading-[1.15]') : buttonShapeClass,
  ) as string;
}

/** Wide dialog panel (activity, statistics); `!` outranks the Dialog panel's own width. */
export const wideDialogClass = 'w-[min(100%,760px)]!';

/**
 * Two-column action grid (one column on compact screens). `action-grid` stays as the hook for
 * the banking sheet's `[&_.action-grid]` spacing.
 */
export const actionGridClass = 'action-grid grid grid-cols-2 gap-[10px] max-md:grid-cols-1';

/** Colour swatch of a player without an avatar (`PlayerRow`, `WalletCard`). */
export const playerSwatchClass =
  'player-color inline-block size-[18px] flex-none rounded-full border-2 border-surface-elevated shadow-[0_0_0_1px_var(--mb-color-border-strong)]';

/** Elevated table-tool surface shared by `DiceRoller` and `TableCalculator`. */
export const toolPanelClass = cx(
  'grid gap-(--mb-space-4) rounded-lg border border-border bg-surface-elevated p-(--mb-space-6) shadow-sm',
  glassPanelClass,
);

/** Square key of the numeric keypad and the calculator operation buttons. */
export const keyButtonClass = cx(
  'min-h-(--mb-control-height-md) rounded-[8px] border border-border-strong bg-surface-elevated font-semibold text-primary',
  'transition-[color,background-color,border-color,translate] duration-(--mb-duration-fast) ease-standard',
  'active:translate-y-px motion-reduce:transition-none',
);
