# Monopoly Bank UI design system

## Authority and scope

This document is the single source of truth for Monopoly Bank UI design. It
governs visual styles, colour modes, semantic tokens, responsive behaviour,
overlays, motion, accessibility, and visual validation. Agent instructions,
skills, screenshots, tests, and the current CSS implementation must point here
instead of defining a competing visual contract.

This is an architecture and governance document, not a Phase 0 redesign. The
application continues to render its current UI until a later, explicitly scoped
phase changes it.

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
| `classic-bank` | Initial and only implemented style | The existing bank-inspired presentation, retained during Phase 0. |
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

## Target architecture

The architecture below is the contract for future implementation. The paths
are illustrative until that work is explicitly scheduled.

```text
Device preferences
  visualStyle: VisualStyleId
  colorMode: light | dark | system
             |
             v
UI preference controller (application shell only)
  resolves system mode and accessibility capabilities
             |
             v
<html data-ui-style="classic-bank" data-color-mode="light">
             |
             v
style registry -> style token sheet -> shared semantic components -> pages
```

The style registry should be the only mapping from a stable style ID to its
metadata and assets. A future shape may resemble:

```ts
type VisualStyleId = 'classic-bank';
type ColorModePreference = 'light' | 'dark' | 'system';

interface VisualStyleDefinition {
  id: VisualStyleId;
  labelKey: TranslationKey;
  stylesheet: () => Promise<unknown>;
  capabilities: {
    translucency: boolean;
    pointerEffects: boolean;
    orientationEffects: boolean;
  };
}
```

Extending the `VisualStyleId` union and registry is intentional. Do not accept
arbitrary style IDs, stylesheet URLs, or user-authored CSS.

The application shell owns preference loading, validation, persistence, system
mode resolution, root attributes, and optional effect controllers. Pages and
domain components consume semantic roles and remain unaware of the active
style. A style change must not remount a game, clear form state, reconnect a
WebSocket, or alter a banking request.

Device-only appearance preferences should remain local unless a later product
requirement explicitly introduces account sync. Frontend preference
persistence does not justify Worker, D1, or Durable Object changes by itself.
Unknown or retired stored values must fall back to `classic-bank` and `system`.
Apply validated preferences before first paint when the implementation phase
addresses flash prevention.

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
legibly. The current implementation has a single `--font-ui` token; a future
style may add documented display or numeric roles without changing page logic.

Layout primitives, focus behaviour, and overlay semantics are shared. A visual
style may change their presentation, but not reading order, accessible names,
focus management, dismissal behaviour, or the meaning and order of actions.

## Responsive and overlay rules

- Start from a usable 320 CSS-pixel viewport and scale fluidly.
- Add breakpoints because content or interaction fails, not to target a named
  device. Existing media-query values are implementation details, not permanent
  design-system breakpoints.
- Avoid horizontal page scrolling at supported widths. Allow deliberate
  overflow only inside a component that communicates and controls it.
- Preserve information and action parity across viewport sizes. Reflowing,
  collapsing, or changing an overlay's presentation must not remove capability.
- Dialog, sheet, popover, and menu selection is based on task semantics,
  available space, focus behaviour, and input modality. A blanket rule such as
  "all mobile dialogs are bottom sheets" is not part of the system.
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

`liquid-glass` is not implemented in Phase 0. The architecture must allow it
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

The existing application is the `classic-bank` implementation for now. Its
green, cream, brass, felt, paper, radii, and current layout choices describe the
present build; they are not global requirements for future styles.

- `src/index.css` currently owns global tokens, resolved light/dark values, and
  base document styles.
- `src/styles/layout.css` owns shell and page geometry.
- `src/styles/primitives.css` owns shared controls, feedback, settings, and
  overlays.
- `src/styles/features.css` owns feature-level presentation.
- `src/utils/preferences.ts` currently persists `system | light | dark` and
  applies the resolved `data-theme` value.
- `public/manifest.webmanifest`, `index.html`, and `public/icons/` contain the
  current installed-PWA colours and icon assets.

These names and files are migration inputs, not permission to duplicate their
literal values elsewhere. A later implementation phase should introduce the
registry and style-scoped layers incrementally, preserving current behaviour
until the replacement is validated.

Known Phase 0 gap: `system` is resolved when preferences are applied, but the
current controller does not subscribe to operating-system colour-scheme changes
during an open session. Address that with the future preference controller, not
with page-level listeners.

## Visual validation

For meaningful UI changes, validate:

- `classic-bank` in English and Ukrainian;
- explicit light and dark modes, plus system preference resolution;
- representative widths of 320, 390, 768, and 1280 CSS pixels;
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
