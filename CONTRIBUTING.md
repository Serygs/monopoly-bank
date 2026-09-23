# Contributing

## First-time setup

```bash
nvm use            # Node.js 22, pinned in .nvmrc
npm install        # also installs the husky Git hooks
npm run setup      # applies the D1 migrations to your local database
npm run dev
```

`npm install` runs the `prepare` script, which installs the Git hooks described below. Details for the local environment are in [docs/local-development.md](docs/local-development.md).

## Branches

`main` is the protected release branch. Do not push directly to it.

Use `dev` as the integration branch. Create work branches from it using one of:

- `feature/<feature-name>`
- `fix/<fix-name>`
- `refactor/<refactor-name>`
- `chore/<chore-name>`

## Development flow

```bash
git checkout dev
git pull origin dev

git checkout -b feature/payment-history

# make changes

git add .
git commit -m "feat: add payment history"
git push -u origin feature/payment-history
```

Open a pull request from the feature branch into `dev`. After integration and validation, open a `dev` to `main` pull request. The `main` pull request requires the repository owner's approval and all required checks.

Never merge or push directly from a developer branch to `main`.

## Commit hooks

Two husky hooks run on every commit:

- **pre-commit** runs lint-staged. Staged `.ts` and `.tsx` files go through `eslint --fix` and `prettier --write`; staged `.js`, `.mjs`, `.cjs`, `.json`, `.jsonc`, `.md`, `.mdx`, `.yml`, `.yaml`, `.css` and `.html` files go through `prettier --write`. The fixed files are re-staged automatically.
- **commit-msg** runs commitlint against Conventional Commits:

  ```text
  <type>(<optional-scope>): <imperative summary>
  ```

  Allowed types: `feat`, `fix`, `docs`, `test`, `chore`, `refactor`, `perf`, `ci`, `style`, `build`, `revert`.
  Allowed scopes (optional): `worker`, `ui`, `e2e`, `docs`, `shared`, `db`, `tooling`, `deps`.
  Keep the summary lowercase, imperative and without a trailing period, for example `fix(worker): reject duplicate transfer commands`.

Hooks are a local convenience; CI remains the required merge gate and runs `npm run format:check` as well.

## Formatting

Prettier owns formatting for TypeScript, JavaScript, CSS, JSON, Markdown and YAML. Do not hand-align tables, imports or object literals: run `npm run format` (or let the pre-commit hook do it) and commit the result. `npm run format:check` reports without writing.

The repository-wide formatting pass is listed in `.git-blame-ignore-revs` so that `git blame` shows the real author of each line. Enable it once per clone:

```bash
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

## Before opening a pull request

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Run `npm run test:d1` as well when you touch `migrations/`. The pull request template asks you to confirm each of these.
