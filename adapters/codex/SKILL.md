---
name: splitmind
description: Use when Codex should route a complex coding task through SplitMind: parallel Git worktrees, multiple implementation strategies, deterministic tests, winner selection, merge, and result inspection.
---

# SplitMind Codex Adapter

Use SplitMind for complex implementation work where one-shot editing is risky and tests can decide the safest branch.

Run:

```bash
python splitmind.py run "<user task>"
```

Inspect:

```bash
python splitmind.py status
python splitmind.py results
python splitmind.py results sm-tdd
```

Check prerequisites:

```bash
python splitmind.py doctor
```

Never manually merge SplitMind worktrees. Let the CLI select and merge the winner.
