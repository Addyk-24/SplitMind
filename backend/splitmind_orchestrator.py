"""
SplitMind Orchestrator — REAL VERSION (Hackathon Day)
Replaces simulate_agent_execution with real OpenAI API calls + real pytest evals.
Changes from demo version:
  - run_real_agent() calls openai API with distinct strategy prompts
  - subprocess runs actual pytest and reads exit code
  - agent_results dict stores code diff + test output for dashboard modal
  - timing per agent tracked and broadcast
  - strategy names updated to be story-ready
  - /api/state payload includes timing + test_output for terminal display
"""

import os
import sys
import subprocess
import shutil
import concurrent.futures
import time
import stat
import argparse
import json
import shlex

try:
    import requests
except ModuleNotFoundError:
    requests = None

try:
    from dotenv import load_dotenv
except ModuleNotFoundError:
    def load_dotenv():
        return False

try:
    from openai import OpenAI
except ModuleNotFoundError:
    OpenAI = None

load_dotenv()

# CONFIGURATION
MAIN_REPO_DIR   = os.environ.get("DEMO_REPO_DIR", os.getcwd())
WORKTREE_BASE   = os.path.join(MAIN_REPO_DIR, ".splitmind_run")
TARGET_FILE_REL = os.environ.get("SPLITMIND_TARGET_FILE", os.path.join("src", "payment_gateway.py"))
RESULTS_DIR     = os.environ.get("SPLITMIND_RESULT_DIR", MAIN_REPO_DIR)
TELEMETRY_URL   = os.environ.get("SPLITMIND_TELEMETRY_URL", "http://localhost:3000/api/state")
BASE_BRANCH     = os.environ.get("SPLITMIND_BASE_BRANCH", "main")


def quote_executable(path: str) -> str:
    return f'"{path}"' if os.name == "nt" else shlex.quote(path)


TEST_COMMAND    = os.environ.get(
    "SPLITMIND_TEST_COMMAND",
    f"{quote_executable(sys.executable)} -m pytest tests/ -v --tb=short --no-header",
)

MODEL_PATH = os.environ.get("MODEL_NAME")


def get_client():
    if OpenAI is None:
        raise RuntimeError("The openai package is not installed. Install it before running agents.")
    return OpenAI(
        base_url=os.environ.get("OPENAI_BASE_URL", "https://api.groq.com/openai/v1"),
        api_key=os.environ.get("GROQ_API_KEY") or os.environ.get("OPENAI_API_KEY"),
    )


# GLOBAL TELEMETRY STATE

# Strategy names updated — now tell a story when Guard Clause Fix wins
DEFAULT_STRATEGIES = [
    ("sm-refactor", "Locale Validation Layer"),
    ("sm-patch", "Guard Clause Fix"),
    ("sm-tdd", "Contract-First Rewrite"),
]


def build_agents(strategy_specs: list[tuple[str, str]]) -> list[dict]:
    return [
        {"id": agent_id, "strategy": strategy, "status": "idle", "timing": None, "exitCode": None}
        for agent_id, strategy in strategy_specs
    ]


AGENTS = build_agents(DEFAULT_STRATEGIES)

# Stores generated code + test output per agent — served to /api/results for diff modal
agent_results: dict = {}

workflow_state = {
    "stage": "idle",
    "agents": AGENTS,
    "task": "",
    "winnerID": None,
}


def broadcast_state():
    if requests is None:
        return
    try:
        requests.post(TELEMETRY_URL, json=workflow_state, timeout=1)
    except requests.exceptions.RequestException:
        pass


def update_agent(agent_id: str, **kwargs):
    """Update one agent's fields and broadcast immediately."""
    for agent in workflow_state["agents"]:
        if agent["id"] == agent_id:
            agent.update(kwargs)
    broadcast_state()



# FILE SYSTEM UTILS

def onerror(func, path, exc_info):
    if not os.access(path, os.W_OK):
        os.chmod(path, stat.S_IWUSR)
        func(path)
    else:
        raise


def safe_rmtree(path):
    if os.path.exists(path):
        shutil.rmtree(path, onerror=onerror)


def run_cmd(cmd, cwd=None):
    return subprocess.run(cmd, cwd=cwd, shell=True, text=True, capture_output=True)


def parse_strategies(raw: str | None) -> list[tuple[str, str]]:
    if not raw:
        return DEFAULT_STRATEGIES

    names = [part.strip() for part in raw.split("|") if part.strip()]
    if not names:
        return DEFAULT_STRATEGIES

    default_names = [strategy for _, strategy in DEFAULT_STRATEGIES]
    if names == default_names:
        return DEFAULT_STRATEGIES

    return [(f"sm-{index + 1}", name) for index, name in enumerate(names)]


def configure_swarm(strategy_specs: list[tuple[str, str]]):
    global AGENTS
    AGENTS = build_agents(strategy_specs)
    workflow_state["agents"] = AGENTS
    workflow_state["winnerID"] = None


# GIT WORKTREEE SETUP

def create_worktree(branch_name: str) -> str:
    worktree_path = os.path.abspath(os.path.join(WORKTREE_BASE, branch_name))

    os.makedirs(WORKTREE_BASE, exist_ok=True)
    run_cmd(f'git worktree add -b "{branch_name}" "{worktree_path}" {BASE_BRANCH}', cwd=MAIN_REPO_DIR)

    # Wait for git to populate the directory (Windows fix)
    target_file = os.path.join(worktree_path, TARGET_FILE_REL)
    deadline = time.time() + 8
    while not os.path.exists(target_file) and time.time() < deadline:
        time.sleep(0.4)

    return worktree_path


# System prompt for ai agent systems
STRATEGY_PROMPTS = {
    "sm-refactor": (
        "You are an aggressive refactoring agent. Your job is to restructure the entire "
        "module with a proper validation layer: extract locale/currency rules into a "
        "separate mapping dict, add explicit error messages, and make the function "
        "extensible for future locales. Do NOT just patch the existing line."
    ),
    "sm-patch": (
        "You are a minimal patch agent. Your job is to make the smallest possible change "
        "that fixes the bug and passes all tests. One or two lines maximum. "
        "Do not restructure or rename anything."
    ),
    "sm-tdd": (
        "You are a contract-first rewriting agent. Treat the test file as the specification. "
        "Rewrite the function from scratch so its behaviour exactly matches every test case. "
        "Add a docstring describing the contract."
    ),
}


def get_strategy_directive(branch_name: str) -> str:
    preset = STRATEGY_PROMPTS.get(branch_name)
    if preset:
        return preset

    strategy_name = next(
        (agent["strategy"] for agent in AGENTS if agent["id"] == branch_name),
        "Alternative implementation",
    )
    return (
        f"You are the SplitMind agent responsible for the '{strategy_name}' strategy. "
        "Implement the requested coding task according to that strategy while preserving "
        "the public contract proven by the tests. Return the complete fixed file only."
    )


def run_real_agent(branch_name: str, worktree_path: str, task_prompt: str) -> str | None:
    """
    Calls the OpenAI API with a strategy-specific prompt,
    writes the generated fix to the worktree, runs real pytest,
    and returns branch_name on success or None on failure.
    """
    t_start = time.time()
    update_agent(branch_name, status="running")

    target_file = os.path.join(worktree_path, TARGET_FILE_REL)

    with open(target_file, "r") as f:
        broken_code = f.read()

    # Read the test file so the model knows the contract it must satisfy
    test_file = os.path.join(worktree_path, "tests", "test_payments.py")
    test_code = ""
    if os.path.exists(test_file):
        with open(test_file, "r") as f:
            test_code = f.read()

    strategy_directive = get_strategy_directive(branch_name)

    print(f"    [AGENT: {branch_name}] Calling OpenAI API...")

    try:
        client = get_client()
        response = client.chat.completions.create(
            model=MODEL_PATH, # MODEL NAME
            temperature=0.2,
            messages=[
                {
                    "role": "system",
                    "content": (
                        f"{strategy_directive}\n\n"
                        "Return ONLY the complete fixed Python file. "
                        "No markdown, no backticks, no explanation."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Task: {task_prompt}\n\n"
                        f"Broken code ({TARGET_FILE_REL}):\n{broken_code}\n\n"
                        f"Tests that must pass (tests/test_payments.py):\n{test_code}"
                    ),
                },
            ],

        )
        fixed_code = response.choices[0].message.content.strip()

        if fixed_code.startswith("```"):
            lines = fixed_code.splitlines()
            fixed_code = "\n".join(lines[1:-1] if lines[-1] == "```" else lines[1:])

    except Exception as e:
        print(f"    [ERROR: {branch_name}] OpenAI call failed: {e}")
        update_agent(branch_name, status="failed", exitCode=1,
                     timing=round(time.time() - t_start, 1))
        return None

    with open(target_file, "w",encoding="utf-8") as f:
        f.write(fixed_code)

    # DETERMINISTIC EVAL
    update_agent(branch_name, status="testing")
    print(f"    [EVAL:  {branch_name}] Running pytest...")

    result = subprocess.run(
        TEST_COMMAND,
        cwd=worktree_path,
        capture_output=True,
        text=True,
        shell=True,
    )

    exit_code    = result.returncode
    test_output  = (result.stdout + result.stderr).strip()
    elapsed      = round(time.time() - t_start, 1)

    agent_results[branch_name] = {
        "strategy":    next(a["strategy"] for a in AGENTS if a["id"] == branch_name),
        "broken_code": broken_code,
        "fixed_code":  fixed_code,
        "test_output": test_output,
        "exit_code":   exit_code,
        "timing":      elapsed,
        "branch":      branch_name,
        "target_file": TARGET_FILE_REL,
        "test_command": TEST_COMMAND,
    }

    run_cmd("git add .", cwd=worktree_path)
    run_cmd(
        f'git commit -m "Agent {branch_name}: exit_code={exit_code} ({elapsed}s)"',
        cwd=worktree_path,
    )

    if exit_code == 0:
        print(f"    [EVAL:  {branch_name}] PASSED  (Exit 0, {elapsed}s)")
        update_agent(branch_name, status="success", exitCode=0, timing=elapsed)
        return branch_name
    else:
        print(f"    [EVAL:  {branch_name}] FAILED  (Exit 1, {elapsed}s)")
        # FIX for demo bug: status is "failed", not still "testing"
        update_agent(branch_name, status="failed", exitCode=1, timing=elapsed)
        return None


def orchestrate_swarm(task_prompt: str, strategy_specs: list[tuple[str, str]] | None = None):
    if strategy_specs:
        configure_swarm(strategy_specs)

    workflow_state["task"] = task_prompt
    workflow_state["winnerID"] = None
    print(f"\n>>> INTERCEPTED TASK: {task_prompt}")

    # 1. BRANCHING
    workflow_state["stage"] = "branching"
    broadcast_state()

    strategy_ids = [a["id"] for a in workflow_state["agents"]]
    paths = {sid: create_worktree(sid) for sid in strategy_ids}
    print(f"Spun up {len(strategy_ids)} parallel worktrees.")

    # 2. EXECUTE — all three agents run simultaneously
    workflow_state["stage"] = "executing"
    broadcast_state()

    winner = None
    winners = []
            
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        futures = {
            executor.submit(run_real_agent, sid, path, task_prompt): sid
            for sid, path in paths.items()
        }
        for future in concurrent.futures.as_completed(futures):
            result = future.result()
            if result:
                winners.append(result)

    if winners:
        def diff_size(branch_id):
            r = agent_results.get(branch_id,{})
            before = r.get("broken_code","")
            after = r.get("fixed_code","")

            b_lines = set(before.splitlines())
            a_lines = set(after.splitlines())

            return len(b_lines.symmetric_difference(a_lines))
        
        winner = min(winners,key=diff_size)
        print(f"\n [WINNER AGENT] Tiebreak: {winner} wins by minimal diff ({diff_size(winner)} changed lines)")
        if len(winners) > 1:
            others = [w for w in winners if w != winner]
            print(f"    Also passed (pruned by tiebreak): {others}")
            for loser in others:
                update_agent(loser, status="failed")

    else:
        winner = None

    results_path = os.path.join(RESULTS_DIR, ".splitmind_results.json")
    with open(results_path, "w", encoding="utf-8") as f:
        json.dump(agent_results, f, indent=2)
    print(f" [Results] -> {results_path}")

    # 3. RESULTS pause — let dashboard show the per-agent verdicts
    workflow_state["stage"] = "results"
    workflow_state["winnerID"] = winner
    broadcast_state()
    time.sleep(2)

    # 4. MERGE
    if winner:
        workflow_state["stage"] = "merging"
        workflow_state["winnerID"] = winner
        broadcast_state()

        stash_out = run_cmd("git stash", cwd=MAIN_REPO_DIR).stdout
        had_stash  = "No local changes" not in stash_out

        merge_result = run_cmd(f"git merge {winner}", cwd=MAIN_REPO_DIR)
        if merge_result.returncode == 0:
            print(f"\n [Merged]  -> {winner}. System stable.")
        else:
            print(f"\n [CONFLICT] -> Merge conflict on {winner}: {merge_result.stderr}")
            run_cmd("git merge --abort", cwd=MAIN_REPO_DIR)
            print(" [Merge aborted] Main branch left untouched.")
        if had_stash:
            run_cmd("git stash pop", cwd=MAIN_REPO_DIR)
    else:
        print("\n   All agents failed. Main branch untouched.")

    # 5. PRUNE
    for sid in strategy_ids:
        worktree_path = os.path.join(WORKTREE_BASE, sid)
        run_cmd(f'git worktree remove -f "{worktree_path}"', cwd=MAIN_REPO_DIR)
        run_cmd(f"git branch -D {sid}", cwd=MAIN_REPO_DIR)

    os.chdir(MAIN_REPO_DIR)
    safe_rmtree(WORKTREE_BASE)
    # time.sleep(60)


    # Write final agent_results to disk so /api/results can serve them
    results_path = os.path.join(RESULTS_DIR, ".splitmind_results.json")
    with open(results_path, "w", encoding="utf-8") as f:
        json.dump(agent_results, f, indent=2)
    print(f"Results written to {results_path}")

    time.sleep(60)   # keep dashboard on the final result so judges can read it

    workflow_state["stage"] = "idle"
    workflow_state["winnerID"] = None
    for agent in workflow_state["agents"]:
        agent.update({"status": "idle", "timing": None, "exitCode": None})
    broadcast_state()
    print(" [DONE] Sandbox clean. Ready for next task.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="SplitMind Swarm Orchestrator")
    parser.add_argument("--task", required=True, help="Objective for the agent swarm")
    parser.add_argument(
        "--strategies",
        help='Pipe-separated strategy names, e.g. "Aggressive Refactor|Minimal Patch|TDD Rewrite"',
    )
    parser.add_argument("--repo-dir", help="Repository root to branch with git worktree")
    parser.add_argument("--target-file", help="Relative file path agents should rewrite")
    parser.add_argument("--test-command", help="Command used as the deterministic evaluator")
    parser.add_argument("--results-dir", help="Directory where .splitmind_results.json is written")
    parser.add_argument("--base-branch", help="Base branch used for new worktrees")
    args = parser.parse_args()

    if args.repo_dir:
        MAIN_REPO_DIR = os.path.abspath(args.repo_dir)
        WORKTREE_BASE = os.path.join(MAIN_REPO_DIR, ".splitmind_run")
    if args.target_file:
        TARGET_FILE_REL = args.target_file
    if args.test_command:
        TEST_COMMAND = args.test_command
    if args.results_dir:
        RESULTS_DIR = os.path.abspath(args.results_dir)
    if args.base_branch:
        BASE_BRANCH = args.base_branch

    orchestrate_swarm(args.task, parse_strategies(args.strategies))
