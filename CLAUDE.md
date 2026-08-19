# Claude Code Instructions

@AGENTS.md

`AGENTS.md` is the canonical policy for this repository. Read and follow it before making changes. Do not duplicate or override its rules here; propose updates in `AGENTS.md` so every coding agent receives the same guidance.

## Before you commit

This repository is public, and the history is part of what it shows. Read
**Git Hygiene** in `AGENTS.md` and follow it exactly. It defines the allowed
subject prefixes, the 72-character subject limit, and the rule that a subject
must describe what its commit actually contains.

Two habits matter most, because both have gone wrong here before:

- Stage files by explicit path. Never run `git add -A` or `git add .`. An
  untracked private file has sat in this repository's root, and a stage-all
  would publish it.
- Confirm what you staged before you write the message. `git add` fails as a
  whole if any path in it does not match, which has produced a commit holding
  one file under a message describing ten.

The rules themselves live in `AGENTS.md`. This section only points at them.
