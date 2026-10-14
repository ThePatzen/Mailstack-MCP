---
name: release
description: Use when the user explicitly requests a Mailstack MCP release, patch version bump, Docker Hub publication, or release notes tied to a version.
---

# Mailstack MCP Release

Use this workflow only for an explicit release request. A request to draft or review release notes does not authorize versioning or pushing.

## Preconditions

1. Confirm the repository is on `main`, tracks `origin/main`, and has a clean working tree. Fetch `origin/main` and tags; stop if local `main` is behind or has diverged from `origin/main`.
2. Read `package.json` and `package-lock.json`; confirm their versions match. Determine the next patch version and confirm its `vX.Y.Z` tag does not already exist. Stop on mismatches, an existing tag, or a version format you cannot safely increment.
3. Find the latest release tag. Review commit subjects and diffs from that tag through `HEAD`; if no release tag exists, review the repository history and identify the initial release scope. Do not infer user-visible changes from commit subjects alone.

## Prepare the changelog

Create or update `CHANGELOG.md` with a concise entry for the next patch version and current date. Use `Added`, `Changed`, and `Fixed` sections as applicable. Include only user-visible changes supported by the reviewed diffs; omit empty sections, internal-only edits, and speculative claims. Keep prior entries intact.

Show the proposed entry to the user. If it misstates a change or the release scope is unclear, revise it before continuing.

Commit only `CHANGELOG.md` in a separate commit, for example:

```sh
git add CHANGELOG.md
git commit -m "docs: add changelog for vX.Y.Z"
```

Then run:

```sh
npm version patch
```

This should update the package version and lockfile, create a version commit, and create the matching `vX.Y.Z` tag. Read the version printed by npm and verify the files and tag match it. If npm did not create the tag, create it with `git tag vX.Y.Z`. Never replace, delete, or move an existing tag.

Verify all three version fields after `npm version patch`: `package.json.version`, `package-lock.json.version`, and `package-lock.json.packages[""].version`. If npm leaves either lockfile field unchanged, update both to the new version before pushing, include the correction in the version commit, and make sure the release tag points to the corrected commit. A tag created during this release may be recreated locally only after confirming that the same tag does not exist on the remote. Never replace, delete, or move a tag that already exists on the remote.

## Verify and push

Before pushing, inspect the changelog commit, version commit, and tag target. Confirm the working tree is clean and the tag points to the version commit on `main`.

Push the branch and follow-tags first, then explicitly push the release tag as requested:

```sh
git push origin main --follow-tags
git push origin vX.Y.Z
```

Replace `vX.Y.Z` with the exact tag created by `npm version`. Verify that `origin/main` and the remote tag point to the intended release commit. If either push fails or only one succeeds, report the partial state and stop; inspect remote refs before any retry. Do not claim publication succeeded unless the remote tag and branch were verified.

The pushed tag triggers `.github/workflows/publish-dockerhub.yml`. Report the image tags as pending until the GitHub Actions run confirms publication.
