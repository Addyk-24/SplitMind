import argparse
import json
import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
ORCHESTRATOR = ROOT / "backend" / "splitmind_orchestrator.py"

DEFAULT_STRATEGIES = "Locale Validation Layer|Guard Clause Fix|Contract-First Rewrite"
DEFAULT_DEMO_TASK = "Fix the IN locale currency bug without breaking cart total and discount tests"


def load_config(path: str | None) -> dict:
    candidates = []
    if path:
        candidates.append(Path(path))
    candidates.append(ROOT / ".splitmind.json")

    for candidate in candidates:
        if candidate.exists():
            with candidate.open("r", encoding="utf-8") as f:
                return json.load(f)
    return {}


def config_value(args, config: dict, name: str, default=None):
    value = getattr(args, name, None)
    if value is not None:
        return value
    return config.get(name.replace("_", "-"), config.get(name, default))


def run_splitmind(args) -> int:
    config = load_config(args.config)
    task = args.task or config.get("task") or DEFAULT_DEMO_TASK

    command = [
        sys.executable,
        str(ORCHESTRATOR),
        "--task",
        task,
        "--strategies",
        config_value(args, config, "strategies", DEFAULT_STRATEGIES),
    ]

    optional_flags = {
        "repo_dir": "--repo-dir",
        "target_file": "--target-file",
        "test_command": "--test-command",
        "results_dir": "--results-dir",
        "base_branch": "--base-branch",
    }

    for attr, flag in optional_flags.items():
        value = config_value(args, config, attr)
        if value:
            command.extend([flag, str(value)])

    env = os.environ.copy()
    if args.no_dashboard:
        env["SPLITMIND_TELEMETRY_URL"] = ""

    print("SplitMind CLI")
    print(f"Task: {task}")
    print(f"Orchestrator: {ORCHESTRATOR}")
    print()

    return subprocess.run(command, cwd=str(ROOT), env=env).returncode


def main() -> int:
    parser = argparse.ArgumentParser(
        prog="splitmind",
        description="Run parallel Codex strategies in isolated Git worktrees and merge the tested winner.",
    )
    subparsers = parser.add_subparsers(dest="command")

    run_parser = subparsers.add_parser("run", help="Run a SplitMind swarm")
    run_parser.add_argument("task", nargs="?", help="Coding task for the agent swarm")
    run_parser.add_argument("--config", help="Path to a SplitMind JSON config file")
    run_parser.add_argument("--strategies", help="Pipe-separated strategy names")
    run_parser.add_argument("--repo-dir", help="Repository root to branch with git worktree")
    run_parser.add_argument("--target-file", help="Relative file path agents should rewrite")
    run_parser.add_argument("--test-command", help="Command used as the deterministic evaluator")
    run_parser.add_argument("--results-dir", help="Directory where .splitmind_results.json is written")
    run_parser.add_argument("--base-branch", help="Base branch used for new worktrees")
    run_parser.add_argument("--no-dashboard", action="store_true", help="Run without posting telemetry")
    run_parser.set_defaults(func=run_splitmind)

    demo_parser = subparsers.add_parser("demo", help="Run the prepared payment-gateway demo task")
    demo_parser.set_defaults(
        func=run_splitmind,
        task=DEFAULT_DEMO_TASK,
        config=None,
        strategies=DEFAULT_STRATEGIES,
        repo_dir=None,
        target_file="src/payment_gateway.py",
        test_command=None,
        results_dir=None,
        base_branch=None,
        no_dashboard=False,
    )

    args = parser.parse_args()
    if not hasattr(args, "func"):
        parser.print_help()
        return 2
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
