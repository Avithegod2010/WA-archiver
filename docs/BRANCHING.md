# Branching Model — stable / beta

> Adopted at v1.0.1 (post-security-audit), per the product decision:
> *"Diverge the project into stable and beta; new features are coded on beta."*

## Branch layout

| Branch | Purpose | Version line | Stability |
|---|---|---|---|
| `main` | Trunk — mirrors the current release line; security fixes land here first | `1.0.x` | release quality |
| `stable` | The supported release branch. Tags/artifacts (APK builds, source zips) are cut from here | `1.0.x` | hardened, slow-moving |
| `beta` | **All new features land here.** May break; may change UI; experimental | `1.1.0-beta.N` | best-effort |
| `v1.0` | Frozen orphan snapshot of the original v1.0 release (release-kit source zip) | `1.0.0` | immutable |

Current: `main` = `stable` = `da98ffc` (v1.0.1, security-audited), `beta` = `da98ffc` + beta-only commits.

## Workflow rules

1. **New features → `beta` only.** No feature commits on `stable`/`main`.
2. **Bug fixes that affect released behavior** → land on `main` first, then
   merge forward: `git checkout beta && git merge main`.
3. **Release train (beta → stable):** when a beta build has soaked (browser
   regression sweep + console 0/0/0 + tsc/lint clean):
   - `git checkout stable && git merge --no-ff beta`
   - bump version to release (`1.1.0`), tag `v1.1`, push.
   - `main` fast-forwards to the same tree.
4. **Security fixes** may land directly on `main`/`stable` (hotfix) and are
   merged into `beta` immediately after.
5. The GitHub Actions APK workflow builds from whatever branch is pushed —
   APK artifacts from `stable` are release candidates; from `beta` they are
   test builds.

## Version scheme

- `stable`: `MAJOR.MINOR.PATCH` (current `1.0.1`)
- `beta`: `MAJOR.(MINOR+1).0-beta.N` (current `1.1.0-beta.1`)
