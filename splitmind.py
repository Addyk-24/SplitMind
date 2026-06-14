import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
ORCHESTRATOR = ROOT / "backend" / "splitmind_orchestrator.py"
DEFAULT_CONFIG_PATH = ROOT / ".splitmind.json"
EXAMPLE_CONFIG_PATH = ROOT / "splitmind.config.example.json"

DEFAULT_STRATEGIES = "Locale Validation Layer|Guard Clause Fix|Contract-First Rewrite"
DEFAULT_DEMO_TASK = "Fix the IN locale currency bug without breaking cart total and discount tests"
DEFAULT_RESULTS_FILE = ".splitmind_results.json"


def print_header(title: str) -> None:
    print(f"\nSplitMind :: {title}")
    print("-" * (13 + len(title)))


def load_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def write_json(path: Path, data: dict) -> None:
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.write("\n")


def load_config(path: str | None = None) -> dict:
    candidates = []
    if path:
        candidates.append(Path(path))
    candidates.append(DEFAULT_CONFIG_PATH)

    for candidate in candidates:
        if candidate.exists():
            try:
                return load_json(candidate)
            except json.JSONDecodeError as exc:
                raise SystemExit(f"Invalid SplitMind config: {candidate}\n{exc}") from exc
    return {}


def config_value(args, config: dict, name: str, default=None):
    value = getattr(args, name, None)
    if value is not None:
        return value
    return config.get(name.replace("_", "-"), config.get(name, default))


def repo_dir_from_config(config: dict) -> Path:
    return Path(config.get("repo_dir") or config.get("repo-dir") or ROOT).resolve()


def results_path_from_config(config: dict) -> Path:
    results_dir = Path(config.get("results_dir") or config.get("results-dir") or repo_dir_from_config(config))
    return results_dir.resolve() / DEFAULT_RESULTS_FILE


def run_shell(cmd: str, cwd: Path) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=str(cwd), shell=True, text=True, capture_output=True)


def init_splitmind(args) -> int:
    config_path = Path(args.config or DEFAULT_CONFIG_PATH)
    if config_path.exists() and not args.force:
        print(f"Config already exists: {config_path}")
        print("Use --force to overwrite it.")
        return 1

    if EXAMPLE_CONFIG_PATH.exists():
        config = load_json(EXAMPLE_CONFIG_PATH)
    else:
        config = {
            "repo_dir": str(ROOT),
            "target_file": "src/payment_gateway.py",
            "test_command": f'"{sys.executable}" -m pytest tests/ -v --tb=short --no-header',
            "results_dir": str(ROOT),
            "base_branch": "main",
            "strategies": DEFAULT_STRATEGIES,
        }

    if args.repo_dir:
        config["repo_dir"] = str(Path(args.repo_dir).resolve())
    if args.target_file:
        config["target_file"] = args.target_file
    if args.test_command:
        config["test_command"] = args.test_command

    write_json(config_path, config)
    print_header("initialized")
    print(f"Config: {config_path}")
    print(f"Repo:   {config.get('repo_dir')}")
    print(f"Tests:  {config.get('test_command')}")
    return 0


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

    print_header("run")
    print(f"Task: {task}")
    print(f"Repo: {config_value(args, config, 'repo_dir', ROOT)}")
    print(f"Tests: {config_value(args, config, 'test_command', 'default pytest command')}")
    print()

    return subprocess.run(command, cwd=str(ROOT), env=env).returncode


def status_splitmind(args) -> int:
    config = load_config(args.config)
    results_path = results_path_from_config(config)

    print_header("status")
    print(f"Config:  {Path(args.config or DEFAULT_CONFIG_PATH)}")
    print(f"Repo:    {repo_dir_from_config(config)}")
    print(f"Results: {results_path}")

    if not results_path.exists():
        print("\nNo results file found yet. Run `python splitmind.py run \"task\"` first.")
        return 0

    results = load_json(results_path)
    if not results:
        print("\nResults file exists but has no agent output.")
        return 0

    print("\nLatest agent results:")
    for agent_id, result in results.items():
        exit_code = result.get("exit_code", "?")
        timing = result.get("timing", "?")
        strategy = result.get("strategy", "Unknown strategy")
        verdict = "PASS" if exit_code == 0 else "FAIL"
        print(f"  {agent_id:<12} {verdict:<4} exit={exit_code} time={timing}s  {strategy}")
    return 0


def results_splitmind(args) -> int:
    config = load_config(args.config)
    results_path = Path(args.results_file).resolve() if args.results_file else results_path_from_config(config)

    if not results_path.exists():
        print(f"No results file found: {results_path}")
        return 1

    results = load_json(results_path)
    if args.agent:
        result = results.get(args.agent)
        if not result:
            print(f"Agent not found: {args.agent}")
            print(f"Available: {', '.join(results.keys()) or 'none'}")
            return 1
        print_header(f"results {args.agent}")
        print(f"Strategy: {result.get('strategy')}")
        print(f"Exit:     {result.get('exit_code')}")
        print(f"Timing:   {result.get('timing')}s")
        print(f"File:     {result.get('target_file')}")
        print("\nTest output:")
        print(result.get("test_output", "").strip() or "(empty)")
        return 0

    print(json.dumps(results, indent=2))
    return 0


def clean_splitmind(args) -> int:
    config = load_config(args.config)
    repo_dir = repo_dir_from_config(config)
    run_dir = repo_dir / ".splitmind_run"

    print_header("clean")
    if run_dir.exists():
        shutil.rmtree(run_dir)
        print(f"Removed {run_dir}")
    else:
        print(f"No run directory found at {run_dir}")

    git_check = run_shell("git rev-parse --is-inside-work-tree", repo_dir)
    if git_check.returncode != 0:
        return 0

    worktrees = run_shell("git worktree list --porcelain", repo_dir)
    for line in worktrees.stdout.splitlines():
        if line.startswith("worktree ") and ".splitmind_run" in line:
            path = line.removeprefix("worktree ").strip()
            run_shell(f'git worktree remove -f "{path}"', repo_dir)
            print(f"Pruned worktree {path}")

    return 0


def doctor_splitmind(args) -> int:
    config = load_config(args.config)
    repo_dir = repo_dir_from_config(config)
    test_command = config_value(args, config, "test_command")

    print_header("doctor")
    checks = []
    checks.append(("Python", sys.executable, Path(sys.executable).exists()))
    checks.append(("Orchestrator", str(ORCHESTRATOR), ORCHESTRATOR.exists()))
    checks.append(("Config", str(Path(args.config or DEFAULT_CONFIG_PATH)), Path(args.config or DEFAULT_CONFIG_PATH).exists()))
    checks.append(("Repo", str(repo_dir), repo_dir.exists()))

    git_ok = run_shell("git --version", ROOT).returncode == 0
    repo_ok = repo_dir.exists() and run_shell("git rev-parse --is-inside-work-tree", repo_dir).returncode == 0
    checks.append(("Git executable", "git --version", git_ok))
    checks.append(("Repo is Git worktree", str(repo_dir), repo_ok))

    if test_command:
        test_probe = run_shell(test_command, repo_dir)
        checks.append(("Test command", test_command, test_probe.returncode == 0))
    else:
        checks.append(("Test command", "not configured", False))

    failures = 0
    for name, detail, ok in checks:
        mark = "OK" if ok else "FAIL"
        print(f"[{mark:<4}] {name:<20} {detail}")
        if not ok:
            failures += 1

    if failures:
        print(f"\n{failures} check(s) need attention.")
        return 1
    print("\nReady to run SplitMind.")
    return 0


def add_run_flags(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("task", nargs="?", help="Coding task for the agent swarm")
    parser.add_argument("--config", help="Path to a SplitMind JSON config file")
    parser.add_argument("--strategies", help="Pipe-separated strategy names")
    parser.add_argument("--repo-dir", help="Repository root to branch with git worktree")
    parser.add_argument("--target-file", help="Relative file path agents should rewrite")
    parser.add_argument("--test-command", help="Command used as the deterministic evaluator")
    parser.add_argument("--results-dir", help="Directory where .splitmind_results.json is written")
    parser.add_argument("--base-branch", help="Base branch used for new worktrees")
    parser.add_argument("--no-dashboard", action="store_true", help="Run without posting telemetry")


def main() -> int:
    parser = argparse.ArgumentParser(
        prog="splitmind",
        description="Run parallel Codex strategies in isolated Git worktrees and merge the tested winner.",
    )
    subparsers = parser.add_subparsers(dest="command")

    init_parser = subparsers.add_parser("init", help="Create or refresh .splitmind.json")
    init_parser.add_argument("--config", help="Config path to write")
    init_parser.add_argument("--repo-dir", help="Repository root to branch with git worktree")
    init_parser.add_argument("--target-file", help="Relative target file for the demo/default run")
    init_parser.add_argument("--test-command", help="Deterministic evaluator command")
    init_parser.add_argument("--force", action="store_true", help="Overwrite an existing config")
    init_parser.set_defaults(func=init_splitmind)

    run_parser = subparsers.add_parser("run", help="Run a SplitMind swarm")
    add_run_flags(run_parser)
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

    status_parser = subparsers.add_parser("status", help="Show latest SplitMind run summary")
    status_parser.add_argument("--config", help="Path to a SplitMind JSON config file")
    status_parser.set_defaults(func=status_splitmind)

    results_parser = subparsers.add_parser("results", help="Print latest result JSON or one agent's test output")
    results_parser.add_argument("agent", nargs="?", help="Optional agent id, e.g. sm-tdd")
    results_parser.add_argument("--config", help="Path to a SplitMind JSON config file")
    results_parser.add_argument("--results-file", help="Path to .splitmind_results.json")
    results_parser.set_defaults(func=results_splitmind)

    clean_parser = subparsers.add_parser("clean", help="Remove stale SplitMind worktrees")
    clean_parser.add_argument("--config", help="Path to a SplitMind JSON config file")
    clean_parser.set_defaults(func=clean_splitmind)

    doctor_parser = subparsers.add_parser("doctor", help="Check local SplitMind prerequisites")
    doctor_parser.add_argument("--config", help="Path to a SplitMind JSON config file")
    doctor_parser.add_argument("--test-command", help="Override configured test command for this check")
    doctor_parser.set_defaults(func=doctor_splitmind)

    args = parser.parse_args()
    if not hasattr(args, "func"):
        parser.print_help()
        return 2
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
