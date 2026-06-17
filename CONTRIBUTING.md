# Contributing to realtime-mongo

Thank you for your interest in contributing. This guide covers everything you need to get started: environment setup, development workflow, testing, and the pull request process.

---

## Prerequisites

| Tool    | Version            | Notes                              |
| ------- | ------------------ | ---------------------------------- |
| Node.js | 18.0.0+            | Required for `crypto.randomUUID()` |
| pnpm    | 8.0.0+             | `npm install -g pnpm`              |
| MongoDB | 6.0+ (Replica Set) | Required for Change Streams        |

> **Note on `moduleResolution`:** The base `tsconfig.json` uses `"moduleResolution": "Bundler"`. This is correct for tsup-based builds but means running `tsc` directly for type-checking (not compilation) requires the `--noEmit` flag. Always use `pnpm typecheck` rather than invoking `tsc` directly.

---

## Setup

```bash
# Clone the repository
git clone https://github.com/nasyx-rakeeb/realtime-mongo.git
cd realtime-mongo

# Install all dependencies across the monorepo
pnpm install

# Build all packages (shared must build before server/client/react)
pnpm build
```

---

## Project Structure

```
realtime-mongo/
├── packages/
│   ├── shared/     # Protocol types, Zod schemas, VClock — no runtime deps
│   ├── server/     # Node.js server SDK
│   ├── client/     # Browser/Node.js client SDK
│   └── react/      # React hooks (depends on client)
├── docs/           # Architecture, protocol spec, security model, roadmap
├── scripts/        # Developer tooling (benchmark, load test)
├── .changeset/     # Changeset configuration for versioning
└── .github/        # CI workflows and issue templates
```

---

## Development Workflow

### Running commands

```bash
# Build all packages
pnpm build

# Run all tests
pnpm test

# Type-check all packages
pnpm typecheck

# Lint all packages
pnpm lint

# Format code
pnpm format
```

To run commands for a single package:

```bash
pnpm --filter @realtimemongo/server build
pnpm --filter @realtimemongo/client test
```

### Build order

Turborepo handles the dependency graph automatically. `shared` always builds before `server`, `client`, and `react`. You do not need to manage this manually.

---

## Making Changes

### Branching

- `main` — stable, always releasable
- `develop` — integration branch for in-progress work
- Feature branches: `feat/your-feature-name`
- Bug fix branches: `fix/brief-description`

### Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(server): add projection option to registerCollection
fix(client): reset backoff on successful stream recovery
docs: update security model with token rotation guidance
chore: upgrade ws to 8.21.0
```

Types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `perf`

### Adding a changeset

Every PR that changes a package's public API or fixes a bug must include a changeset:

```bash
pnpm changeset
```

Follow the prompts to select affected packages and write a summary. Commit the generated `.changeset/*.md` file with your PR.

---

## Testing

Tests use [Vitest](https://vitest.dev). Integration tests for `server` and `client` spin up a real MongoDB instance via `mongodb-memory-server` — no external MongoDB is required.

```bash
# Run all tests
pnpm test

# Run tests for a specific package
pnpm --filter @realtimemongo/server test

# Run tests in watch mode
pnpm --filter @realtimemongo/shared test -- --watch
```

### Test structure

Each package has a `test/` directory with the following convention:

| File pattern            | Purpose                                        |
| ----------------------- | ---------------------------------------------- |
| `*.unit.test.ts`        | Pure unit tests, no I/O                        |
| `*.integration.test.ts` | Tests against real MongoDB or WebSocket server |

---

## Pull Request Process

1. Fork the repository and create a branch from `develop`.
2. Ensure `pnpm build`, `pnpm test`, and `pnpm lint` all pass.
3. Add a changeset if your PR changes a public API or fixes a bug.
4. Fill in the pull request template completely.
5. Request a review from a maintainer.

PRs that skip tests, break the build, or lack a changeset for API-affecting changes will not be merged.

---

## Code Style

- **TypeScript strict mode** is enforced — no `any` in public APIs.
- **No default exports** — all exports are named.
- **JSDoc on all public API members** — classes, methods, types, and interfaces.
- **Comments explain intent, not mechanics** — do not describe what the code obviously does; explain why.
- Code is formatted with Prettier. Run `pnpm format` before committing.

---

## Reporting Issues

Use the GitHub issue templates:

- **Bug report** — unexpected behavior with a minimal reproduction.
- **Feature request** — describe your use case, not just the feature.

For security vulnerabilities, see [SECURITY.md](./SECURITY.md) — do not open a public issue.
