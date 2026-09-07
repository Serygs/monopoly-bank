# Monopoly Bank design foundation

## Direction

The interface is a compact digital bank placed at a game table: a deep-green felt frame, cream paper surfaces, and brass only for hierarchy and focus. Financial data and the next action are visually primary; decorative board-game cues remain quiet.

## Tokens and type

`src/index.css` owns semantic colour tokens for light and dark themes. Components consume these roles rather than literal theme colours. The foundation uses one UI typeface token, `var(--font-ui)`, with a high-contrast display scale (`clamp(2rem, 6vw, 4.25rem)`) and readable body copy.

Spacing is deliberate: 8–16px within controls, 16–24px between related elements, and responsive page padding of 20–56px. Interactive controls have a 44px minimum hit area, 8–20px corner radii, and a brass `:focus-visible` ring.

## Wireframes

```text
Mobile (320–390)                 Tablet / desktop (768–1280)
┌──────────── header ─────────┐  ┌────────── green app header ──────────┐
│ MB  avatar          settings│  └──────────────────────────────────────┘
└─────────────────────────────┘  ┌──────────── page heading ────────────┐
┌────── page heading ─────────┐  │ context + title           actions    │
│ context / title              │  └──────────────────────────────────────┘
│ primary, secondary actions   │  ┌──────── wallet / card grid ─────────┐
└─────────────────────────────┘  │ responsive two-to-four-column cards   │
┌──── stacked cards / wallets ─┐  └──────────────────────────────────────┘
│ immediate balance + action   │  ┌──── tools / form panels ─────────────┐
└─────────────────────────────┘  │ dice, calculator, safe form controls  │
                                └──────────────────────────────────────┘
```

On compact screens dialogs become bottom sheets with sticky action controls. Wallets remain a two-column scan-friendly grid. At 768px and above, content expands to an 1120px maximum rather than becoming a stretched dashboard.

## Anti-template check

Rejected: generic white SaaS cards, purple gradients, oversized dashboard metrics, and indiscriminate glass effects. The implemented system is specific to Monopoly Bank through the felt/brass/paper material contrast, quiet rail detail, banknote panels, and ledger-like hierarchy. The limited motion supports feedback rather than decoration and is fully disabled with `prefers-reduced-motion`.

## CSS ownership

- `layout.css`: shell, header, navigation and page geometry.
- `primitives.css`: buttons, inputs, feedback panels, dialogs, settings and accessibility states.
- `features.css`: saved games, wallets, tools, amount selection, account/profile and summary views.
