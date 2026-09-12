---
name: deploy
description: Ship a change to cristianvega.ai through GitHub Actions, check what is live, or run a manual deploy through the receiver when GitHub Actions cannot run. Use when the user asks to deploy, publish, ship, or push the site live, or to re-verify what is currently live.
---

# Deploy the site

Production deploys run from GitHub Actions on every merge to `main`. The
normal way to ship is a pull request. Nothing deploys with `rsync` any more:
the document root is written only by the receiver on the host, and the only
keys that can reach it are locked to that one program.

## Normal path: a pull request

1. Work on a branch. Keep the tree clean and run `npm run verify`.
2. Open the pull request with `gh pr create`. The `Verify` check runs.
3. Merge when it is green: `gh pr merge --squash --delete-branch`. For a small
   copy change that may go out unattended, `gh pr merge --auto --squash`
   merges it the moment `Verify` passes. The `main` ruleset refuses a direct
   push, so do not try one.
4. Watch the deploy: `gh run watch` or the Actions tab. The `Deploy
   production` job prints the package hash and the receiver hash.
5. Check the live origin yourself, not the local build:

```bash
npm run verify:deploy
for p in / /about/ /contact/; do
  printf "%-12s %s\n" "$p" "$(curl -s -o /dev/null -w '%{http_code}' "https://cristianvega.ai$p")"
done
```

When the change was visible copy, `curl` the affected page and confirm the new
words are in the response. Match the visible element, not the meta
description: both carry similar words.

If `Deploy production` was skipped, the kill switch is off: the repository
variable `PRODUCTION_DEPLOY_ENABLED` is not `true`. Say so; do not work around
it.

## Manual path: the receiver from a laptop

Only when GitHub Actions cannot run. The host, account, and key paths are not
in this repository, because it is public. They live in an untracked file:

```bash
set -a; . .claude/deploy-target.local; set +a
```

It defines `HOST`, `USER`, `PORT`, `DOC_ROOT`, `SSH_KEY` (your own key, for
admin work), `DEPLOY_KEY` (a restricted key that can only run the receiver),
and `ORIGIN`. If the file is missing, stop and ask the owner. Never ask for a
password, and never put one in a command.

1. Confirm a clean tree on `main`: `git status --short && git branch --show-current`.
   `dist/` is built from the disk, so a dirty tree would publish words no
   commit records.
2. Run the gate: `npm run verify`. It must exit 0.
3. Send the package. The receiver answers with one line:

```bash
tar --create --gzip --format=ustar --directory dist . |
  ssh -o BatchMode=yes -o IdentitiesOnly=yes -i "$DEPLOY_KEY" -p "$PORT" "$USER@$HOST" deploy
# expect: DEPLOY_OK <package sha256> <receiver sha256>
```

4. Run the live checks from the normal path above.

If the receiver rejects the package it says why on stderr and changes
nothing. If its live check fails it restores the previous site and says so.
Do not retry more than twice: the host blocks an address after repeated
connections, which costs more time than asking.

## What the receiver refuses

Anything that is not a plain static file: hidden names other than the root
`.htaccess`, links, files without an allowed suffix, names with an
interpreter suffix anywhere in them, and a `.htaccess` that does not match a
copy in `approved.d/` on the host. `scripts/deploy-receiver.py` holds the
rules and `scripts/test_deploy_receiver.py` proves them. README.md explains
how to change `.htaccess` and how to update the receiver.

## Report

Say which commit went out, which workflow run deployed it (or that you used
the manual path, and why), that `verify:deploy` passed, and what you confirmed
on the live origin. If you skipped a step, say which one.
