# Monopoly Bank — Codex implementation prompts

## Phase 1 — Repository audit and target architecture

Use the `$monopoly-bank-dev` skill.

Inspect the existing repository and prepare it for implementation of the Monopoly Bank MVP.

Do not implement application features yet.

### Goals

1. Inspect the existing Cloudflare-generated project.
2. Understand:
   - React/Vite setup;
   - Worker entry point;
   - Wrangler configuration;
   - current dependencies;
   - TypeScript configuration;
   - testing setup;
   - existing application structure.
3. Define the minimal target architecture for this project.

The intended architecture is:

```text
React UI
→ API client
→ Cloudflare Worker API
→ application/domain services
→ repository layer
→ Cloudflare D1
```

Business logic must remain independent from React components and persistence.

### Expected modules

Create or prepare a clean structure similar to:

```text
src/
  components/
  pages/
  api/
  domain/
  hooks/
  utils/

worker/
  index.ts
  routes/
  services/
  repositories/
  validation/
  types/

shared/
  types/
  contracts/

migrations/
```

Adapt this to the existing generated Cloudflare structure rather than forcing this exact layout if the project already uses another sensible convention.

### Important constraints

- TypeScript everywhere.
- React frontend.
- Cloudflare Worker backend.
- Cloudflare D1 persistence.
- No authentication.
- No WebSockets.
- No Durable Objects.
- No property/game-board functionality.
- No unnecessary third-party dependencies.
- No ORM unless there is a strong concrete reason.
- Do not add Redux.
- Keep shared frontend/backend contracts reusable.
- Do not duplicate domain types unnecessarily.

### Deliverables

1. Apply only structural/configuration changes required to support future phases.
2. Do not build payments or game features yet.
3. Ensure the project still starts successfully.
4. Run relevant TypeScript/build checks.
5. At the end report:
   - architecture chosen;
   - files/directories created or changed;
   - commands used for validation;
   - any important existing project constraints discovered.

Keep the final report concise.

---

# Phase 2 — D1 schema and persistence foundation

Use the `$monopoly-bank-dev` skill.

Implement the Cloudflare D1 persistence foundation for Monopoly Bank.

Inspect the existing Wrangler and Worker configuration first. Use the versions and Cloudflare conventions already installed in the repository.

## Domain requirements

A game has:

- id;
- name;
- starting balance;
- Pass GO reward;
- created timestamp;
- updated timestamp;
- status if useful.

A game contains 2–6 players.

A player has:

- id;
- gameId;
- name;
- color;
- current balance;
- created timestamp if useful.

The bank has unlimited money and must NOT have its own wallet/balance record.

Transactions must be persisted independently from balances.

Each transaction should preserve enough information to understand the operation later.

Supported future transaction types:

```text
PLAYER_TO_PLAYER
PLAYER_TO_BANK
BANK_TO_PLAYER
PLAYER_TO_ALL
ALL_TO_PLAYER
PAY_RENT
PASS_GO
```

Transactions may contain an optional comment.

## Database design

Create the initial D1 migration.

Use relational tables with foreign keys where appropriate.

At minimum, model:

```text
games
players
transactions
```

You may add a transaction participant/detail table if it gives a cleaner model for multi-player transactions.

Do NOT store entire games as one JSON blob.

Use integer values for all money fields.

Money represents thousands, but internally an amount such as `200` simply means `200k`.

Do not store floating-point money.

## Required persistence capabilities

Implement repository interfaces/implementations for:

### Games
- create game;
- get game by id;
- list saved games;
- update game metadata if needed;
- delete game only if straightforward and useful.

### Players
- create players with the game;
- load players for a game;
- update player balances safely.

### Transactions
- create transaction records;
- list transaction history for a game;
- list transaction history involving a specific player.

Do not implement payment business rules yet.

## Cloudflare configuration

Configure the D1 binding in Wrangler if it is not already configured.

Do not hardcode production database identifiers if the project workflow provides a better environment-safe approach.

If a local D1 development configuration is required, configure it cleanly.

## Validation

Add repository-level tests where practical.

Run:
- relevant tests;
- TypeScript checks;
- build.

Do not implement UI changes except anything absolutely required to keep compilation working.

At the end briefly report:
- schema;
- migration path;
- D1 binding name;
- repository APIs created;
- validation performed.

---

# Phase 3 — Core banking domain engine

Use the `$monopoly-bank-dev` skill.

Implement the Monopoly Bank core domain/application logic.

This phase should focus almost entirely on pure TypeScript business logic.

Do not implement React UI yet.

Do not put business rules into Cloudflare route handlers.

## Core rules

Maximum players: 6.

Minimum players for a game: 2.

Starting balance is identical for all players.

Balances can never become negative.

The bank has unlimited funds.

Every operation must validate completely before any balance is changed.

Multi-player operations must behave atomically from the domain perspective.

## Operations

Implement domain/application commands for:

### 1. Player → Player

Inputs:
- source player;
- destination player;
- amount;
- optional comment.

Rules:
- players must be different;
- amount must be a positive integer;
- source must have enough money;
- destination receives exactly the amount.

### 2. Player → Bank

Inputs:
- player;
- amount;
- optional comment.

Rules:
- positive integer amount;
- player must have enough money;
- amount is removed from the player;
- no bank balance is tracked.

### 3. Bank → Player

Inputs:
- player;
- amount;
- optional comment.

Rules:
- positive integer amount;
- amount is added to player;
- bank funds are unlimited.

### 4. Player → All other players

Inputs:
- payer;
- amountPerPlayer;
- optional comment.

Rules:
- payer does not pay themselves;
- amount is paid individually to every other player;
- total required amount:

```text
amountPerPlayer × numberOfRecipients
```

- payer must have enough money for the full total;
- either everyone is paid or nobody is paid.

### 5. All other players → One player

Inputs:
- recipient;
- amountPerPlayer;
- optional comment.

Rules:
- recipient does not pay themselves;
- every other player pays the same amount;
- validate every payer first;
- if even one payer cannot afford the payment, reject the entire operation;
- no balance may be modified on failure.

### 6. Pay Rent

Treat Pay Rent as a specialized Player → Player operation.

Inputs:
- payer;
- recipient;
- amount;
- optional comment.

No property lookup or automatic rent calculation exists.

Persist its transaction type as `PAY_RENT`.

### 7. Pass GO

Inputs:
- player.

Use the game's configured fixed Pass GO reward.

Add exactly that amount to the player.

Persist transaction type as `PASS_GO`.

## Errors

Create explicit typed/domain errors where appropriate.

At minimum distinguish:

- invalid amount;
- player not found;
- same source and destination;
- insufficient funds;
- invalid game state if applicable.

Insufficient-funds errors must expose enough structured information for UI/API to show:

```text
currentBalance
requiredAmount
shortfall if useful
```

Do not expose implementation stack traces to clients.

## Transaction output

Every successful operation should produce sufficient structured data for persistence and UI confirmation/history.

Prefer an application result containing:
- affected players;
- balances before;
- balances after;
- amount per participant;
- total amount;
- transaction metadata.

Do not duplicate business rules between service and route layers.

## Tests

Create comprehensive unit tests for:

- Player → Player success;
- Player → Player insufficient funds;
- Player → Bank;
- Bank → Player;
- Player → All success;
- Player → All insufficient total funds;
- All → Player success;
- All → Player when one payer cannot afford payment;
- Pay Rent;
- Pass GO;
- invalid zero amount;
- invalid negative amount;
- prevention of negative balances;
- no partial mutation on failed multi-player operations.

Use deterministic test data.

Run tests and TypeScript checks.

Do not implement frontend work in this phase.

---

# Phase 4 — Worker REST API

Use the `$monopoly-bank-dev` skill.

Implement the Cloudflare Worker REST API for the existing Monopoly Bank domain and repository layers.

Do not move banking rules into HTTP handlers.

## General requirements

Use JSON APIs.

Use consistent standardized API responses.

Validate all external input at the Worker boundary.

Return appropriate HTTP status codes.

Do not expose stack traces, SQL errors, Wrangler details, or internal implementation information to the frontend.

## Game endpoints

Implement endpoints equivalent to:

```text
GET    /api/games
POST   /api/games
GET    /api/games/:gameId
```

Optionally:

```text
DELETE /api/games/:gameId
```

only if it fits naturally and does not create unnecessary scope.

### Create game request

Support:

```json
{
  "name": "Friday Monopoly",
  "startingBalance": 1500,
  "passGoReward": 200,
  "players": [
    {
      "name": "Player 1",
      "color": "#..."
    }
  ]
}
```

Rules:
- 2–6 players;
- unique player IDs generated server-side;
- sensible game ID generation;
- same starting balance assigned to every player;
- positive integer starting balance;
- positive integer Pass GO reward;
- player names required;
- colors required.

## Payment endpoint

Prefer one consistent endpoint such as:

```text
POST /api/games/:gameId/transactions
```

with operation-specific payloads, or another clean design.

Support:

```text
PLAYER_TO_PLAYER
PLAYER_TO_BANK
BANK_TO_PLAYER
PLAYER_TO_ALL
ALL_TO_PLAYER
PAY_RENT
PASS_GO
```

Do not create seven totally separate implementations containing duplicated logic.

## Atomic persistence

For successful banking operations:

1. validate the complete operation;
2. update all affected balances;
3. persist the transaction/history;
4. do not leave partially applied results.

Use the D1 mechanism supported by the installed Cloudflare version that best preserves consistency.

Do not manually update players one-by-one while allowing partial failures.

## History endpoints

Implement:

```text
GET /api/games/:gameId/transactions
GET /api/games/:gameId/players/:playerId/transactions
```

Return transactions newest-first unless there is a strong reason otherwise.

Support a reasonable limit/pagination mechanism if simple.

Do not overbuild pagination.

## API contracts

Create shared TypeScript request/response contracts that frontend can reuse.

Avoid `any`.

## Tests

Test API behavior for:
- valid game creation;
- invalid player count;
- invalid balances;
- valid payment;
- insufficient funds;
- Player → All atomic validation;
- All → Player atomic validation;
- missing game;
- missing player;
- history retrieval.

Run tests, typecheck, and build.

Do not implement UI beyond anything required for compilation.

---

# Phase 5 — Frontend shell, routing, saved games and game creation

Use the `$monopoly-bank-dev` skill.

Implement the first usable React frontend for Monopoly Bank.

Reuse the existing Worker API.

Do not implement the full payment UI yet.

## Main application flows

The application should have these main screens:

```text
Saved Games
Create Game
Game
```

Use a lightweight routing approach appropriate to the existing project.

Do not add a large dependency unless necessary.

## Saved Games screen

Display existing saved games from the API.

For each game show:
- game name;
- number of players;
- created or last-updated timestamp if available;
- action to continue/open game.

Provide a clear:

```text
Create New Game
```

action.

Handle:
- loading;
- empty state;
- API failure.

## Create Game screen

Form fields:

### Game
- Game name;
- Starting balance;
- Pass GO reward.

### Players
Support 2–6 players.

Each player requires:
- name;
- color.

Allow:
- add player until 6;
- remove player until 2.

Starting balance is global and the same for every player.

Pass GO reward is global.

Use integer inputs only for monetary values.

UI labels should make it obvious that values are represented in thousands.

For example:

```text
Starting balance
1500
Displayed as 1,500k
```

or another clear presentation.

Do not add currency selection.

## Player colors

Provide a sensible set of visually distinct selectable colors.

Prevent accidental duplicate colors if practical.

Color must remain readable in both light and dark contexts if the project supports them.

## Validation

Perform client-side validation but treat backend validation as authoritative.

Show clear errors for:
- fewer than 2 players;
- more than 6 players;
- empty player name;
- invalid balance;
- invalid Pass GO reward.

On successful creation:
- redirect/open the created game.

## Responsive design

Must work comfortably on:
- phone;
- tablet;
- laptop;
- desktop.

Touch targets should be comfortable on mobile.

Do not over-polish visual effects yet.

## API client

Create a small typed frontend API client.

Do not call `fetch` directly from many unrelated components.

Centralize API communication.

## Validation

Run:
- relevant frontend tests if present;
- typecheck;
- build.

At the end report only important implementation details.

---

# Phase 6 — Main game dashboard and player wallet cards

Use the `$monopoly-bank-dev` skill.

Implement the main Monopoly Bank game dashboard.

Focus on fast in-person gameplay using one shared device.

## Main layout

The primary content should be player wallets.

For every player display a clear card containing:

- player name;
- player color;
- current balance.

The current balance must be visually prominent.

Format monetary values consistently as thousands, for example:

```text
1,500k
200k
50k
```

No currency symbol is required.

## Player actions

Selecting/tapping a player should expose these actions:

```text
Pay Player
Pay Rent
Pay Bank
Receive from Bank
Pay Everyone
Everyone Pays Me
Pass GO
```

The UX may use:
- modal;
- drawer;
- dedicated action panel;

Choose whichever is most usable across mobile and desktop.

Do not navigate through many pages for simple payments.

## General UX

The application is intended to replace Monopoly cash during a physical game.

Optimize for:
- few taps;
- large controls;
- easy visibility across a table;
- minimal text entry.

Avoid tiny dropdowns where large player selection buttons/cards are better.

Player selection should visually use player names/colors.

## Data refresh

After successful transactions:
- update wallet balances immediately;
- avoid requiring manual page refresh;
- ensure UI state remains aligned with persisted API state.

Choose a simple reliable approach.

## Game header

Show:
- game name;
- Pass GO reward;
- access to global history;
- action to return to saved games.

Do not implement board positions or turns.

## Error handling

Use a clear application-level error surface/toast/modal.

Insufficient funds should display something equivalent to:

```text
Insufficient funds

Current balance: 150k
Required: 200k
```

Do not silently fail.

## Responsive requirements

Phone:
- wallet cards can stack;
- primary actions remain easy to tap.

Desktop/tablet:
- use available width effectively;
- player wallets should form a clean grid.

Do not create excessive empty space.

Run typecheck/build and relevant tests.

---

# Phase 7 — Complete payment UX and confirmations

Use the `$monopoly-bank-dev` skill.

Implement all Monopoly Bank payment interactions on top of the existing backend/domain logic.

Every operation that changes money must require explicit confirmation before the API mutation is submitted.

## Confirmation design

The confirmation must show meaningful information, not just:

```text
Are you sure?
```

Show:
- operation;
- payer/source;
- recipient/destination;
- amount;
- amount per player when relevant;
- total amount when relevant;
- resulting balances where practical;
- optional comment if entered.

Buttons:

```text
Cancel
Confirm
```

## Player → Player

Flow:

```text
Select payer
→ Pay Player
→ Select recipient
→ Enter amount
→ Optional comment
→ Confirmation
→ Execute
```

Recipient cannot equal payer.

## Pay Rent

Flow is essentially Player → Player but the action is labeled `Pay Rent`.

Persist as `PAY_RENT`.

No automatic property/rent calculations.

## Pay Bank

Flow:

```text
Player
→ Pay Bank
→ Amount
→ Optional comment
→ Confirmation
```

Display resulting player balance.

## Receive from Bank

Flow:

```text
Player
→ Receive from Bank
→ Amount
→ Optional comment
→ Confirmation
```

The bank has unlimited money.

## Pay Everyone

The selected player pays the entered amount to EACH other player.

Before confirmation calculate:

```text
recipientCount
amountPerPlayer
totalAmount
```

Example:

```text
100k × 4 players = 400k
```

Confirmation must clearly show the total.

If payer cannot afford the total:
- prevent confirmation/execution;
- show current balance and required total.

## Everyone Pays Me

Every other player pays the selected player the same entered amount.

Confirmation should show:
- recipient;
- amount per payer;
- payer count;
- total recipient receives.

If any payer lacks funds:
- operation must fail completely;
- display which player or players cannot afford the payment if backend data makes that available;
- do not partially update UI.

## Pass GO

Provide a very fast action.

The amount is fixed from game configuration.

Confirmation example:

```text
Pass GO

Alex receives 200k

Balance:
1,300k → 1,500k
```

Do not allow the user to change the Pass GO amount during a game.

## Optional comment

Allow optional comments on regular payment operations.

Do not make comment mandatory.

Pass GO does not need a comment unless the existing generic flow supports it naturally.

## Input behavior

Monetary inputs:
- integers only;
- positive amounts only;
- prevent accidental malformed values;
- convenient numeric keyboard on mobile.

Do not allow zero.

## Success feedback

After successful operations:
- close the action modal/panel;
- update balances;
- provide lightweight visual confirmation;
- avoid intrusive dialogs.

Do not add payment sounds yet unless already straightforward.

## Tests

Add component/integration tests for critical payment flows where practical.

At minimum make sure domain/API tests continue to cover financial correctness.

Run all relevant tests, typecheck, and build.

---

# Phase 8 — Transaction history

Use the `$monopoly-bank-dev` skill.

Implement global and player-specific transaction history.

## Global history

The main game should provide access to all transactions.

Display newest first.

Each item should clearly communicate the operation.

Examples:

```text
John → Alex
200k

John → Bank
100k

Bank → Kate
200k

John → Everyone
50k each · 200k total

Everyone → Alex
50k each · 200k total

John → Alex · Rent
120k

Alex · Pass GO
+200k
```

Use player colors/names where useful.

Display timestamp.

Display optional comment only when present.

## Player history

Selecting a player or opening their details should provide history filtered to that player.

Represent money from that player's perspective where useful:

```text
+200k
-100k
+50k
```

For multi-player operations make the description unambiguous.

Do not invent historical balances if they are not stored.

## Empty/loading/error states

Handle all three cleanly.

## Performance

There will normally be a small number of transactions, so do not overengineer virtualization.

Use simple pagination/load-more only if already supported by the API.

## Explicit exclusions

Do NOT add:
- undo;
- delete transaction;
- edit transaction;
- rollback.

History is read-only.

## Validation

Test formatting and filtering logic where it contains meaningful behavior.

Run tests/typecheck/build.

---

# Phase 9 — Digital dice roller

Use the `$monopoly-bank-dev` skill.

Implement a polished standalone digital dice roller.

This feature is NOT connected to player movement or banking.

## Required behavior

There are exactly two six-sided dice.

Each roll independently produces an integer from 1 through 6.

Display:
- die 1;
- die 2;
- total.

If values are equal, visually indicate:

```text
DOUBLE!
```

Do not implement Monopoly double-turn or jail rules.

## UI

Provide a prominent:

```text
Roll Dice
```

button accessible from the main game screen.

The feature should feel good on:
- phone;
- tablet;
- desktop.

Use visually recognizable dice faces rather than just two plain numbers if practical.

Prefer CSS/SVG/HTML implementation rather than adding a large dependency.

## Animation

Create a short roll animation.

Target behavior:
- around 0.5–1 second;
- dice visually shake/roll/change;
- final values settle clearly.

Respect `prefers-reduced-motion`.

Do not block UI longer than necessary.

Prevent accidental overlapping roll animations.

## Randomness

Create a small dice utility/service independent from React.

It should be easy to test.

Use appropriate browser/runtime randomness for a casual board-game dice roller.

No cryptographic or server-side persistence requirement exists.

## Sound

Add an optional lightweight dice rolling sound only if it can be implemented without unnecessary dependency or complexity.

If browser autoplay restrictions apply, trigger sound only from the user's button interaction.

The game must work fully with sound unavailable or muted.

If adding sound would require an awkward implementation or bundled copyrighted asset, omit it and mention this briefly.

## Tests

Test:
- each die always returns 1–6;
- total always returns 2–12;
- doubles detection.

Do not write brittle tests around animation timing.

Do not connect dice results to:
- players;
- turns;
- positions;
- Pass GO;
- rent;
- board;
- jail.

Run tests/typecheck/build.

---

# Phase 10 — UI/UX polish and responsive pass

Use the `$monopoly-bank-dev` skill.

Perform a focused UI/UX refinement pass for the completed Monopoly Bank MVP.

Do not change domain behavior unless a UI bug reveals an actual issue.

## Product context

This application will typically sit on a phone, tablet, or laptop next to a physical Monopoly board.

Users need to perform transactions quickly during play.

## Priorities

### 1. Player wallets

Make balances the strongest visual element.

Player cards must be easy to distinguish by player color.

Ensure text remains readable regardless of selected player color.

### 2. Payment speed

Minimize taps for common actions.

Avoid unnecessary navigation.

Ensure the currently selected payer/recipient is always obvious.

### 3. Confirmation safety

Make it difficult to accidentally:
- pay the wrong player;
- enter the wrong amount;
- confuse amount-per-player with total.

### 4. Responsive design

Explicitly inspect layouts around:

```text
320px
375px
768px
1024px+
```

No page-level horizontal overflow.

No clipped modals.

No tiny buttons.

### 5. Accessibility

Ensure:
- buttons have accessible labels;
- dialogs have meaningful titles;
- keyboard focus works;
- color is not the only indicator of player identity;
- sufficient contrast;
- dynamic success/error state is understandable.

### 6. Loading states

Avoid duplicate submission while payment is being processed.

Disable confirmation appropriately during API calls.

### 7. Empty and error states

Review:
- no saved games;
- history empty;
- failed API call;
- insufficient funds;
- malformed input.

### 8. Visual consistency

Use a consistent:
- spacing system;
- border radius;
- typography hierarchy;
- button hierarchy;
- modal style.

Keep the visual style modern and game-like but not childish or overly decorative.

Dice can be more playful than banking controls.

## Avoid

- unnecessary animation everywhere;
- glassmorphism overload;
- excessive gradients;
- oversized headers;
- tiny secondary text;
- large dependency additions just for styling.

After changes run tests/typecheck/build.

Briefly summarize meaningful UX improvements.

---

# Phase 11 — Full MVP audit, test coverage and deployment readiness

Use the `$monopoly-bank-dev` skill.

Perform a final engineering audit of the Monopoly Bank MVP.

Do not redesign the application.

Do not add new product features.

The goal is to make the existing MVP reliable and ready to deploy on Cloudflare.

## Functional checklist

Verify that all of the following work end-to-end.

### Games
- create game;
- 2–6 players;
- common starting balance;
- fixed Pass GO reward;
- save to D1;
- list saved games;
- resume saved game.

### Players
- name;
- color;
- balance;
- balance persists correctly.

### Banking
- Player → Player;
- Player → Bank;
- Bank → Player;
- Player → All;
- All → Player;
- Pay Rent;
- Pass GO.

### Financial rules
- integer amounts;
- no zero payments;
- no negative payments;
- balances never negative;
- correct total calculation for Player → All;
- correct validation for All → Player;
- no partial multi-player transactions.

### Confirmation
Every balance-changing action requires confirmation.

### History
- global history;
- player history;
- optional comments;
- timestamps;
- correct transaction types.

### Dice
- two dice;
- 1–6 each;
- correct total;
- doubles;
- animation;
- responsive UI;
- no accidental game-engine integration.

## Persistence consistency

Inspect the complete write path:

```text
UI
→ API
→ service
→ repository
→ D1
```

Verify that failed financial operations cannot leave partially modified balances.

Verify transaction records correspond to successful balance mutations.

Look for concurrency or consistency issues appropriate to this single-device MVP.

Do not introduce distributed-system complexity unnecessarily.

## Security/basic backend hygiene

Even without authentication:
- validate all request payloads;
- reject malformed IDs;
- avoid SQL injection;
- avoid exposing stack traces;
- avoid secrets in frontend source;
- avoid production credentials in git;
- ensure Worker errors are standardized.

Do not build authentication.

## Code quality

Look for:
- duplicated payment logic;
- business rules inside React components;
- duplicated API types;
- unnecessary `any`;
- unsafe type casts;
- dead generated demo code;
- unused dependencies;
- excessive components/hooks;
- inconsistent naming.

Fix issues that materially improve maintainability.

Avoid speculative refactoring.

## Tests

Run the complete existing test suite.

Add missing high-value tests if necessary.

Prioritize:
1. banking domain;
2. transaction persistence;
3. API validation;
4. critical UI flows;
5. dice utility.

Do not chase meaningless coverage percentages.

## Build

Run all relevant project checks, such as those present in `package.json`:

```text
test
typecheck
lint
build
```

Use only scripts that actually exist or add standard scripts when clearly missing and useful.

Resolve errors caused by the application.

## Cloudflare/D1 readiness

Review:
- Wrangler config;
- Worker binding;
- D1 binding;
- migrations;
- static assets/frontend routing;
- production build;
- environment assumptions.

Do not deploy automatically unless deployment is already part of the user's explicit current instruction.

Instead provide the exact final deploy/migration commands required for this repository.

## Final output

At the end provide a concise release report:

### Implemented
List completed MVP functionality.

### Validation
List commands/tests executed and results.

### Deployment
List exact commands needed to:
1. apply production D1 migrations;
2. deploy the application.

### Remaining known limitations
Only list genuine MVP limitations.

Explicitly confirm that these features remain out of scope:

```text
board
properties
houses/hotels
mortgages
automatic rent
jail
Chance
Community Chest
turn management
player positions
authentication
multiplayer devices
WebSockets
Durable Objects
transaction undo
```

Do not add those features.