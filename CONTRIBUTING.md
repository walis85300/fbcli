# Contributing to fbcli

Thanks for your interest in contributing.

## Development setup

```bash
git clone https://github.com/r-po/fbcli.git
cd fbcli
npm install
```

Requirements:

- Node.js 22+
- npm

## Run checks locally

Before opening a pull request, run:

```bash
npm run ci:check
```

If you are changing behavior, add or update tests in `tests/`.

## Workflow

1. Fork the repository.
2. Create a branch for your change.
3. Keep changes focused and small.
4. Include tests for behavior changes.
5. Open a pull request with clear context.

## Pull request expectations

- Explain what changed and why.
- Mention any command/output contract changes.
- Link related issues if available.

## Security and secrets

- Do not commit tokens, app secrets, or credentials.
- If credentials are exposed, rotate/revoke them immediately.
