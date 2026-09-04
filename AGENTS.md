# Monopoly Bank project instructions

## Architecture

- The application is a React 19/Vite client in `src/`, a Cloudflare Worker in `worker/`, and Cloudflare D1 migrations in `migrations/`.
- Shared API contracts belong in `shared/contracts/`; shared financial rules belong in `shared/domain/`. Keep UI state and rendering out of Worker services.
- D1 is the source of truth. Do not add a bank balance, board mechanics, property ownership, turn order, or other game-engine state.
- Monetary values are positive safe integers measured in thousands. Multi-player banking operations must remain atomic and write an explicit transaction record.

## UI and localization

- The UI supports English and Ukrainian. Every visible label, action, placeholder, accessibility label, dialog text, and client-side error must be added to `src/i18n/translations.ts` and rendered with `useLanguage().t`.
- Use the single UI font token `var(--font-ui)`, declared in `src/index.css`. Do not introduce per-component font families. It must render Ukrainian glyphs well.
- Preserve the existing Monopoly-bank visual language: deep green, cream, brass accents, rounded 8–18px panels, and high-contrast actions. Check both light and dark themes and a 320px-wide viewport for UI work.
- Avatars are emoji or a centered, browser-cropped 256×256 JPEG data URL. Avatar images are always shown with `object-fit: cover` in a circular frame. Do not accept SVG avatar uploads or external image URLs.
- Reuse `Avatar` and `AvatarPicker` from `src/components/AvatarPicker.tsx` and `AVATAR_OPTIONS` from `src/utils/avatar.ts`; do not duplicate avatar option lists.

## API, persistence, and security

- Validate all request input in `worker/validation/api-validation.ts`; reject malformed data before repositories are invoked.
- Keep avatar data URLs capped at 100 KB and allow only JPEG, PNG, and WebP base64 data URLs. Never log avatar data or credentials.
- Do not change Worker bindings, database IDs, migrations, or deployment configuration without an explicit task requiring it.

## Validation

- Run `npm test`, `npm run lint`, and `npm run build` for meaningful UI or Worker changes. Add focused tests for new validation or domain behaviour.
