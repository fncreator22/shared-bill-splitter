# Contributing Guidelines

Thank you for contributing to the Shared Bill Splitter project. To maintain clean architecture, strict data integrity, and high reliability, please follow these guidelines.

---

## 1. Development Principles

- **YAGNI & Minimalism**: Keep implementations small, correct, and safe. Do not introduce unnecessary dependencies or speculative features.
- **Whole Integer Cents**: Monetary values must always be whole integer cents. Never use floating-point numbers for money.
- **Strict Typing**: All code must be strongly typed with TypeScript. Do not use `any`.
- **Uniform Errors**: All API error responses must adhere to `{ "error": "message" }`.

---

## 2. Branching Strategy

- **`main` Branch**: Contains stable, production-ready code. Direct pushes to `main` are restricted.
- **Feature Branches**: All contributions must be developed on a dedicated branch created from `main`:

  ```bash
  git checkout -b feat/<feature-name>
  # or for bug fixes:
  git checkout -b fix/<bug-name>
  ```

---

## 3. Pull Request Process

1. **Verify Quality Locally**: Before opening a Pull Request, ensure all local verification checks pass:

   ```bash
   pnpm check       # Biome format and lint check
   pnpm typecheck   # TypeScript compiler check
   pnpm test        # Vitest suite inside the Cloudflare Workers runtime
   pnpm build       # Web production build
   ```
2. **Commit Standards**: Use Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`). Keep commit messages descriptive and concise without AI-generated boilerplate.
3. **Open a Pull Request**:
   - Provide a clear summary of changes, rationale, and verification output.
   - All automated checks must pass before merging.

---

## 4. Code Quality & Pre-Merge Checklist

- [ ] All database changes are captured in idempotent migration files under `api/migrations/`.
- [ ] Database constraints guard integrity at the storage layer.
- [ ] Idempotency is enforced on financial transactions using `Idempotency-Key`.
- [ ] Unit and integration tests cover new behaviors and edge cases.
- [ ] `pnpm check`, `pnpm typecheck`, and `pnpm test` pass with 0 errors.
