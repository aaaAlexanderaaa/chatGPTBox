# Releasing ChatGPTBox

Official releases of ChatGPTBox are cut by the **Release** GitHub Actions workflow
([.github/workflows/release.yml](.github/workflows/release.yml)), triggered manually via
`workflow_dispatch`. Manual local tag releases are kept as an emergency fallback through
[.github/workflows/tagged-release.yml](.github/workflows/tagged-release.yml).

## Prerequisites (one-time setup)

- **Branch protection caveat.** The finalize step pushes the `chore: release v<version>`
  commit and `v<version>` tag to `master` using the workflow's `GITHUB_TOKEN`. If
  `master` has branch protection enabled, allow pushes from GitHub Actions (or add an
  exception), otherwise the release commit/tag push will be rejected.
- **No external registry token required.** ChatGPTBox ships browser extension archives
  through GitHub Releases (`chromium.zip`, `firefox.zip`,
  `chromium-without-katex-and-tiktoken.zip`, `firefox-without-katex-and-tiktoken.zip`).
  The workflow uses the repository's built-in `GITHUB_TOKEN` with `contents: write`.

## Cutting a release

1. Land all intended changes on `master` with green checks.
2. Make sure both [README.md](README.md#unreleased) (`### Unreleased`) and
   [README_CN.md](README_CN.md#尚未发布) (`### 尚未发布`) cover everything shipping.
   An empty unreleased section in either language intentionally fails the release.
3. Go to **Actions → Release → Run workflow**, enter the version without a `v` prefix
   (for example `4.3.6`).
4. Optionally run once with `dry_run: true` to exercise version/changelog preparation,
   all quality gates, and all four production extension archives without committing,
   tagging, pushing, or publishing a GitHub Release.
5. Run for real (`dry_run: false`). Afterwards verify:
   - `git fetch --tags` shows `v<version>` and `chore: release v<version>` on `master`;
   - the GitHub Release `v<version>` exists with all four ZIP archives attached and the
     extracted changelog notes from `README.md`.

## What the workflow does

1. Prints the plan (`version`, `dry_run`) for the run log.
2. Checks out `master` with full history (`fetch-depth: 0`), sets up Node 22 with npm
   cache, and installs dependencies with `npm ci`.
3. Runs `node scripts/release-prepare.mjs "$VERSION"`, which validates:
   - strict three-part numeric semver `X.Y.Z` (required by Chromium/Firefox
     `manifest.json`);
   - strictly greater than the current version;
   - no existing `v<version>` git tag;
   - all four versioned files agree (`package.json`, `package-lock.json` root and
     `packages[""]`, `src/manifest.json`, `src/manifest.v2.json`);
   - non-empty `### Unreleased` in `README.md` and `### 尚未发布` in `README_CN.md`.
   It then updates all four versioned files and folds both unreleased changelog sections
   into `### v<version>` with a fresh empty unreleased heading above each.
4. Runs all repository gates in order:
   - `npm run docs:test`
   - `npm run docs:check`
   - `npm run lint`
   - `npm test`
   - `npm run build`
5. Verifies ZIP integrity (`unzip -tq`) for all four archives and confirms that both
   `build/chromium/manifest.json` and `build/firefox/manifest.json` contain `"version": "<version>"`.
6. Extracts the `### v<version>` release notes from `README.md` via
   `node scripts/release-prepare.mjs "$VERSION" --extract-notes /tmp/release-notes.md`.
7. On `dry_run: true`, prints the archive sizes and extracted notes and exits without
   modifying Git or creating a release.
8. On a real run, commits the six updated files as `chore: release v<version>`
   (`github-actions[bot]`), creates tag `v<version>`, pushes `master` and `v<version>`,
   and publishes the GitHub Release with all four ZIP archives attached. Because the push
   uses `GITHUB_TOKEN`, it does not recursively re-trigger `tagged-release.yml`.

## Versioning policy

- `package.json`, `package-lock.json` (root and `packages[""]`), `src/manifest.json`,
  and `src/manifest.v2.json` share one version and always move together.
  `scripts/release-prepare.mjs` refuses to run if any of them disagree.
- Strict three-part numeric semver `X.Y.Z` (no `-prerelease` suffix, which browser
  extension manifests reject), always strictly greater than the current version. A
  version can only be released once.
- **Patch**: bug fixes, web-adapter compatibility updates, docs, recovery/safety
  tightening. **Minor**: user-visible capabilities, new engine/client controls,
  backward-compatible contract additions. **Major**: breaking contract or storage
  changes.

## Bilingual changelog discipline

- Accumulate user-visible changes under `### Unreleased` in [README.md](README.md) and
  `### 尚未发布` in [README_CN.md](README_CN.md) as work lands.
- The release script folds each section into `### v<version>` and inserts a fresh empty
  unreleased heading above it, leaving all older release entries untouched.

## Local rehearsal

None of these commit, tag, push, or publish:

```bash
npm run release:prepare -- 4.3.6 --check-only   # validate manifests, tag, and both changelogs
npm run docs:test && npm run docs:check && npm run lint
npm test
npm run build
```

Then dispatch **Actions → Release** with `dry_run: true` for an end-to-end CI rehearsal.

## Emergency manual tag release

If the `Release` workflow cannot push directly to a protected `master` branch, run the
preparation locally on a clean `master` checkout and let
[.github/workflows/tagged-release.yml](.github/workflows/tagged-release.yml) build and
publish from the tag:

```bash
npm run release:prepare -- X.Y.Z
npm run docs:test && npm run docs:check && npm run lint && npm test
git add package.json package-lock.json src/manifest.json src/manifest.v2.json README.md README_CN.md
git commit -m "chore: release vX.Y.Z"
git tag "vX.Y.Z"
git push origin master && git push origin "vX.Y.Z"
```
