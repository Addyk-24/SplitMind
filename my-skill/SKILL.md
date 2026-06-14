---
name: splitmind
description: Use when Codex needs to solve a non-trivial coding task by running multiple implementation strategies in isolated Git worktrees, executing deterministic tests, selecting the safest passing branch, and merging the winner through the SplitMind CLI. Trigger for complex bug fixes, risky refactors, multi-file features, and tasks where tests should decide the outcome.
---

# SplitMind

SplitMind is a CLI-first orchestration layer for safer agentic coding. It runs several implementation strategies in parallel Git worktrees, evaluates each branch with a deterministic test command, selects the safest passing branch, merges the winner, and prunes the losing worktrees.

## Use SplitMind For

- Complex bug fixes where multiple solutions are plausible.
- Risky refactors that must preserve behavior.
- Feature work with a clear test command.
- Tasks where the user asks for autonomous agent execution, worktrees, parallel agents, validation, or merge selection.

## Do Not Use SplitMind For

- Simple explanations or code reading.
- README/docs edits with no code risk.
- Tiny one-line edits where direct implementation is obviously safer.
- Repositories without Git, a target repo path, or a meaningful test command.

## Workflow

1. Confirm the repository and test command are configured.
2. If no config exists, run:

```bash
python splitmind.py init
```

3. For a normal swarm run, execute:

```bash
python splitmind.py run "<user task>"
```

4. For a known demo scenario, execute:

```bash
python splitmind.py demo
```

5. To inspect the latest run, use:

```bash
python splitmind.py status
python splitmind.py results
python splitmind.py results sm-tdd
```

6. To check the machine before running:

```bash
python splitmind.py doctor
```

7. To remove stale SplitMind worktrees:

```bash
python splitmind.py clean
```

## Strategy Guidance

When the user does not specify strategies, use the default tournament:

```text
Locale Validation Layer|Guard Clause Fix|Contract-First Rewrite
```

For other projects, choose three meaningfully different approaches:

- Minimal Patch: smallest safe change.
- Refactor: clearer structure with preserved behavior.
- Test-First or Contract-First: implementation guided by tests/specs.

Pass custom strategies like this:

```bash
python splitmind.py run "<user task>" --strategies "Minimal Patch|Refactor|Contract-First Rewrite"
```

## Reporting Rules

After the CLI finishes, report:

- winning branch, if any
- which branches passed, failed, or were pruned by tiebreaker
- test command and exit code
- whether the winner was merged into main
- where `.splitmind_results.json` was written

Do not invent a successful merge. If all agents fail, say that main was left untouched.

Do not manually merge SplitMind branches outside the CLI. The merge policy belongs to the orchestrator.
