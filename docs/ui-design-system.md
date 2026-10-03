# Monopoly Bank UI design system

## Authority and scope

This document is the single source of truth for Monopoly Bank UI design. It
governs visual styles, colour modes, semantic tokens, responsive behaviour,
overlays, motion, accessibility, and visual validation. Agent instructions,
skills, screenshots, tests, and the current CSS implementation must point here
instead of defining a competing visual contract.

The current implementation follows the responsive layout composition and page
patterns described below. The application uses one shared DOM and state flow per page
across viewport sizes; only presentation changes between compact, medium, and
wide layouts.

Product and interaction decisions remain outside the style system:

- Monopoly Bank is a banking companion for an in-person Monopoly game, not a
  board-game engine.
- Banking behaviour, permissions, validation, ledger semantics, and game
  lifecycle must not vary by visual style or colour mode.
- English and Ukrainian, PWA behaviour, keyboard access, screen-reader
  semantics, and reduced-motion support are invariants.

When another source conflicts with this document, this document wins for UI
design. A screenshot is evidence of a build, not design authority.

## Two independent preferences

Visual style and colour mode are orthogonal. Never encode one in the other.

### Visual style

A visual style defines the product's aesthetic expression: materials, colour
families, typography, shape, depth, imagery, and optional presentation effects.

| Style ID          | Status                           | Intent                                                                                   |
| ----------------- | -------------------------------- | ---------------------------------------------------------------------------------------- |
| `classic-bank`    | Implemented                      | A modern, premium interpretation of classic Monopoly banking.                            |
| `liquid-glass`    | Implemented                      | Translucent, refractive surfaces with an optional reduced-motion-safe pointer highlight. |
| `minimal-finance` | Future architecture example only | A possible restrained finance presentation.                                              |

New styles must be registered; page components must not gain style-specific
business branches.

Minimal Finance and any additional styles remain architectural roadmap examples.
Classic Bank and Liquid Glass are the currently implemented styles.

### Colour mode

Colour mode controls luminance and contrast within the selected visual style:

- `light`: always use that style's light token set;
- `dark`: always use that style's dark token set;
- `system`: follow `prefers-color-scheme` and react to operating-system changes.

`system` is a stored preference, not a third rendered palette. The resolved
mode is always `light` or `dark`. Every registered style must supply and test
both resolved modes.

## Implemented architecture

Appearance lives entirely in the browser. No API, database, or domain contract
is involved.

```text
Device preferences
  visualStyle: VisualStyleId
  colorMode: light | dark | system
             |
             v
UI preference controller (application shell only)
  resolves system mode and mounts the style's effect adapter
             |
             v
<html data-visual-style="classic-bank" data-color-mode="light">
             |
             v
style registry -> style token sheet (--mb-*) -> Tailwind theme bridge
               -> UI kit (src/components/ui/) + domain composites -> pages
```

`src/appearance/visual-styles.ts` owns `VisualStyleId`, the typed
`VisualStyleDefinition` registry, validation, and the default style. Each entry
has an `id`, localized `labelKey`, `supportedCapabilities`, and `mountEffects`.
The ID is also the root `data-visual-style` value and CSS selector; a second
attribute/class name is unnecessary. The registry contains `classic-bank` and
`liquid-glass`.

`mountEffects` receives a shell-owned context containing the root, owning
document, and lazy reduced-motion query. Page components never provide effect
inputs. Capabilities are descriptive metadata: `translucentSurfaces`,
`pointerReactiveEffects`, `deviceTiltEffects`, and `richBackgroundEffects`.
Classic Bank declares none. Nothing probes sensors or installs effect listeners
based on these names. Its adapter does not access the lazy motion query and
returns a no-op cleanup.
A future adapter owns its effect lifecycle and returns a cleanup that releases
all listeners, animation frames, and temporary properties. It must enforce the
accessibility and permission rules below, including live reduced-motion changes.

`src/appearance/appearance-controller.ts` sets the root attributes and resolves
`ColorMode` (`light | dark | system`) into `ResolvedColorMode` (`light | dark`).
It subscribes to system colour-scheme changes only in system mode and releases
that listener and the style adapter on cleanup. `src/main.tsx` applies validated
preferences before React renders; `App.tsx` manages the mounted controller in a
layout effect keyed only by style and mode. Sound, vibration, language, and
route changes do not restart it. The HTML has a static Classic Bank/light
fallback. No `data-theme` attribute or page-specific theme checks remain.

Stylesheets are imported statically from `src/index.css`. Each registered style
has a token sheet scoped by style and resolved mode. The UI itself is styled
with Tailwind CSS v4 utilities in the TSX; see [Styling implementation](#styling-implementation).

To add a style in a future phase:

1. Extend `VisualStyleId` and register its metadata and optional effect adapter.
2. Supply a style-scoped stylesheet with the semantic roles in both modes and
   add its import to `src/index.css`.
3. Add EN/UK labels. `AppearanceSettings` enumerates the registry automatically.
4. Validate the shared components, accessibility, migration fallback, and visual
   matrix for that style. Business pages require no changes.

Do not accept arbitrary style IDs, stylesheet URLs, or user-authored CSS.

The application shell owns preference loading, validation, persistence, system
mode resolution, root attributes, and optional effect controllers. Pages and
domain components consume semantic roles and remain unaware of the active
style. A style change must not remount a game, clear form state, reconnect a
WebSocket, or alter a banking request.

Device-only appearance preferences should remain local unless a later product
requirement explicitly introduces account sync. Frontend preference
persistence does not justify Worker, D1, or Durable Object changes by itself.
Unknown or retired stored values must fall back to `classic-bank` and `system`.
The existing `monopoly-bank-device-preferences` localStorage key now holds
`{ visualStyle, colorMode, sound, vibration }`. On read, a valid `colorMode`
takes precedence; otherwise the legacy `theme` value is used if valid. Missing
or unknown styles become `classic-bank`. Sound and vibration retain their
existing values/defaults. Saving writes the new shape under the same key;
the language preference remains in its existing separate key. Storage failures
are nonfatal and use in-memory defaults. No settings are deliberately reset.

`src/components/AppearanceSettings.tsx` renders independent, labelled controls
for Visual style and Appearance. The existing shell settings also retain
Language, Sound, and Vibration. Only registered, implemented styles appear.

The shell may update the document `theme-color` metadata for the resolved style
and mode. The web manifest must retain a valid static fallback, and style-asset
changes must preserve the service worker's install and update behaviour.

## Semantic styling contract

Shared UI code describes purpose, not a particular material. Tokens should be
organised into three layers:

1. **Foundation tokens**: raw palette, type families, spacing, radii, shadows,
   blur, opacity, and motion values owned by one style.
2. **Semantic tokens**: canvas, surface, elevated surface, text, muted text,
   border, focus, primary action, danger, positive, negative, and overlay roles.
3. **Component tokens**: narrowly scoped aliases used only where a shared
   component needs them.

Page and feature CSS must consume semantic or component tokens. Raw visual
values belong in a style's token layer, except for data-driven player colours
and intrinsically graphical assets. State must never be communicated by colour
alone.

Typography follows semantic roles rather than per-component font declarations.
Every chosen face and fallback must render English and Ukrainian completely and
legibly. The bundled `@fontsource-variable/inter` package supplies Inter
Variable locally; no font is requested from a CDN at runtime. Liquid Glass
allows Apple platforms to resolve their native system font before the bundled
Inter fallback.

Layout primitives, focus behaviour, and overlay semantics are shared. A visual
style may change their presentation, but not reading order, accessible names,
focus management, dismissal behaviour, or the meaning and order of actions.

### Styling implementation

The UI is styled with Tailwind CSS v4 utilities written in the TSX, on top of
Headless UI v2 for dialogs, menus, tabs, switches, and radio groups. There are no
per-component stylesheets.

- **Tokens.** Each style sheet in `src/styles/visual-styles/` defines the
  `--mb-*` custom properties for its style and both resolved modes. These are the
  only runtime design values. `src/styles/tailwind-theme.css` is a pure bridge:
  its `@theme inline` block maps Tailwind theme names to `var(--mb-…)` (for
  example `bg-surface-elevated` → `--mb-color-surface-elevated`,
  `text-muted` → `--mb-color-text-muted`, `rounded-card` → `--mb-radius-card`,
  `shadow-md` → `--mb-shadow-md`, `ease-emphasized` → `--mb-ease-emphasized`). It
  never holds literal values, so every utility follows the root attributes at
  runtime. Spacing, layout, control, and duration tokens that have no theme
  name are used directly, for example `gap-(--mb-space-4)`,
  `min-h-(--mb-control-height-md)`, or `duration-(--mb-duration-normal)`. The
  theme defines only the two breakpoints the layout groups need: `md` (48rem)
  and `lg` (64rem).
- **Style and mode differences are variants.** `src/index.css` registers
  `classic:` and `glass:`, which follow `data-visual-style`, and `dark:` and
  `light:`, which follow the resolved `data-color-mode` and never
  `prefers-color-scheme`. It also registers the media variants `fine-pointer:`,
  `forced-colors:`, and `short-landscape:`. Tailwind's `motion-safe:` and
  `motion-reduce:` cover reduced motion. Classic Bank and Liquid Glass differ
  only through these variants on the same element, for example
  `glass:backdrop-blur-[26px] glass:forced-colors:backdrop-filter-none`, and
  through their token values. No selector overrides one component per style,
  and no page contains a style branch.
- **Cascade.** Everything Tailwind emits lives in cascade layers
  (`theme, base, components, utilities`). Preflight is deliberately not imported.
  The few remaining rules in `src/styles/` are unlayered, so they beat
  utilities. That is why a utility that must override one of them carries `!`.
- **Semantic hook classes.** Class names such as `dialog`, `dialog-backdrop`,
  `wallet-card`, `game-card`, `settings-panel`, and `app-header` stay on their
  elements. They are hooks for the e2e suites, unit tests, and the remaining CSS,
  not styling APIs. Do not style new UI through them.

### UI-kit contract

`src/components/ui/` is the UI kit. Build new UI from it before writing new
markup:

- primitives: `Button`, `Field` (with `FieldHint` and `FieldError`), `Card`,
  `Notice`, `StatPill`, `MoneyValue`, `SegmentedControl`, `Toggle`, `Row`,
  `Toolbar`, `EmptyState`, `PageShell`, `ToolPanel`, `BankSeal` (the decorative
  `MB` seal of the header, offline shell, auth cards, and saved-game cards), the
  auth-card parts `AuthHeading` and `AuthForm`, and the text roles `Eyebrow`,
  `Lede`, and `MutedText`;
- dialog parts, used inside `src/components/Dialog.tsx`: `DialogBody` and
  `DialogActions`;
- feedback: `FeedbackProvider` (`ToastRegion.tsx`), `Toast`, and the
  `useFeedback()` hook;
- `class-names.ts`: shared class recipes (`cx`, button cores and tones, notice
  tones, `wideDialogClass`, `actionGridClass`) for the rare case where a
  component must style a foreign element.

The kit's rules:

- Kit components take semantic props (`variant`, `tone`, `size`), never colour
  or raw-value props. A caller's `className` is for layout placement (grid
  column, spacing, width), not for restyling the component.
- Domain composites live in `src/components/game/`. Page-local subcomponents stay
  in their page file.
- Every visible string and accessible name comes from `useLanguage().t`.
- Transient success and information messages go through `useFeedback()`. The
  single region is mounted in `App.tsx`: success and information toasts sit in
  a `polite` live stack and auto-dismiss after 6 s, pausing while the pointer or
  focus is on the toast; errors sit in an `assertive` stack and stay until
  dismissed. Form validation and submit errors stay inline beside their form and
  are never also toasted.

### Remaining CSS and why

`src/styles/` holds only what utilities cannot express, or cannot express
without losing a cascade guarantee:

- `visual-styles/classic-bank.css` and `visual-styles/liquid-glass.css`: the
  `--mb-*` token sets for each mode. Liquid Glass also has its ambient background
  drift (`@keyframes liquid-ambient`, stopped under reduced motion) and the
  pointer-highlight pseudo-element on game cards, which is driven by the
  shell-level effect controller.
- `layout.css`: the shell's safe-area padding (`env(safe-area-inset-*)`,
  `--mb-app-safe-*`) and the iOS `@supports (-webkit-touch-callout: none)` block,
  which raises `--mb-app-safe-top` in standalone portrait mode.
- `primitives.css`: the base-layer focus ring and form-control skin, which
  utilities on an element may override, plus the unlayered `.game-form`,
  `.dialog-field`, calculator-input, and settings-options rules that the forms
  share.
- `features.css`: SVG-specific QR rendering and the amount-input suffix
  clearance.
- `non-game-pages.css`: avatar-picker rules that must outrank `.game-form`, and
  the Classic overflow-menu keyframes.
- `src/index.css`: the layer order, the Tailwind imports, the custom variants,
  the `--mb-app-safe-*` inputs, document base styles, and native `color-scheme`.

New CSS belongs here only for effects that utilities cannot express, such as
keyframes, SVG presentation attributes, `@supports` platform fixes, or a
pseudo-element driven by an effect controller.

## Classic Bank visual specification

Classic Bank should feel premium, tactile, financially trustworthy, and lightly
playful. It uses warm ivory space, crisp pale surfaces, deep bank green, and
small brass details. It must not use fake paper texture, glassmorphism, heavy
outlines, cartoon typography, or gold as a general-purpose action colour.
Elevation is reserved for interactive or layered hierarchy; ordinary content
grouping should prefer spacing and subtle surface contrast.

### Token contract

`src/styles/visual-styles/classic-bank.css` is the implemented source for exact
values. UI code must use the following roles rather than adding raw palette
names. The custom properties on `:root` are the `--mb-*` names in the table.
The `--color-*` names exist only as Tailwind theme keys in
`src/styles/tailwind-theme.css`, which map each role to its `--mb-color-*`
property and give it a utility name (`--color-surface-elevated` →
`bg-surface-elevated`, `--text-color-muted` → `text-muted`, and so on). They are
not custom properties at runtime, so never write `var(--color-…)`.

| Group               | Tokens (`:root` custom properties)                                                                                                                                                             | Utility names                                                                    | Contract                                                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Canvas and surfaces | `--mb-color-canvas`, `--mb-color-surface-elevated`, `--mb-color-surface-subtle`, `--mb-color-surface-inverse`, `--mb-color-surface-inverse-elevated`                                           | `bg-canvas`, `bg-surface-elevated`, `bg-surface-subtle`, `bg-surface-inverse`, … | Ivory canvas and clean neutral surfaces in light mode; deep neutral-green canvas and progressively lighter green-neutral surfaces in dark mode. |
| Text                | `--mb-color-text-primary`, `--mb-color-text-secondary`, `--mb-color-text-muted`, `--mb-color-text-on-accent`, `--mb-color-text-on-danger`, `--mb-color-text-on-inverse`                        | `text-primary`, `text-secondary`, `text-muted`, `text-on-accent`, …              | Primary content, supporting copy, de-emphasized metadata, and contrast-safe text on filled roles.                                               |
| Structure           | `--mb-color-border`, `--mb-color-border-strong`, `--mb-color-dialog-divider`                                                                                                                   | `border-border`, `border-strong`, `border-dialog-divider`                        | Use the quiet border by default. Strong borders are for selected, interactive, or unusually dense boundaries.                                   |
| Brand/action        | `--mb-color-accent`, `--mb-color-accent-hover`, `--mb-color-accent-pressed`, `--mb-color-accent-soft`                                                                                          | `bg-accent`, `text-accent`, `bg-accent-soft`, …                                  | Deep premium green in light mode and a brighter accessible green in dark mode. This is the primary action and selection family.                 |
| Highlight           | `--mb-color-highlight`                                                                                                                                                                         | `text-highlight`, `border-highlight`                                             | Muted brass for compact identity details and limited emphasis; never the default control fill.                                                  |
| Feedback            | `--mb-color-danger`, `--mb-color-danger-hover`, `--mb-color-danger-soft`, `--mb-color-success`, `--mb-color-success-soft`, plus the `--mb-color-status-*` and `--mb-color-danger-border` roles | `text-danger`, `bg-danger-soft`, `bg-success-soft`, `text-status-text`, …        | Restrained red for destructive/error states and green for positive/live states. Always pair colour with text, iconography, or semantics.        |
| Player identity     | `--mb-color-player-red`, `--mb-color-player-blue`, `--mb-color-player-green`, `--mb-color-player-orange`, `--mb-color-player-purple`, `--mb-color-player-teal`, `--mb-color-text-on-player`    | `bg-player-red`, …, `text-on-player`                                             | Stable values matching persisted player colours. Keep all six distinguishable in both modes.                                                    |
| Focus and overlay   | `--mb-color-focus-ring`, `--mb-color-focus-halo`, `--mb-color-overlay`, `--mb-focus-ring`                                                                                                      | `outline-focus-ring`, `bg-overlay`                                               | Brass focus treatment remains visible on light, dark, and inverse surfaces. Classic Bank overlays are opaque and must not blur content.         |

The resolved core palette is:

| Role                     | Light                             | Dark                                 |
| ------------------------ | --------------------------------- | ------------------------------------ |
| Canvas                   | `#f4efdf`                         | `#091d18`                            |
| Elevated surface         | `#fff9ea`                         | `#102a23`                            |
| Subtle surface           | `#f6f0df`                         | `#1a3b31`                            |
| Primary text             | `#10372e`                         | `#f8f4e8`                            |
| Secondary text           | `#50675e`                         | `#c4cec8`                            |
| Muted text               | `#75867f`                         | `#8fa39a`                            |
| Border / strong border   | `#d9cead` / `#9baf9f`             | `rgb(220 202 151 / .22)` / `#547166` |
| Accent / hover / pressed | `#126247` / `#176f51` / `#0b4a38` | `#4fa779` / `#65b98b` / `#3d8d65`    |
| Accent soft              | `#e6f0e9`                         | `#193b2d`                            |
| Highlight                | `#c5a34d`                         | `#d0ae58`                            |
| Danger / hover / soft    | `#c94d56` / `#98363d` / `#f8e7e8` | `#e06d75` / `#ef8188` / `#43242a`    |
| Success / soft           | `#2e9b68` / `#e4f2e9`             | `#6eb88b` / `#173928`                |
| Focus ring               | `#8b6322`                         | `#d5b86f`                            |

Dark mode is designed independently; do not derive it by inversion. Stable
player values are red `#d83f55`, blue `#2878d0`, green `#238b57`, orange
`#d97721`, purple `#8b4cc5`, and teal `#087f78`.

### Typography

Classic Bank uses bundled Inter Variable with robust local fallbacks, so
Ukrainian glyph coverage and PWA startup do not depend on a network font:

- `--mb-font-body` / `--mb-font-ui` (`font-body`, `font-ui`): body copy and
  controls;
- `--mb-font-display` (`font-display`): page and section headings;
- `--mb-font-money` (`font-money`): balances and transaction values with tabular
  numerals.

The responsive roles are display `clamp(2.625rem, 4vw, 4rem)` (mobile may
resolve through `clamp(2.125rem, 10vw, 2.875rem)`), large heading
`clamp(1.45rem, 3vw, 2rem)`, medium heading `1.2rem`, body `1rem`, small
`.875rem`, meta `.78rem`, large money `clamp(1.55rem, 5vw, 2.25rem)`, hero
money `clamp(2.45rem, 10vw, 4rem)`, and button `.9375rem`. Page headings and
large balances scale without breakpoint-specific font sizes. Monetary values
use tight but readable leading, tabular numerals, and safe wrapping. Metadata
must remain secondary, never smaller than its documented role merely to fit.

### Spacing, shape, elevation, and motion

- Spacing uses `--mb-space-1` through `--mb-space-10`: `4`, `8`, `12`, `16`,
  `20`, `24`, `32`, `40`, `48`, and `64px`, written as `p-(--mb-space-4)`,
  `gap-(--mb-space-3)`, and so on. Responsive page spacing uses the documented
  `--mb-layout-page-*` roles.
- Shape uses `--mb-radius-sm`, `--mb-radius-md`, `--mb-radius-lg`,
  `--mb-radius-xl`, and `--mb-radius-pill` (`rounded-sm` … `rounded-pill`):
  `8`, `12`, `16`, `20`, and `999px`. Controls use `12px`; cards use `16px` or
  `20px`.
- Controls use `--mb-control-height-md` and `--mb-control-height-lg`: `44` and
  `48px`; normal interactive targets are at least `44px`.
- Elevation uses `--mb-shadow-sm`, `--mb-shadow-md`, `--mb-shadow-lg`, and
  `--mb-shadow-hover` (`shadow-sm` … `shadow-hover`). Apply the smallest shadow
  that communicates the layer.
- Motion durations are `--mb-duration-fast`, `--mb-duration-normal`, and
  `--mb-duration-slow` (`120`, `180`, and `260ms`), written as
  `duration-(--mb-duration-normal)`; easing is
  `cubic-bezier(.2, 0, 0, 1)` normally and `cubic-bezier(.2, .8, .2, 1)` for
  emphasized changes. Desktop hover may translate a clickable card/control by
  at most `2px`; touch interaction never relies on it.

With `prefers-reduced-motion: reduce`, nonessential transitions and animations
complete immediately and translation is removed. Focus, pressed, selected,
disabled, and validation states remain visible without motion.

### Shared primitive contract

- Buttons provide primary, secondary, ghost (`button-quiet`), destructive, and
  square icon treatments. Every variant defines hover
  where appropriate, pressed, focus-visible, and disabled states.
- Inputs and selects use elevated surfaces, strong-enough neutral boundaries,
  accent focus borders, and a visible focus halo. Placeholders use muted text.
- Settings use a segmented control and semantic on/off switches. Native
  checkboxes elsewhere retain platform affordance with the accent colour.
- Cards and stat tiles use quiet borders and at most low elevation. Interactive
  cards may lift only for fine pointers; player-colour rails are data-driven.
- Badges use compact pill geometry and combine colour with readable status text.
- The settings popover is an elevated solid-surface menu/dialog. It must keep
  its accessible name, outside-click dismissal, and keyboard behaviour.
- Dialogs are centered solid surfaces from `md` up and bottom sheets below it
  (see [Responsive and overlay rules](#responsive-and-overlay-rules)). Both
  presentations share focus trapping, Escape, restoration, overlay, and action
  semantics. Classic Bank uses no backdrop blur or translucent glass.
- Tabs use a subtle grouped surface and a filled selected state. Horizontal
  overflow is local to the tab list when labels do not fit.

These definitions are implemented by the UI kit in `src/components/ui/` and by
`src/components/Dialog.tsx`, `OverflowMenu.tsx`, and `AppearanceSettings.tsx`.
Pages may compose them but must not create a second visual language.

## Responsive and overlay rules

- Start from a usable 320 CSS-pixel viewport and scale fluidly. Validate compact
  layouts at 320, 390, and 430px; medium at 768px; and wide at 1024, 1280, and
  1440px or larger.
- Monopoly Bank has three responsive layout groups. They are shared rules, not
  page-specific breakpoint guesses:

  | Group   | Range                                          | Composition                                                                                                                                                 |
  | ------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Compact | under `48rem` / 768px                          | One primary task column; labelled header controls collapse to icons; page actions become a stable local grid; dialogs and settings use bottom sheets.       |
  | Medium  | `48rem` / 768px through under `64rem` / 1024px | Moderate page padding; labelled header controls return; actions may wrap in their local header region; dialogs and settings are anchored/centered surfaces. |
  | Wide    | `64rem` / 1024px and above                     | Controlled `1280px` content maximum; intentional outer whitespace; page title and actions may share a row; feature grids use available table space.         |

- Use `--mb-layout-*` tokens for content measures, inline/block padding, header
  height, section gaps, and grid gaps. The three layout groups are the Tailwind
  breakpoints: compact is unprefixed or `max-md:`, medium is `md:`, and wide is
  `lg:`. `src/styles/tailwind-theme.css` defines only `md` (48rem) and `lg`
  (64rem). A feature may use only these boundaries (plus the registered
  `short-landscape:` variant) when it changes composition; never add a
  page-local breakpoint value.
- Use CSS grid, flex, intrinsic sizing (`minmax(0, ...)`), and wrapping before
  adding a breakpoint. Never use fixed widths that make a 320px viewport or a
  Ukrainian label overflow.
- `PageHeader` is the shared page-level hierarchy: contextual back action,
  title/description, and one local action region. It preserves action DOM order
  and handlers while changing only its layout. Page actions never float around a
  title or move into a duplicate mobile page.
- The global header is navigation chrome, not a game-status panel. It contains
  brand, profile access, and settings; game connection state remains contextual
  to the game page.
- Avoid horizontal page scrolling at supported widths. Allow deliberate
  overflow only inside a component that communicates and controls it.
- Preserve information and action parity across viewport sizes. Reflowing,
  collapsing, or changing an overlay's presentation must not remove capability.
- Dialogs are centered with controlled width/height from medium upward. In the
  compact group they are bottom sheets: full inline width, rounded top corners,
  safe-area-aware bottom padding, `dvh` bounded height, and internal scrolling.
  The same dialog DOM preserves focus trapping, dismissal, and action order.
- Settings is anchored to its header trigger from medium upward: its right edge
  aligns with the trigger, it opens 12px below it, and its height is bounded to
  the visible viewport with internal scrolling. In compact it becomes a
  safe-area-aware bottom sheet with a backdrop; its controls, preference
  persistence, and keyboard handling remain the same.
- Account for safe-area insets in installed-PWA and mobile-browser contexts.

### Overlay presentation on narrow screens

`src/components/Dialog.tsx` implements both presentations with breakpoint
classes only; nothing measures the viewport in JavaScript. Every modal dialog
and the settings popover (`presentation="popover"`) share one sheet below `md`,
in both visual styles:

- The backdrop pins the panel to the bottom edge. It keeps only a top gap of
  `max(--mb-space-2, --mb-app-safe-top)` and no side padding, so the sheet is the
  full viewport width.
- The panel has rounded top corners (`--mb-radius-xl`) and a flat bottom. It
  drops its side and bottom borders. Its height is bounded to
  `100dvh - --mb-app-safe-top - 8px`, and it scrolls internally.
- The padding follows the insets: `max(18px, --mb-app-safe-left/right)` at the
  sides and `max(--mb-space-5, --mb-app-safe-bottom + 14px)` at the bottom.
  `DialogActions` stays sticky at the sheet's foot with
  `max(--mb-space-4, --mb-app-safe-bottom)` below the actions. The
  `--mb-app-safe-*` properties are defined in `src/index.css`; iOS standalone
  portrait raises the top inset in `layout.css`.
- A decorative 42×4px grab handle in `--mb-color-border-strong` sits 10px from
  the top. It is an absolutely placed `::before`, so it never becomes a grid item
  of a grid-laid panel. It is not a drag affordance, and the sheet is not
  draggable.
- Entrance: the scrim fades and the sheet slides up from `translate-y-full`,
  using `--mb-duration-normal` with the emphasized easing. From `md` up, the
  centred panel keeps each style's own short travel (Classic 4px, Liquid Glass
  5px, both from `scale(0.99)`). All of this sits under `motion-safe:`, and
  `motion-reduce:transition-none` removes it, so reduced motion shows the final
  state immediately.
- From `md` up, the modal is centred with `--mb-space-6` around it. The
  settings popover is anchored to its trigger. The Liquid Glass settings width
  cap applies only there.

The API does not change between presentations: `closeDisabled`, focus entry
(`autoFocus={false}` lands focus on the first enabled control), Escape, outside
click, and focus restoration behave the same.

The visual validation widths `320`, `390`, `430`, `768`, `1024`, `1280`, and
`1440` are representative coverage samples, not breakpoint specifications.

### Non-game page composition

- Saved games uses a restrained hero and a one-column compact grid. Medium and
  wide layouts use two columns so each card keeps a comfortable measure. A game
  card has one filled primary action; duplicate and destructive removal live in
  an accessible contextual menu, with removal confirmed in a dialog.
- Profile keeps a 2-by-2 statistics grid at all supported widths. Compact stacks
  identity, statistics, and a full-width editor action. Medium and wide use a
  balanced identity/statistics column beside the editor rather than constraining
  the whole page to a narrow form measure.
- Create lobby is one ordered column on compact screens. From medium upward,
  game basics and banking rules may share a row; player sections use available
  width without changing field order, validation, or submit behaviour. Colour
  choices always combine a visible check with a strong ring and accessible
  pressed state.
- Authentication and joining use the same focused elevated surface, field
  rhythm, identity controls, and full-width primary action. Invitation state,
  join code, password, and guest identity remain distinct form states without
  duplicating join logic.
- These compositions are utilities in the page TSX (`src/pages/SavedGamesPage.tsx`,
  `ProfilePage.tsx`, `CreateGamePage.tsx`, `AuthPage.tsx`, `JoinGamePage.tsx`),
  built from the UI kit and `src/components/game/GameCard.tsx`. They may consume
  shared tokens and kit components but must not redefine the palette or
  introduce page-local breakpoint values outside the compact/medium/wide
  boundaries.

### Live and finished game composition

- The game header reads in one stable order: Saved Games navigation, game
  status, game name, Pass GO reward, connection state when active, then local
  actions. The reward label may wrap, but its formatted monetary value remains
  intact. Activity and Statistics remain secondary actions; lobby invitation
  and game completion retain their existing permissions and state rules.
- Wallets form one banking desk rather than separate unrelated card grids. The
  selected controlled wallet and the other-player wallets share one responsive
  composition. Compact places the controlled wallet at full width, followed by
  an intrinsically responsive other-player grid; medium and wide place both
  groups in balanced columns.
- At roughly 320px, other-player wallets use one column. Their container—not a
  page breakpoint—enables two columns once at least `20rem` is available. This
  keeps cards readable when the wallet area is nested in another composition.
- The controlled wallet is the strongest surface and includes a textual control
  badge and explicit banking-action row. Read-only wallets retain full contrast
  and a readable status instead of using disabled opacity. Bankrupt status is
  always written as text in addition to colour.
- Monetary values use tabular numerals, a non-wrapping value line, and
  length-aware type sizes. Player names may wrap safely without colliding with
  control or bankruptcy badges.
- Lobby, active, finished, offline, pending-payment, bankrupt, and read-only
  presentation must all preserve the same underlying permissions, API calls,
  realtime lifecycle, and transaction flow. Layout code never decides whether
  a wallet is authorized.
- The game header, wallet desk, wallet cards, and pending-payment composition are
  utilities in `src/pages/game/` (`GameHeader.tsx`, `WalletsSection.tsx`,
  `WalletCard.tsx`) and the domain composites in `src/components/game/`. Banking
  dialogs and auxiliary game tools use the same UI kit and semantic tokens.

## Accessibility and motion

Accessibility is a release requirement for every visual style and colour mode:

- meet WCAG 2.2 AA contrast for text, controls, focus indicators, and meaningful
  graphical objects;
- retain visible `:focus-visible` treatment and logical keyboard navigation;
- use a minimum 44 by 44 CSS-pixel target where practical for primary touch
  controls, without overlapping adjacent targets;
- preserve semantic HTML, accessible names, live-region intent, focus trapping,
  focus restoration, and Escape behaviour;
- support zoom, text expansion, EN/UK length differences, forced colours, and
  non-hover input;
- treat `prefers-reduced-motion: reduce` as a hard stop for nonessential motion,
  parallax, pointer-following movement, and orientation-driven effects;
- never make animation, transparency, blur, vibration, sound, or device sensors
  necessary to complete a banking task.

Motion should explain a user-triggered state change or provide concise feedback.
Classic Bank has no continuous decorative motion. Liquid Glass may use only its
documented 24-second, few-percent ambient background drift; it is disabled by
reduced-motion preferences and must never read as an animated gradient wave.

## Liquid Glass capability

`liquid-glass` is implemented without changing page business logic:

- translucent surfaces and glass/refraction effects live in its token and
  presentation layers;
- `backdrop-filter` and related features use progressive enhancement with an
  opaque, contrast-compliant fallback;
- pointer-reactive highlights are driven by a shell-level optional controller
  that writes bounded CSS custom properties, not React state in each page;
- subtle parallax is decorative, bounded, and composited without shifting
  layout or intercepting input;
- DeviceOrientation effects are opt-in, feature-detected, permission-gated when
  required, never collected or transmitted, and stopped when the document is
  hidden or the style is inactive;
- coarse pointers, unsupported devices, low-power fallbacks, and reduced motion
  receive a stable non-reactive presentation;
- disabling motion immediately removes parallax, pointer-following movement,
  animated refraction, and orientation effects while preserving content and
  contrast.

These capabilities belong in optional style adapters. Shared components may
expose stable decorative hooks, but pages must not import sensor or animation
controllers.

Liquid Glass uses `src/appearance/liquid-glass-effects.ts` for its optional
shell-only pointer highlight. It updates a bounded CSS custom property, ignores
touch input, observes live reduced-motion changes, and removes all listeners and
temporary properties during cleanup. It does not request or collect sensor data.
Both style sheets also define the shared `--mb-ui-*` semantic aliases for
canvas, surface, text, border, feedback, radius, elevation, and motion. No
`--color-*` custom properties remain; see the token contract above.

## Current implementation map

The application implements `classic-bank` and `liquid-glass`. Their palettes,
typography, shape, and elevation describe their registered styles, not global
requirements for future styles.

- `src/styles/visual-styles/classic-bank.css` and
  `src/styles/visual-styles/liquid-glass.css` own the palette, typography,
  spacing, shape, controls, icons, motion, elevation, presentation roles, player
  colours, and deliberately designed dark overrides.
- `src/index.css` imports the style sheets and Tailwind, declares the layer order
  and the `classic:`/`glass:`/`dark:`/`light:` and media variants, and owns base
  document styles, the `--mb-app-safe-*` inputs, and native `color-scheme` for
  each resolved mode.
- `src/styles/tailwind-theme.css` maps Tailwind theme names onto the `--mb-*`
  tokens and defines the `md`/`lg` breakpoints.
- `src/components/ui/` is the UI kit (see [UI-kit contract](#ui-kit-contract)),
  `src/components/game/` holds the domain composites, and
  `src/components/Dialog.tsx` owns both overlay presentations.
- Shell, page, and feature geometry is written as utilities in the owning TSX.
  The remaining files in `src/styles/` (`layout.css`, `primitives.css`,
  `features.css`, `non-game-pages.css`) hold only the effects listed in
  [Remaining CSS and why](#remaining-css-and-why).
- `src/components/PageHeader.tsx` owns the shared title, back-action, and local
  page-action DOM structure used by saved games, game, create, and profile pages.
- `src/components/OverflowMenu.tsx` owns the reusable keyboard-dismissible
  contextual action menu used by saved-game cards.
- `src/utils/preferences.ts` owns preference types, storage validation, legacy
  migration, and persistence; the appearance controller owns DOM effects.
- `public/manifest.webmanifest`, `index.html`, and `public/icons/` contain the
  current installed-PWA colours and icon assets.

UI code consumes semantic roles through their utility names, such as
`bg-surface-elevated`, `text-primary`, `text-secondary`, `bg-accent`,
`text-highlight`, `text-danger`, `shadow-md`, and `rounded-card`, or directly
through tokens without a theme name, such as `p-(--mb-layout-page-inline-compact)`.
Player-picker swatches use player tokens for display while
retaining the established hex values in persisted domain data. Superseded
paper-grid, heavy control-shadow, oversized watermark, blur-overlay, and
raw visual-name tokens have been removed rather than aliased.

The PWA manifest and theme metadata retain valid static fallbacks.
Style effects must not alter installation, updates, or service-worker caching.

Frontend regression coverage includes preference/appearance tests, component
interaction tests, EN/UK localization tests, activity/dialog tests, and the
existing Playwright production-pyramid suite. It checks migration, fallback,
independent settings, system-mode updates, adapter/listener cleanup, localized
dynamic descriptions/durations, overlay keyboard behaviour, and the responsive
route/mode matrix. Run `npm test -- src` for the frontend suite and
`node node_modules/typescript/bin/tsc -p tsconfig.app.json --noEmit` for frontend
type checking, plus `npm run lint`.

## Shared information architecture

The global header is compact navigation chrome only: brand, profile access, and
settings. It never exposes Create game or Join game. Those actions appear once,
in the Saved Games hero. The hero preserves one DOM structure across styles and
uses an approximately 62/38 content/decoration composition from wide layouts;
it is a stacked task sequence on compact screens.

Saved Games has one shared route and behavior: hero, search, status filter,
sort control, then game cards. Cards provide status, title, player count, last
updated time, one primary Open/Join action, and the contextual Duplicate/Delete
menu. Compact layouts are one column through 600px and do not duplicate actions.
Long titles truncate safely while their full value remains available as the title
attribute and overflow-menu accessible name.

## Typography and assets

No remote fonts are fetched. Classic Bank uses the documented cross-platform
Inter/system fallback stack; Liquid Glass places the native Apple stack first on
Apple platforms and otherwise falls back to Inter and Segoe UI. Monetary roles
always use tabular numerals. Hero display text uses a 0.98--1.04 line height,
negative display tracking, and a responsive 34--64px range.

Runtime assets, if introduced, belong only under `public/assets/themes/classic/`
or `public/assets/themes/liquid-glass/`; design references stay under
`docs/ui/reference/` and are never shipped to the client. Classic Bank uses
`public/assets/themes/classic/hero-bank.webp` as a low-contrast, text-free hero
decoration behind its green contrast overlay. Liquid Glass intentionally uses
CSS ambient decoration and has no required raster asset.

## Style-specific implementation

Classic Bank uses the warm ivory/green/brass palette defined in
`classic-bank.css`, restrained radial canvas lighting, opaque cream surfaces,
and low-elevation card hierarchy. Liquid Glass uses the documented silver, ice
blue, lavender, and mint CSS ambient background, more opaque readable cards,
and progressive-enhancement blur (22px desktop, 16px compact). The fallback
surfaces remain contrast-safe when blur is unavailable.

Liquid Glass pointer reflection is frame-throttled and writes bounded custom
properties only to the currently highlighted hero or card. It measures a
surface once on pointer entry, does not read layout during pointer movement,
ignores touch input, and removes its temporary properties and listeners on
cleanup. DeviceOrientation remains unsupported by design until an explicit
user-triggered permission flow is specified; no sensor permission is requested
automatically.

## Visual validation

For meaningful UI changes, validate:

- `classic-bank` in English and Ukrainian, and every other registered style
  (currently `liquid-glass`);
- explicit light and dark modes, plus system preference resolution;
- representative widths of 320, 390, 430, 768, 1024, 1280, and 1440 CSS pixels;
- keyboard-only use, focus entry/restoration for overlays, and non-hover input;
- reduced motion and no-preference;
- PWA shell/install/update behaviour when shell assets or metadata change.

### Screenshot baselines: `npm run test:visual`

The reviewed baseline workflow is the Playwright `visual` project in
`e2e/visual/`:

- **Gate.** The project exists only when `PLAYWRIGHT_VISUAL=1`, which the npm
  scripts set. `npm test`, `npm run test:e2e`, and CI never run it. Its web
  server is `npm run preview`, so every run builds the app first. The harness
  (`visual.setup.ts`) stubs the API with `e2e/fixtures/api.ts`, replaces the
  WebSocket with one that never opens, fixes style, mode, and language before
  the first render, and runs with reduced motion.
- **Suites.**
  - `screens.spec.ts` holds the screenshot baselines. It covers the auth, saved
    games, create, game, banking dialog, activity, and profile screens, each for
    every registered style, both modes, and widths 390, 768, and 1280 (saved
    games and the game also in Ukrainian). It also covers the compact settings
    sheet at 390px.
  - `appearance.spec.ts`, `motion.spec.ts`, and `keyboard.spec.ts` are
    computed-style and behaviour checks. They cover style and mode switching,
    the ambient drift, dialog entrance and reduced motion, forced colours,
    safe-area insets on the header and the sheet, and focus trapping.
  - `sweep.spec.ts` is a responsive sweep without screenshots. It covers every
    style × mode × language at 320, 390, 430, 768, 1024, 1280, and 1440 over
    auth, saved games, settings, create, game, banking dialog, and profile. It
    asserts no horizontal overflow, no console errors, a full-width bottom sheet
    below 768px, a centred modal from 768px, and the anchored settings popover
    from 768px.
- **Local-only baselines.** Baselines live in
  `e2e/visual/__screenshots__/<platform>/` and are machine-specific, because font
  rasterisation differs between machines. Compare only against baselines
  recorded on the same platform and machine class. Never treat a mismatch on
  another machine as a regression without re-recording there first.
- **Updating.** Re-record only what changed on purpose, one name at a time:
  `npm run test:visual:update -- -g '<name>'`. Never run a blanket update. Each
  re-recorded baseline must be explained in the change's report, with the diff
  shown to be exactly the intended change.
- **Reference captures.** The four images in `docs/ui/reference/` are Saved
  Games in Ukrainian, light mode, for each style at 1672×941 (desktop) and
  852×1846 (a 426×923 phone at 2×). They are regenerated with
  `npm run test:visual:reference` (`reference.spec.ts`, which is skipped in
  `test:visual`). They are build evidence, not design authority.

Do not treat a captured screenshot as a replacement for this document. When
future styles are implemented, extend the matrix by registered style ID without
copying style rules into the test. Automated checks do not replace a pass on a
real iOS device (safe area and standalone PWA), a screen-reader pass, or the
live PWA update banner.

## Change workflow

1. Update this document when a UI decision changes the shared contract.
2. Add or change semantic tokens and UI-kit components (`src/components/ui/`)
   before styling pages; style with utilities and variants, not new CSS.
3. Keep style selection in the registry/application shell and keep banking
   components style-agnostic.
4. Add every visible string and accessible label to both EN and UK translations.
5. Verify the relevant visual, accessibility, localization, PWA, lint, test, and
   build checks.
6. Keep reference imagery out of the repository unless it is current, licensed,
   intentionally maintained, and linked from this document. The
   `docs/ui/reference/` captures meet this by being regenerated from the build
   (see [Screenshot baselines](#screenshot-baselines-npm-run-testvisual)).
