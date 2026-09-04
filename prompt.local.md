Так я б це розбив. Важливий момент: після Phase 4 це вже не просто single-device app. З’являються accounts, private games, join links, multi-device access і realtime sync, тому архітектуру треба міняти контрольовано, а не одним великим PR. Для realtime на Cloudflare логічний варіант — Durable Object per game + WebSocket Hibernation, а D1 залишити для persistent data/history. Cloudflare прямо рекомендує Durable Objects як coordination point для multiplayer-style realtime state.

Monopoly Bank — Feature Expansion Prompts

Run the phases sequentially.

Always use the $monopoly-bank-dev skill.

Before each phase:

* inspect the minimum relevant files;
* reuse existing architecture;
* avoid unrelated refactors;
* preserve existing behavior unless this phase explicitly replaces it;
* run the relevant tests/checks before finishing.

⸻

Phase 1 — Currency support and money formatting

Use the $monopoly-bank-dev skill.

Add configurable currency support to Monopoly Bank.

Goal

Each game must have a selected currency.

Supported currencies:

USD
EUR
UAH
K

K is a generic Monopoly-style thousands currency and has no real-world currency symbol requirement.

Game creation

Add a required currency selector when creating a game.

Default to:

K

unless the existing product conventions suggest another default.

Currency must be persisted as part of the game.

Once a game has started, do not allow changing the currency unless the current architecture already supports safe game settings edits.

Display rules

Use consistent display formatting across the entire application.

Examples:

USD:
$1 000
$25 000
EUR:
€1 000
€25 000
UAH:
₴1 000
₴25 000
K:
1 000k
25 000k

If the existing application treats values as “thousands”, adapt the implementation carefully so semantics remain consistent.

Do not silently change stored monetary values in a way that breaks existing games.

Create one centralized money formatting utility.

Do NOT manually format amounts inside individual React components.

Number grouping

All displayed monetary values must use a space as the thousands separator.

Examples:

1 000
10 000
100 000
1 000 000

Never display:

1000000
1,000,000

for user-facing monetary values.

Use a non-breaking-space or equivalent strategy if needed so grouped amounts remain readable and do not break awkwardly across lines.

Apply this consistently to:

* wallet balances;
* transaction history;
* confirmation dialogs;
* game summary;
* quick amounts;
* favorites;
* recent amounts;
* errors;
* bankruptcy screens;
* Pass GO;
* statistics.

Persistence

Add a D1 migration if needed.

Existing games must receive a sensible default currency:

K

unless current data indicates another safer default.

Tests

Add tests for:

* USD formatting;
* EUR formatting;
* UAH formatting;
* K formatting;
* 1 000;
* 10 000;
* 1 000 000;
* zero where applicable;
* negative delta formatting for animations/history;
* migration/default behavior.

Run tests, typecheck, lint, and build.

Do not implement the custom numeric keypad yet.

⸻

Phase 2 — Replace payment amount UX with an on-screen numeric keypad

Use the $monopoly-bank-dev skill.

Improve monetary input UX for mobile devices.

Problem

On iPhones, focusing a normal numeric input may:

* open the software keyboard;
* zoom the page;
* alter viewport positioning;
* force the user to manually recover the original layout.

For Monopoly Bank, payment input should be possible without opening the phone keyboard.

Goal

Create a reusable on-screen numeric keypad for all primary monetary operations.

The normal amount input must still exist, but users must be able to complete the entire payment amount entry using on-screen buttons only.

Numeric keypad

Create a compact keypad based on:

1 2 3
4 5 6
7 8 9
⌫ 0 Clear

The visual numeric area should effectively follow a 3-column layout.

Required actions:

* digits 0–9;
* backspace/remove one digit;
* clear entire amount.

You may use a better icon/label for backspace if accessible.

Input behavior

The displayed amount field should:

* update from keypad taps;
* show grouped digits live using spaces;
* remain compatible with normal manual keyboard input;
* contain only positive integer monetary amounts;
* prevent leading-zero garbage;
* prevent values beyond a sensible safe integer limit.

Example:

User taps:

1
0
0
0
0
0
0

UI displays:

1 000 000

Store/use the numeric value internally, not the formatted display string.

Prevent unwanted iPhone zoom

Adjust mobile input styling so manually focusing the input does not cause Safari/iOS auto-zoom.

Use appropriate input font sizing and viewport-safe responsive design.

Do NOT disable user zoom globally with hostile accessibility settings such as:

user-scalable=no
maximum-scale=1

Keep the application accessible.

Integration

Use the keypad for all flows requiring monetary amount entry:

* Pay Player;
* Pay Bank;
* Receive from Bank;
* Pay Everyone;
* Everyone Pays Me;
* any other existing manual monetary operation.

Integrate existing:

* Quick amounts;
* Favorites;
* Recent amounts.

The UX should allow:

Quick amounts
Favorites / Recent
Custom keypad amount

without making the modal excessively tall.

Mobile layout

On phones, prioritize:

1. current source/destination;
2. entered amount;
3. keypad;
4. quick/favorite/recent values;
5. confirmation action.

Avoid requiring repeated page scrolling just to enter and confirm a payment.

Tests

Test:

* digit entry;
* zero;
* backspace;
* clear;
* formatting;
* max length/limit;
* keypad + quick amount interaction;
* keypad + manual input interaction.

Do not write brittle pixel-level layout tests.

⸻

Phase 3 — Merge Pay Player and Pay Rent

Use the $monopoly-bank-dev skill.

Simplify payment flows.

Currently:

Pay Player
Pay Rent

represent the same underlying operation:

Player → Player

Remove the duplicate UX.

Goal

Keep only one primary action:

Pay Player

or a clearer equivalent such as:

Send Money

Choose whichever best matches the existing application terminology.

The user selects:

* payer;
* recipient;
* amount;
* optional comment.

Remove the separate Pay Rent action from primary UI.

Domain/API cleanup

Review whether PAY_RENT still exists as a separate transaction type.

If it is no longer required for product behavior:

* migrate/refactor toward a single PLAYER_TO_PLAYER transaction type;
* preserve existing historical data compatibility.

Do not break old transaction history.

If old PAY_RENT records exist:

* continue rendering them correctly;
* new transfers should use the unified flow.

Avoid destructive data migrations unless necessary.

UI cleanup

Remove duplicated:

* buttons;
* modal components;
* validation logic;
* tests.

Use one implementation path.

Run full relevant tests afterward.

⸻

Phase 4 — iPhone Pro Max responsive UX overhaul

Use the $monopoly-bank-dev skill.

Perform a focused mobile UX redesign for iPhone Pro Max-sized devices and similar modern large phones.

The goal is not merely responsive CSS. Optimize the actual gameplay workflow for a physical Monopoly game where users frequently rotate the phone and perform many payments.

Target device families

Support recent and older iPhone Pro Max-sized viewports, including portrait and landscape layouts.

Do not hardcode UI to a single exact device resolution.

Design using responsive breakpoints, safe areas, flexible layouts, and orientation-aware composition.

Safe areas

Support iPhone:

* notch;
* Dynamic Island;
* home indicator;
* landscape safe areas.

Use:

env(safe-area-inset-top)
env(safe-area-inset-right)
env(safe-area-inset-bottom)
env(safe-area-inset-left)

where appropriate.

Do not let important controls sit underneath system UI.

Touch target sizing

Primary controls should generally target approximately:

44–48 CSS px minimum touch height

with adequate spacing.

For frequently used game controls, prefer approximately:

48–56px

where layout permits.

Do not create giant desktop-style buttons that force vertical scrolling.

Portrait optimization

The main game screen should aim to show as much as possible without scrolling.

For up to 6 players:

* use compact wallet cards;
* prioritize balance and player identity;
* avoid verbose labels;
* keep primary game actions quickly accessible.

Consider a responsive 2-column card layout where appropriate.

Landscape optimization

When the phone rotates horizontally:

* do NOT keep the same vertical stacked layout;
* use horizontal space aggressively;
* reduce unnecessary header height;
* arrange wallets and actions side-by-side where practical;
* keep payment interactions compact enough to fit without constant scrolling.

For payment modals/drawers:

* consider two-column layout in landscape;
* player/payment summary on one side;
* keypad/actions on the other.

Amount entry UX

The numeric keypad from Phase 2 should be optimized separately for:

portrait
landscape

In landscape:

* make buttons shorter vertically;
* preserve comfortable touch width;
* avoid requiring page scrolling for digits + confirmation.

Bottom actions

Consider a sticky/bottom action area for primary commands on mobile where it genuinely improves usability.

Respect safe-area bottom inset.

Do not hide important actions behind hover.

Typography

Balances must remain highly readable.

Avoid text below comfortable mobile size.

Normal form inputs should use at least approximately:

16px

to prevent iOS Safari zoom behavior.

UX audit

Review:

* Saved Games;
* Create Game;
* Game screen;
* Player actions;
* Payment flow;
* Confirmation;
* History;
* Dice;
* Settings;
* Game summary.

Check both:

portrait
landscape

Avoid:

* page-level horizontal scrolling;
* clipped dialogs;
* overlapping fixed elements;
* unnecessary vertical scrolling;
* oversized headers.

Run tests/build after the responsive refactor.

⸻

Phase 5 — User accounts, profiles, private game ownership and game joining

Use the $monopoly-bank-dev skill.

This phase changes Monopoly Bank from an anonymous shared application into a multi-user application.

Inspect the existing Cloudflare Worker/D1 architecture before changing it.

Do NOT implement realtime WebSockets yet. That comes in a later phase.

Goals

Implement:

* user accounts;
* login/session support;
* profile nickname;
* avatar;
* private game ownership/membership;
* game password;
* joining/importing a game;
* shareable invitation link;
* user-specific saved game list.

User accounts

Create persistent user accounts.

Each account should have at minimum:

id
nickname
avatar
createdAt
updatedAt

Add authentication credentials using a secure approach appropriate for the current Cloudflare Workers stack.

Do not invent custom insecure cryptography.

Never store plaintext passwords.

If implementing password authentication directly:

* use an appropriate secure password hashing approach supported by the runtime;
* use secure session tokens;
* use HttpOnly/Secure/SameSite cookies where appropriate;
* protect authenticated endpoints.

Avoid storing auth tokens in localStorage if cookie-based sessions are appropriate.

Avatar

Allow users to choose an avatar.

For the first implementation, prefer a lightweight approach:

* predefined avatar set;
* initials avatar;
* generated avatar;

rather than introducing object storage/file uploads unless there is a strong reason.

Users should be able to change their avatar and nickname.

Game ownership

Each game must have an owner.

A user opening their Saved Games screen must only see:

* games they own;
* games they have joined as a member.

They must NOT see unrelated games belonging to other users.

Enforce this server-side.

Do not rely only on frontend filtering.

Game password

Allow the game owner to set a game password when creating the game.

Requirements:

* password is required to join unless the invitation mechanism securely embeds/uses another authorization token;
* never return stored password/hash to clients;
* never log passwords;
* use secure comparison/storage practices.

Clarify in code naming that this is a game access password, not the user account password.

Join/import game

Provide a flow such as:

Join Game

Allow joining by:

Game name / join identifier
+
Game password

Do not rely only on human-readable game names as globally unique identifiers.

If users search/import by name:

* resolve ambiguity safely;
* require password;
* do not expose other users’ private game metadata unnecessarily.

Prefer generating a short join code or internal game join ID in addition to the display name.

Example:

Game: Friday Monopoly
Join code: R7K4P2

The game name remains user-friendly, while join code is used for deterministic lookup.

Share invitation link

Add:

Share Join Link

Generate a URL equivalent to:

https://<app-domain>/join/<join-token-or-code>

The link should open the app directly into the join flow.

Use the Web Share API on supported phones:

navigator.share(...)

with graceful fallback such as showing/copying the join URL.

Do not require Web Share support.

Do not expose raw sensitive game passwords inside URLs.

Membership

Create a many-to-many model where appropriate:

users
games
game_members

A joined user becomes a member of the game.

Store membership role if useful:

OWNER
PLAYER

Do not overbuild a large RBAC system.

Player/account relationship

Existing Monopoly players and application accounts are different concepts.

Model them explicitly.

A user account may be linked to one player in a game.

Example:

User account:
Severyn
Game:
Friday Monopoly
Player identity in game:
Red / Severyn

Support game players who do not yet have a registered account if this preserves compatibility with existing games.

When a registered member joins a game, allow them to claim/link an available player seat.

Do not automatically assume account ID equals player ID.

Authorization

Enforce server-side:

* only game members can read game state/history;
* only game members can submit normal game actions;
* only owner can perform owner-only management actions;
* users cannot enumerate or retrieve unrelated games.

Add authorization tests.

Migration

Existing games must remain accessible.

Design a safe migration/default ownership strategy and document any manual ownership assignment required for already-created production games.

Run all relevant security/auth tests.

⸻

Phase 6 — Player profiles and persistent statistics

Use the $monopoly-bank-dev skill.

Implement account-level player statistics.

This phase depends on user accounts and game membership from Phase 5.

Profile

Each registered user profile should expose:

nickname
avatar
gamesPlayed
gamesWon
winRate

Additional useful statistics may include:

totalMoneySent
totalMoneyReceived
totalTransactions
bankruptcies

Keep the first version concise.

Game participation

Only completed games count toward:

gamesPlayed
gamesWon

Do not count abandoned/in-progress games as completed games.

Win definition

For this application, use the following custom rule:

A player is considered a winner if they remain active when:

either:
- two players have become bankrupt;
  OR
- only two active players remain

Interpret this carefully based on starting player count.

Do not blindly award victory after two bankruptcies in a three-player game if the resulting state conflicts with the “remaining players” rule.

Create a single centralized winner calculation function.

The game completion flow should determine the final winners from the remaining active players according to this custom rule.

Multiple winners are allowed.

Example:

6 players started
2 become bankrupt
4 remaining players can be recorded as winners

if that is the configured business rule.

However, if the intended rule produces unusual results, keep the implementation explicitly named/documented as the application’s custom victory rule rather than official Monopoly behavior.

Statistics persistence

Do not recompute expensive lifetime profile statistics from every historical transaction on every profile request.

Choose either:

* aggregate on game finish and persist;
* or use efficient queries if existing scale makes that simpler.

Updates performed when finishing a game must be idempotent.

Finishing/reopening/retrying a request must not increment stats twice.

Profile UI

Add a profile screen/card showing:

* avatar;
* nickname;
* games played;
* games won;
* win rate.

Make it mobile-friendly.

Add tests for:

* winner calculation;
* multiple winners;
* profile aggregation;
* duplicate finish requests;
* bankrupt players not counted as winners.

⸻

Phase 7 — Bankruptcy, game completion and advanced game summary

Use the $monopoly-bank-dev skill.

Expand the existing bankruptcy and finish-game functionality.

Bankruptcy action

Each ACTIVE player should have:

Declare Bankrupt

The user must choose whether bankruptcy is:

To Bank
or
To Player

Bankruptcy caused by another player

If bankrupt to another player:

* select creditor;
* transfer the bankrupt player’s entire remaining balance to creditor;
* set bankrupt player’s balance to 0;
* mark player as BANKRUPT;
* remove them from future active-player operations;
* persist everything atomically;
* create clear history/event records.

Bankruptcy to Bank

If bankruptcy is not caused by another player:

* set balance to 0;
* mark player BANKRUPT;
* no other player receives the remaining balance.

Require explicit confirmation.

Automatic game-state evaluation

After every bankruptcy:

* calculate active player count;
* evaluate the custom victory condition from Phase 6;
* do not automatically finish unless this matches the agreed application rule;
* if the winning condition has been reached, present a clear option to finish the game and show winners.

Finish Game

Add a prominent:

Finish Game

action for the owner.

Require confirmation.

Once finished:

* game becomes read-only;
* financial operations are disabled;
* dice/game actions are disabled;
* realtime state should later broadcast final state;
* final summary remains available;
* player/account statistics are finalized exactly once.

Game duration

Persist:

startedAt
finishedAt

Display duration in a human-readable format.

Example:

2h 17m

Final game summary

Show:

Game

Game name
Started
Finished
Duration
Currency
Players
Winners

Money

Calculate:

Total money transferred
Total player-to-player money
Total money paid to Bank
Total money received from Bank
Largest transaction

Be explicit about what “total money spent” means.

Do not incorrectly double-count one transfer as both sender expenditure and receiver income when reporting global transferred volume.

Player analytics

For every player show:

Final balance
Status
Total sent
Total received
Transaction count

Calculate:

player who sent the most money overall
player who sent the least money overall

Also calculate the strongest payer→recipient relationship:

Who transferred the most money
to which specific player
and how much

Example:

Alex sent the most to John:
3 450 USD across 12 payments

Optionally show number of transactions.

Ignore Bank as a player when answering “to which player”.

Handle ties deterministically and clearly.

Summary tests

Test:

* global transfer totals;
* sender totals;
* recipient totals;
* Bank transactions;
* group payments;
* largest transaction;
* biggest payer→recipient pair;
* least sender;
* bankruptcy transfers;
* currency formatting;
* winners.

Do not derive results from UI state.

Use persisted authoritative transaction/game data.

⸻

Phase 8 — Real-time multi-device game synchronization

Use the $monopoly-bank-dev skill.

Convert active Monopoly games into real-time collaborative sessions so multiple registered game members can use the application simultaneously from their own phones.

This is a major architectural phase.

Do not implement this as frequent client polling unless a fallback is needed.

Target architecture

Keep Cloudflare D1 as persistent application storage/history.

Add:

Cloudflare Durable Object
per active game

as the single coordination point for concurrent game mutations.

Use:

WebSockets

for realtime client updates.

Prefer Cloudflare Durable Objects WebSocket Hibernation API.

A single game should map deterministically to a single Durable Object instance.

Example concept:

gameId
→ GameSession Durable Object
→ all connected game members

Why

All clients in the same game must observe an authoritative mutation order.

Examples:

Phone A:
John pays Alex 200
Phone B:
John pays Bank 500

These concurrent actions must not independently validate against a stale balance and produce an invalid negative result.

The GameSession coordinator must serialize/coordinate state-changing operations.

Do not rely on frontend timestamps to resolve conflicts.

Responsibilities

D1

Remain source of durable persistent data for:

* users;
* games;
* memberships;
* players;
* transactions;
* finished game data;
* long-term statistics.

Durable Object

Coordinate live game operations:

* connected users;
* balance-changing commands;
* current authoritative game version/state;
* broadcasts;
* concurrency serialization.

Do not duplicate all long-term D1 data unnecessarily.

WebSocket connection

Expose a secure game WebSocket endpoint similar to:

/api/games/:gameId/live

Authenticate the session before accepting the connection.

Verify:

* authenticated user;
* game membership;
* game status.

Reject unauthorized users.

Realtime events

Define typed WebSocket contracts.

Examples:

GAME_STATE
TRANSACTION_CREATED
BALANCES_UPDATED
PLAYER_BANKRUPT
GAME_FINISHED
PLAYER_UPDATED
MEMBER_JOINED

Do not send arbitrary untyped JSON structures.

Create shared TypeScript event contracts.

Mutation model

Prefer this pattern:

Client
→ sends mutation command through authenticated API/DO
→ server validates authoritative current state
→ mutation committed
→ transaction/history persisted
→ Durable Object broadcasts resulting state/event
→ every connected client updates

Avoid:

client changes local balance
→ broadcasts its own value

The server must remain authoritative.

Concurrent payment safety

Two concurrent operations touching the same player must be processed safely.

Example:

John balance = 500
Request A:
John pays Alex 400
Request B:
John pays Mike 400

Exactly one may succeed if processed after the first leaves insufficient funds.

The system must never produce:

John = -300

Use atomic/transactional persistence where needed.

D1 batch() can execute grouped statements transactionally and roll back the batch if one statement fails; use the appropriate persistence pattern supported by the existing architecture rather than independent partial writes. (⁠Cloudflare Docs)

Reconnection

Clients must recover cleanly after:

* temporary network loss;
* phone locking;
* browser backgrounding;
* Worker/DO hibernation;
* WebSocket reconnect.

On reconnect:

1. authenticate again if required;
2. connect to the game’s Durable Object;
3. retrieve/currently receive authoritative game state;
4. replace stale local game state.

Do not assume missed WebSocket messages will be replayed automatically.

Hibernation

Use Durable Object WebSocket Hibernation so inactive game sessions can hibernate without dropping WebSocket clients where supported.

Do not depend on in-memory variables surviving hibernation.

Persist/reconstruct necessary connection metadata appropriately.

Client state

React should maintain a local rendered snapshot, but it is not authoritative.

After receiving server events:

* update balances;
* history;
* player statuses;
* finished state.

Avoid requiring manual refresh.

Optimistic UI

For financial operations, prefer conservative UX:

Submitting...
→ authoritative success
→ update UI

rather than optimistic balance mutations that may have to be rolled back.

Fast visual feedback is still fine, but do not present an unconfirmed financial balance as authoritative.

Presence

Optionally show lightweight status:

3 players connected

Do not build chat/presence complexity beyond that.

Duplicate submissions

Every mutation command should include an idempotency identifier.

Example:

commandId: UUID

Retries/reconnections must not accidentally execute the same transfer twice.

Persist or track enough information to enforce idempotency.

History

When any device completes a transaction:

all connected devices should receive the resulting update and see:

* new balances;
* new history entry;
* updated summary/statistics where relevant.

UI

Add a subtle connection indicator:

Live
Reconnecting…
Offline

When offline:

* do not allow financial mutations that cannot be safely synchronized;
* preserve read-only last known state;
* automatically reconnect where reasonable.

Tests

Add high-value tests for:

* two connected clients receive the same update;
* unauthorized connection rejected;
* non-member rejected;
* concurrent spending cannot cause negative balance;
* duplicate command IDs do not double-charge;
* reconnect receives current state;
* bankruptcy broadcast;
* game-finished broadcast;
* member joins and receives current state.

Do not create fragile tests based on timing sleeps when deterministic coordination can be tested directly.

Cloudflare configuration

Update Wrangler with the required Durable Object bindings and migrations.

Use SQLite-backed Durable Objects if that matches current Cloudflare recommendations and project constraints.

Do not remove D1.

Do not deploy production resources automatically.

At the end provide exact commands needed to:

1. apply D1 migrations;
2. apply/deploy Durable Object migrations/config;
3. deploy the Worker/application.

Cloudflare currently recommends Durable Objects as the single coordination point when multiple WebSocket clients need to share realtime game state, and its WebSocket Hibernation API is the preferred server-side WebSocket mode for reducing idle duration costs. (⁠Cloudflare Docs)

⸻

Phase 9 — Final integration, security and mobile multiplayer audit

Use the $monopoly-bank-dev skill.

Perform a complete audit of all features introduced in Phases 1–8.

Do not add unrelated features.

Verify end-to-end

Money UX

* currencies work;
* thousands are separated by spaces;
* keypad works without phone keyboard;
* manual input still works;
* no iPhone auto-zoom issue;
* Quick/Favorite/Recent integration works.

Responsive UI

Verify:

iPhone Pro Max portrait
iPhone Pro Max landscape
tablet
desktop

No major workflow should require excessive scrolling.

Users

Verify:

* registration/login;
* secure sessions;
* profile;
* avatar;
* nickname;
* private game listing.

Games

Verify:

* create;
* game password;
* join by code/name flow;
* invitation link;
* membership;
* duplicate;
* resume;
* finish.

Security

Verify users cannot:

* access unrelated games by changing URL IDs;
* list other users’ games;
* submit transactions to games they have not joined;
* impersonate another account;
* retrieve password hashes;
* reuse malformed/expired session tokens.

Realtime

Open the same game conceptually from multiple clients.

Verify:

Client A sends payment
→ Client B updates automatically
Client B declares bankruptcy
→ Client A updates automatically

Verify concurrent payment safety.

Statistics

Verify:

* games played;
* games won;
* winner rules;
* total sent;
* total received;
* final summary;
* strongest payer→recipient relation;
* lowest/highest sender statistics.

Database

Review all migrations.

Ensure foreign keys/indexes exist where needed for:

* users;
* sessions;
* game membership;
* players;
* games;
* transactions;
* statistics;
* join codes/tokens.

Add indexes only where queries justify them.

Cleanup

Remove:

* obsolete Pay Rent UI;
* duplicated money formatters;
* old single-device assumptions;
* dead APIs;
* stale types;
* unused dependencies;
* console debug logging.

Validation

Run the complete quality pipeline:

npm run check
npm run build

plus all integration/realtime/auth tests.

Do not deploy.

Final report should include:

1. final architecture;
2. migrations;
3. auth approach;
4. realtime approach;
5. tests executed;
6. known limitations;
7. production migration commands;
8. deployment command.

Architecture after these phases

The important change is this:

React clients
↓
Cloudflare Worker
↓
Authentication / authorization
↓
Game Durable Object
↓
┌───────────────┐
│ authoritative │
│ live session  │
└───────────────┘
↓       ↓
WebSockets   D1
↓
all phones

I would not replace D1 with Durable Object storage completely. D1 remains a good place for users, memberships, transaction history, saved games and lifetime statistics, while a per-game Durable Object solves the realtime concurrency problem. Durable Objects are explicitly designed to coordinate multiple clients for multiplayer/collaborative workloads, including WebSockets.  