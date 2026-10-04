# Versioning rules

Applies to every developer and every AI/LLM that changes this repo. Follow it exactly.

## Single source of truth

The file `VERSION` at the repo root. One line, `MAJOR.MINOR.PATCH`, nothing else
(no "v" prefix, no comments, no trailing text). The app reads it at load and
shows it in the header as `v<number>`. Do not write the version number anywhere
else (README, code, notes); refer to the file instead.

## Rule: every commit bumps the version

Every commit pushed to `main` includes a `VERSION` bump, in the same commit as the change.

## Which number to bump

| Bump | When | Examples |
|------|------|----------|
| PATCH (1.2.3 -> 1.2.4) | Bug fix, styling or layout tweak, copy change, docs, refactor with no behaviour change | Fix button alignment, fix a label |
| MINOR (1.2.3 -> 1.3.0) | New user-visible feature or capability; backward-compatible additions to stored data | New view, filter, category, setting, dashboard stat |
| MAJOR (1.2.3 -> 2.0.0) | Breaking change: stored or synced data shape that old data cannot be read with, or a full redesign | Data migration that cannot be undone |

When a bump resets lower parts to 0 (MINOR resets PATCH, MAJOR resets MINOR and PATCH).
If a commit mixes kinds of change, use the highest one. If unsure between two, pick the lower
and say so in your summary. Before any MAJOR bump or any change to the synced data shape,
stop and confirm with the owner.

## Procedure (do these in order)

1. `git pull` first, so you see the latest `VERSION`.
2. Read the file: `cat VERSION`. Never use a version remembered from earlier in the
   conversation, from notes, or from a previous read. The value may have changed.
3. Work out the next number using the table above, starting from the value you just read.
4. Write it: `echo "X.Y.Z" > VERSION`.
5. If you changed anything under `css/` or `js/`, also bump the cache-busting token
   (see below).
6. Commit `VERSION` together with the change. Push.
7. Check: `cat VERSION` shows the new number, and `git log -1` includes `VERSION` in its files.

If the push is rejected or `VERSION` changed upstream, pull, re-read `VERSION`, and
redo the bump from the upstream value. Never lower the version.

## Cache-busting token (separate from the version)

`index.html` loads `css/style.css` and the `js/*.js` files with a `?v=` query string.
It forces browsers to re-fetch changed files. It is independent of `VERSION`.

- Format: `YYYYMMDD` plus a letter, e.g. `20261004b`.
- Bump it whenever `css/` or `js/` files change. Not needed for docs or `VERSION`-only commits.
- Same day: next letter (`a` -> `b`). New day: new date and `a`.
- Every `?v=` in `index.html` must carry the same token. Replace all of them together.

## Commit messages

Plain imperative summary, optional body explaining why. The version number does not
need to be in the message.
