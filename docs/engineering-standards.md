# Engineering standards

I hold every change in this repository to the rules below. CONTRIBUTING.md links here so contributors work to the same bar.

## 1. Code
1. Clarity over cleverness. Names say what a thing is in the domain (`dragCoefficient`, not `val2`). Units go in names or types (`timeoutMs`, `velocity_mps`).
2. Small units: a function does one thing; files stay focused (soft cap ~300 lines). No god modules, no `utils` junk drawer; name modules by responsibility.
3. Pure core, thin I/O shell. Business logic has no network, filesystem, clock or randomness hidden inside; pass them in. This is what makes it testable.
4. Types are strict and honest: no `any`, no `# type: ignore`, no `!` non-null assertions, no casts to silence the checker. Model states explicitly (discriminated unions / enums) instead of booleans and nullable soup.
5. Errors: validate at trust boundaries (user input, files, network, model output) and fail loudly with an actionable message. Never swallow exceptions. No defensive checks for states the types already rule out.
6. No magic numbers: named constants with units and a one-line source/reason when non-obvious.
7. No global mutable state. No singletons unless the platform forces it.
8. Dependencies: few, maintained, pinned, licence-compatible. Never add a dependency for something the standard library or an existing dependency does in a few lines.
9. Performance claims come from a benchmark script in the repo, never from prose.

## 2. Code quality pitfalls
- Comments that narrate the code (`# increment i`), banner comments, or docstrings that restate the signature. Comments explain *why*, constraints, or sources. Public APIs get concise doc comments.
- Wrapper functions that only forward arguments; abstract base classes with one implementation; factories nobody needs; "manager"/"helper"/"handler" classes without a real responsibility.
- Over-defensive try/except around everything, redundant `isinstance` checks, re-validating already-validated data.
- Dead code, commented-out code, unused imports/params/exports, placeholder `pass`/`TODO` without an issue link, `print` debugging, leftover feature flags.
- Near-duplicate code blocks; inconsistent naming styles; mixed formatting.
- Emoji in code, logs or CLI output; marketing words in docs ("robust", "seamless", "blazing", "leverage", "cutting-edge"); exclamation marks in log messages.
- Excessive logging; log levels used meaningfully, structured where useful.
- Tests that assert nothing meaningful, snapshot everything, or mock the unit under test.
- Giant generated files committed without need; boilerplate copied in "for later".

## 3. Tests
- Test behaviour, not implementation. Deterministic (seeded randomness, fixed clocks). Fast unit tests for the pure core; a few integration tests for the shell; golden files for numeric/model outputs with explicit tolerances; property-based tests for parsers and numerics where they add value.
- Every bug fix lands with the test that would have caught it.
- Coverage is a signal, not a goal: aim for high coverage of the core logic; do not write tests to hit a number.

## 4. Tooling
- TypeScript: `strict` plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`; typescript-eslint strict-type-checked (or Biome if configured); one formatter; Vitest; Playwright for UI.
- Python: uv with lockfile; ruff (lint + format, broad rule set); pyright strict or mypy strict; pytest.
- Rust: rustfmt, clippy with `-D warnings` (pedantic where sensible). Swift: swift-format, strict concurrency.
- Pre-commit hooks run format, lint and type check. CI runs the same plus tests on every PR; main is protected and green.

## 5. Repo hygiene
- LICENSE, README, CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md, CHANGELOG.md (Keep a Changelog), semantic versioning, `.editorconfig`, issue and PR templates, Dependabot or Renovate, CodeQL (free for public repos), lockfiles committed, no secrets ever (use `.env.example`).
- `docs/architecture.md` with a diagram; `docs/adr/` with a short decision record for every major choice.
- Reproducibility: one command to set up, one to test, one to run the demo. Scripts that download models verify checksums.

## 5a. Repository documents
- CONTRIBUTING.md links to these engineering standards so contributors see the same bar.
- When I add or refresh a pin I confirm it is the latest stable release (`npm view <pkg> version`, `uv pip index versions <pkg>` or the registry page), take the newer stable version if one exists, and note the change in the lockfile commit. A pin never moves backwards without a decision record.

## 6. Git
- Small, atomic commits with conventional-commit messages that explain why. One logical change per PR, with a description and screenshots for UI.
- History stays clean: no "fix typo" chains on main (squash or fixup before merge).

## 7. Accessibility and UX (for anything with a UI)
- Keyboard reachable, visible focus, semantic HTML, labelled controls, colour contrast meeting WCAG 2.2 AA, `prefers-reduced-motion` respected, no information conveyed by colour alone.

## 8. Before a change is done
1. Read the task and the files it touches. 2. Write or update the test first where practical. 3. Implement the smallest complete change. 4. Run format, lint, type check and tests; all must pass. 5. Re-read your own diff against sections 1 and 2 and fix anything that fails. 6. Commit with a proper message. Never mark a task done with failing checks or skipped tests.
