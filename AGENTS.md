# Monopoly Bank project instructions

## Architecture

- The application is a React 19/Vite client in `src/`, a Cloudflare Worker in `worker/`, and Cloudflare D1 migrations in `migrations/`.
- Shared API contracts belong in `shared/contracts/`; shared financial rules belong in `shared/domain/`. Keep UI state and rendering out of Worker services.
- D1 is the source of truth for wallets, the transaction ledger, the board catalogue and property ownership. Do not add token movement, turn order, chance cards or other game-engine state.
- Every property operation (purchase, rent, building, mortgage, auction, trade, bankruptcy estate, jail bail) goes through the domain in `shared/domain/property*.ts` and is written atomically together with its transaction. A game without a board (`games.board_id IS NULL`) must behave exactly as it did before boards existed.
- Monetary values are positive safe integers measured in thousands. Multi-player banking operations must remain atomic and write an explicit transaction record.

## UI and localization

- Read `docs/ui-design-system.md` before UI work. It is the sole authority for visual styles, colour modes, tokens, responsive behaviour, overlays, motion, accessibility, and visual validation; current screenshots and CSS are implementation evidence, not additional design requirements.
- The UI supports English and Ukrainian. Every visible label, action, placeholder, accessibility label, dialog text, and client-side error must be added to `src/i18n/translations.ts` and rendered with `useLanguage().t`.
- Avatars are emoji or a centered, browser-cropped 256×256 JPEG data URL. Avatar images are always shown with `object-fit: cover` in a circular frame. Do not accept SVG avatar uploads or external image URLs.
- Reuse `Avatar` and `AvatarPicker` from `src/components/AvatarPicker.tsx` and `AVATAR_OPTIONS` from `src/utils/avatar.ts`; do not duplicate avatar option lists.

## API, persistence, and security

- Validate all request input in `worker/validation/api-validation.ts`; reject malformed data before repositories are invoked.
- Keep avatar data URLs capped at 100 KB and allow only JPEG, PNG, and WebP base64 data URLs. Never log avatar data or credentials.
- Do not change Worker bindings, database IDs, migrations, or deployment configuration without an explicit task requiring it.

## Validation

- Run `npm test`, `npm run lint`, and `npm run build` for meaningful UI or Worker changes. Add focused tests for new validation or domain behaviour.
- Run `npm run test:e2e:local` for changes to a game on a board (deeds, rent, buildings, mortgages, trades, auctions, jail, boards): it drives the real client and Worker in a browser against a throwaway local D1 and needs no staging, mail or environment variable.
