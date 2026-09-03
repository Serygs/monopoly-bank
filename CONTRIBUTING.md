# Contributing

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

## Before opening a pull request

```bash
npm run lint
npm test
npm run build
```
