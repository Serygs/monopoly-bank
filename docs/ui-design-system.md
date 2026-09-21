# Monopoly Bank UI design system

## Authority and scope

This document is the single source of truth for Monopoly Bank UI design. It
governs visual styles, colour modes, semantic tokens, responsive behaviour,
overlays, motion, accessibility, and visual validation. Agent instructions,
skills, screenshots, tests, and the current CSS implementation must point here
instead of defining a competing visual contract.

Phase 3 implements the responsive layout composition described below. The
application uses one shared DOM and state flow per page across viewport sizes;
only presentation changes between compact, medium, and wide layouts.

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

| Style ID | Status | Intent |
| --- | --- | --- |
| `classic-bank` | Initial and only implemented style | A modern, premium interpretation of classic Monopoly banking. |
| `liquid-glass` | Future architecture example only | Translucent, refractive surfaces with optional device-aware effects. |
| `minimal-finance` | Future architecture example only | A possible restrained finance presentation. |

Do not implement, expose, or advertise future styles until a dedicated phase
defines and delivers them. New styles must be registered; page components must
not gain style-specific business branches.

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
style registry -> style token sheet -> shared semantic components -> pages
```

`src/appearance/visual-styles.ts` owns `VisualStyleId`, the typed
`VisualStyleDefinition` registry, validation, and the default style. Each entry
has an `id`, localized `labelKey`, `supportedCapabilities`, and `mountEffects`.
The ID is also the root `data-visual-style` value and CSS selector; a second
attribute/class name is unnecessary. The only entry is `classic-bank`.

Capabilities are descriptive metadata: `translucentSurfaces`,
`pointerReactiveEffects`, `deviceTiltEffects`, and `richBackgroundEffects`.
Classic Bank declares none. Nothing probes sensors or installs effect listeners
based on these names. Its `mountEffects(root)` adapter returns a no-op cleanup.
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

Stylesheets are imported statically from `src/index.css`. Classic Bank's token
sheet is `src/styles/visual-styles/classic-bank.css`, scoped by style and resolved
mode. This avoids an asynchronous stylesheet loader for a single small style.

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

`src/components/AppearanceSettings.tsx` renders independent, labelled selects
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
legibly. Classic Bank uses a system font stack through body, display, and money
roles; no remote font request is made.

Layout primitives, focus behaviour, and overlay semantics are shared. A visual
style may change their presentation, but not reading order, accessible names,
focus management, dismissal behaviour, or the meaning and order of actions.

## Classic Bank visual specification

Classic Bank should feel premium, tactile, financially trustworthy, and lightly
playful. It uses warm ivory space, crisp pale surfaces, deep bank green, and
small brass details. It must not use fake paper texture, glassmorphism, heavy
outlines, cartoon typography, or gold as a general-purpose action colour.
Elevation is reserved for interactive or layered hierarchy; ordinary content
grouping should prefer spacing and subtle surface contrast.

### Token contract

`src/styles/visual-styles/classic-bank.css` is the implemented source for exact
values. Shared and feature CSS must use the following roles rather than adding
raw palette names.

| Group | Tokens | Contract |
| --- | --- | --- |
| Canvas and surfaces | `--color-canvas`, `--color-surface`, `--color-surface-elevated`, `--color-surface-subtle`, `--color-surface-inverse`, `--color-surface-inverse-elevated` | Ivory canvas and clean neutral surfaces in light mode; deep neutral-green canvas and progressively lighter green-neutral surfaces in dark mode. |
| Text | `--color-text-primary`, `--color-text-secondary`, `--color-text-muted`, `--color-text-on-accent`, `--color-text-on-danger`, `--color-text-on-inverse` | Primary content, supporting copy, de-emphasized metadata, and contrast-safe text on filled roles. |
| Structure | `--color-border`, `--color-border-strong`, `--color-dialog-divider` | Use the quiet border by default. Strong borders are for selected, interactive, or unusually dense boundaries. |
| Brand/action | `--color-accent`, `--color-accent-hover`, `--color-accent-pressed`, `--color-accent-soft` | Deep premium green in light mode and a brighter accessible green in dark mode. This is the primary action and selection family. |
| Highlight | `--color-highlight`, `--color-highlight-hover`, `--color-highlight-soft` | Muted brass for focus, compact identity details, and limited emphasis; never the default control fill. |
| Feedback | `--color-danger`, `--color-danger-hover`, `--color-danger-soft`, `--color-success`, `--color-success-soft`, plus status/border aliases | Restrained red for destructive/error states and green for positive/live states. Always pair colour with text, iconography, or semantics. |
| Player identity | `--color-player-red`, `--color-player-blue`, `--color-player-green`, `--color-player-orange`, `--color-player-purple`, `--color-player-teal`, `--color-text-on-player` | Stable values matching persisted player colours. Keep all six distinguishable in both modes. |
| Focus and overlay | `--color-focus-ring`, `--color-focus-halo`, `--color-overlay`, `--focus-ring` | Brass focus treatment remains visible on light, dark, and inverse surfaces. Classic Bank overlays are opaque and must not blur content. |

The resolved core palette is:

| Role | Light | Dark |
| --- | --- | --- |
| Canvas | `#f4f1e8` | `#0b1511` |
| Surface | `#fffcf5` | `#111f1a` |
| Elevated surface | `#ffffff` | `#182a23` |
| Subtle surface | `#ecefe9` | `#1d3028` |
| Primary text | `#17231e` | `#f2f1eb` |
| Secondary text | `#46534d` | `#c3cbc6` |
| Muted text | `#626d67` | `#93a099` |
| Border / strong border | `#d9ded8` / `#b9c3bb` | `#2f443b` / `#4c6258` |
| Accent / hover / pressed | `#176344` / `#125338` / `#0d432d` | `#4fa779` / `#65b98b` / `#3d8d65` |
| Accent soft | `#e2f0e8` | `#193b2d` |
| Highlight / hover / soft | `#b78c3f` / `#9d7430` / `#f2e9d4` | `#c7a45e` / `#d4b46f` / `#352f20` |
| Danger / hover / soft | `#b3434b` / `#98363d` / `#f8e7e8` | `#e06d75` / `#ef8188` / `#43242a` |
| Success / soft | `#2e7650` / `#e4f2e9` | `#6eb88b` / `#173928` |
| Focus ring | `#8b6322` | `#d5b86f` |

Dark mode is designed independently; do not derive it by inversion. Stable
player values are red `#d83f55`, blue `#2878d0`, green `#238b57`, orange
`#d97721`, purple `#8b4cc5`, and teal `#087f78`.

### Typography

Classic Bank uses high-quality system stacks so Ukrainian glyph coverage and
PWA startup do not depend on a network font:

- `--font-body` / `--font-ui`: body copy and controls;
- `--font-display`: page and section headings;
- `--font-money`: balances and transaction values with tabular numerals.

The responsive roles are display `clamp(2.15rem, 6vw, 3.75rem)`, large heading
`clamp(1.45rem, 3vw, 2rem)`, medium heading `1.2rem`, body `1rem`, small
`.875rem`, meta `.78rem`, large money `clamp(1.55rem, 5vw, 2.25rem)`, hero
money `clamp(2.45rem, 10vw, 4rem)`, and button `.9375rem`. Page headings and
large balances scale without breakpoint-specific font sizes. Monetary values
use tight but readable leading, tabular numerals, and safe wrapping. Metadata
must remain secondary, never smaller than its documented role merely to fit.

### Spacing, shape, elevation, and motion

- Spacing uses `--space-1` through `--space-10`: `4`, `8`, `12`, `16`, `20`,
  `24`, `32`, `40`, `48`, and `64px`; page inline spacing is
  `clamp(16px, 4vw, 32px)`.
- Shape uses `--radius-xs`, `--radius-sm`, `--radius-md`, `--radius-lg`,
  `--radius-xl`, and `--radius-pill`: `6`, `8`, `12`, `16`, `20`, and `999px`.
  Controls use `12px`; cards use `16px` or `20px`.
- Controls use `--control-height-sm`, `--control-height-md`, and
  `--control-height-lg`: `40`, `44`, and `48px`; normal interactive targets are
  at least `44px`.
- Icons use `--icon-size-sm`, `--icon-size-md`, and `--icon-size-lg`: `16`, `20`,
  and `24px`.
- Elevation uses `--shadow-sm`, `--shadow-md`, `--shadow-lg`, and
  `--shadow-hover`. Apply the smallest shadow that communicates the layer.
- Motion durations are `120`, `180`, and `260ms`; easing is
  `cubic-bezier(.2, 0, 0, 1)` normally and `cubic-bezier(.2, .8, .2, 1)` for
  emphasized changes. Desktop hover may translate a clickable card/control by
  at most `2px`; touch interaction never relies on it.

With `prefers-reduced-motion: reduce`, nonessential transitions and animations
complete immediately and translation is removed. Focus, pressed, selected,
disabled, and validation states remain visible without motion.

### Shared primitive contract

- Buttons provide primary, secondary, ghost (`button-quiet`), destructive,
  destructive-ghost, and square icon treatments. Every variant defines hover
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
- Dialogs are centered solid surfaces on larger viewports and may reflow as a
  bottom sheet when narrow. Both presentations share focus trapping, Escape,
  restoration, overlay, and action semantics. Classic Bank uses no backdrop
  blur or translucent glass.
- Tabs use a subtle grouped surface and a filled selected state. Horizontal
  overflow is local to the tab list when labels do not fit.

These definitions are implemented in `src/styles/primitives.css`. Feature CSS
may compose them but must not create a second visual language.

## Responsive and overlay rules

- Start from a usable 320 CSS-pixel viewport and scale fluidly. Validate compact
  layouts at 320, 390, and 430px; medium at 768px; and wide at 1024, 1280, and
  1440px or larger.
- Monopoly Bank has three responsive layout groups. They are shared rules, not
  page-specific breakpoint guesses:

  | Group | Range | Composition |
  | --- | --- | --- |
  | Compact | under `48rem` / 768px | One primary task column; labelled header controls collapse to icons; page actions become a stable local grid; dialogs and settings use bottom sheets. |
  | Medium | `48rem` / 768px through under `64rem` / 1024px | Moderate page padding; labelled header controls return; actions may wrap in their local header region; dialogs and settings are anchored/centered surfaces. |
  | Wide | `64rem` / 1024px and above | Controlled `1280px` content maximum; intentional outer whitespace; page title and actions may share a row; feature grids use available table space. |

- Use `--layout-*` tokens for content measures, inline/block padding, header
  height, section gaps, and grid gaps. `src/styles/layout.css` owns the three
  layout-group media queries. Feature CSS may only use the same compact, medium,
  and wide boundaries when a feature changes composition.
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
- Settings is an anchored header panel from medium upward. In compact it becomes
  a safe-area-aware bottom sheet with a backdrop; its controls, preference
  persistence, and keyboard handling remain the same.
- Account for safe-area insets in installed-PWA and mobile-browser contexts.

The visual validation widths `320`, `390`, `768`, and `1280` are representative
coverage samples, not breakpoint specifications.

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
No style may introduce continuous movement by default.

## Future `liquid-glass` capability

`liquid-glass` is not implemented. The architecture must allow it
later without changing page business logic:

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

## Current implementation map

The application currently implements only `classic-bank`. Its palette,
typography, shape, and elevation describe that registered style, not global
requirements for future styles.

- `src/styles/visual-styles/classic-bank.css` owns the palette, typography,
  spacing, shape, controls, icons, motion, elevation, presentation roles, player
  colours, and deliberately designed dark overrides.
- `src/index.css` imports the style sheet and owns base document styles,
  safe-area inputs, and native `color-scheme` for each resolved mode.
- `src/styles/layout.css` owns shell and page geometry.
- `src/styles/primitives.css` owns shared controls, feedback, settings, and
  overlays.
- `src/styles/features.css` owns feature-level presentation.
- `src/components/PageHeader.tsx` owns the shared title, back-action, and local
  page-action DOM structure used by saved games, game, create, and profile pages.
- `src/utils/preferences.ts` owns preference types, storage validation, legacy
  migration, and persistence; the appearance controller owns DOM effects.
- `public/manifest.webmanifest`, `index.html`, and `public/icons/` contain the
  current installed-PWA colours and icon assets.

Feature styles consume semantic names such as `--color-surface-elevated`,
`--color-text-primary`, `--color-text-secondary`, `--color-accent`,
`--color-highlight`, `--color-danger`, `--shadow-md`, `--radius-card`, and
`--space-page-inline`. Player-picker swatches use player tokens for display while
retaining the established hex values in persisted domain data. Superseded
paper-grid, heavy control-shadow, oversized watermark, blur-overlay, and
raw visual-name tokens have been removed rather than aliased.

The PWA manifest and theme metadata retain valid static fallbacks.
Style effects must not alter installation, updates, or service-worker caching.

Frontend regression coverage lives in `src/utils/preferences.test.ts`,
`src/appearance/appearance-controller.test.ts`, and
`src/components/AppearanceSettings.test.tsx`. It checks migration, fallback,
independent settings, system-mode updates, adapter/listener cleanup, and EN/UK
options. Run `npm test -- src` for the frontend suite and
`node node_modules/typescript/bin/tsc -p tsconfig.app.json --noEmit` for frontend
type checking, plus `npm run lint`.

## Visual validation

For meaningful UI changes, validate:

- `classic-bank` in English and Ukrainian;
- explicit light and dark modes, plus system preference resolution;
- representative widths of 320, 390, 430, 768, 1024, 1280, and 1440 CSS pixels;
- keyboard-only use, focus entry/restoration for overlays, and non-hover input;
- reduced motion and no-preference;
- PWA shell/install/update behaviour when shell assets or metadata change.

Playwright screenshots are diagnostic report attachments unless a dedicated,
reviewed baseline workflow is added. Do not treat a captured screenshot as a
replacement for this document. When future styles are implemented, extend the
matrix by registered style ID without copying style rules into the test.

## Change workflow

1. Update this document when a UI decision changes the shared contract.
2. Add or change semantic tokens and shared primitives before styling pages.
3. Keep style selection in the registry/application shell and keep banking
   components style-agnostic.
4. Add every visible string and accessible label to both EN and UK translations.
5. Verify the relevant visual, accessibility, localization, PWA, lint, test, and
   build checks.
6. Keep reference imagery out of the repository unless it is current, licensed,
   intentionally maintained, and linked from this document.
