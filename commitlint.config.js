/**
 * Commit messages follow Conventional Commits: `type(scope): subject`.
 * Types and scopes mirror what the history already uses (`fix(worker):`,
 * `test(ui):`, `test(e2e):`, `docs:`). The scope is optional.
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'docs',
        'test',
        'chore',
        'refactor',
        'perf',
        'ci',
        'style',
        'build',
        'revert',
      ],
    ],
    'scope-enum': [2, 'always', ['worker', 'ui', 'e2e', 'docs', 'shared', 'db', 'tooling', 'deps']],
    'scope-empty': [0],
  },
};
