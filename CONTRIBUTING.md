# Pull requests

`AGENTS.md` holds the repository policy, including the branch names and the commit prefixes. This file holds the steps for a pull request.

## Before you open a pull request

1. Rebase or merge the current `main` into the branch and resolve conflicts locally.
2. Review the complete diff for unrelated files, generated noise, secrets, and temporary tooling artifacts.
3. Run `npm run verify`.
4. Run `npm audit` when dependency files changed.
5. Browser-test affected routes and interactions. Include desktop and mobile evidence for visual changes.

## Title

Pull request titles must use the same complete-word prefixes as commits. Keep each pull request focused on one outcome.

## Description

Every pull request description must include:

- **Summary:** what changed and why;
- **Changes:** the important implementation details;
- **Verification:** exact commands and browser scenarios run;
- **Visual evidence:** before/after screenshots or video for interface changes, or `Not applicable`;
- **Risk and rollback:** likely failure modes and how to revert safely;
- **Related work:** linked issue, discussion, or prior pull request when applicable.

## Review and merge

Use a draft pull request while behavior or verification is incomplete. Mark it ready only when the description is complete, checks pass, temporary debugging code is removed, and the branch is reviewable commit by commit.

Resolve every review thread explicitly. Prefer a squash merge when branch history is exploratory; preserve multiple commits only when they form an intentional, independently understandable sequence.
