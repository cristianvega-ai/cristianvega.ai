---
name: deploy
description: Build, upload, and verify the site on DreamHost shared hosting. Use when the user asks to deploy, publish, ship, or push the site live, or to re-verify what is currently live.
---

# Deploy the site

The site is static. A deploy is one rsync of `dist/` to the document root on the
web host, followed by a check against the live origin.

## Load the target first

The host, account, document root, and key path are **not** in this repository.
The repository is public, so those values live in an untracked file:

```bash
cat .claude/deploy-target.local
```

It defines `HOST`, `USER`, `PORT`, `DOC_ROOT`, `SSH_KEY`, and `ORIGIN`. Load
them into the shell before you run anything else:

```bash
set -a; . .claude/deploy-target.local; set +a
```

If that file is missing, stop and ask the owner for the values. Do not guess a
hostname, and do not commit the file after you write it.

## Authentication

Authentication is by SSH key. Never ask for the account password, and never put
a password in a command.

```bash
ssh -o BatchMode=yes -i "$SSH_KEY" -p "$PORT" "$USER@$HOST" 'echo KEY_AUTH_OK'
```

If the key is rejected, stop and say so. Do not retry more than twice: the host
blocks an address after repeated failures, which costs more time than asking.

## Steps

### 1. Confirm the tree is ready

Deploy from `main` unless the owner names another branch. The working tree must
be clean, because `dist/` is built from what is on disk, not from what is
committed.

```bash
git status --short && git branch --show-current
```

### 2. Run the gate, then build

```bash
npm run verify && npm run build
```

`verify` must exit 0. It builds, type-checks, and runs both test runners. Never
deploy past a failure. If the browser layer cannot start, run
`npx playwright install chromium` once, then run `verify` again.

Confirm the Apache config survived the build. It carries the production
security headers, and a deploy without it drops every one of them silently:

```bash
ls -l dist/.htaccess
```

### 3. Dry run

```bash
rsync -avzn --delete --exclude '.dh-diag' \
  -e "ssh -i $SSH_KEY -p $PORT" dist/ "$USER@$HOST:$DOC_ROOT"
```

Read the list before you go further. `--delete` removes anything in the
document root that is not in `dist/`, so an unexpected deletion means the
destination path is wrong. Stop and check rather than guess.

`.dh-diag` is a diagnostic symlink owned by root on the host. The exclude keeps
`--delete` away from it. Keep that flag on every run.

### 4. Deploy

The same command without `-n`:

```bash
rsync -avz --delete --exclude '.dh-diag' \
  -e "ssh -i $SSH_KEY -p $PORT" dist/ "$USER@$HOST:$DOC_ROOT"
```

### 5. Verify the live origin

```bash
npm run verify:deploy
```

This checks the six security headers and a real 404 against the live origin. It
must exit 0.

Then check the live pages, not the local build:

```bash
for p in / /about/ /contact/; do
  printf "%-12s %s\n" "$p" "$(curl -s -o /dev/null -w '%{http_code}' "$ORIGIN$p")"
done
curl -s "$ORIGIN/sitemap-0.xml" | grep -o 'https://[^<]*'
```

When the change was visible copy, `curl` the affected page and confirm the new
words are in the response. A deploy that returns 200 proves nothing about what
the page says. Match the visible element, not the meta description: both carry
similar words, and a grep for the phrase alone will match the wrong one.

## Withheld pages

`/projects/`, `/writing/`, and `/posts/*` build and upload, but they are held
back on purpose: no navigation link, a `noindex` robots tag, and no sitemap
entry. That is the intended state. Do not treat their absence from the sitemap
as a defect, and do not link to them unless the owner asks.

The `withheld routes build but stay out of reach of crawlers and navigation`
test in `tests/build.test.mjs` guards this. If it fails, the hiding broke.

## Report

Say which commit went out, that `verify` and `verify:deploy` both passed, and
what you confirmed on the live origin. If you skipped a step, say which one.
