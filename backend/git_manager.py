import os
import subprocess
import shutil
import concurrent.futures
import time
import random
import stat

# --- CONFIGURATION ---
SANDBOX_DIR = "splitmind_sandbox"
MAIN_REPO_DIR = os.path.join(SANDBOX_DIR, "core_repo")
WORKTREE_BASE_DIR = os.path.join(SANDBOX_DIR, ".worktrees")



def onerror(func, path, exc_info):
    """Error handler for shutil.rmtree to fix Read-Only or Locked files."""
    if not os.access(path, os.W_OK):
        os.chmod(path, stat.S_IWUSR)
        func(path)
    else:
        raise

def safe_rmtree(path):
    if os.path.exists(path):
        shutil.rmtree(path, onerror=onerror)

def run_cmd(cmd, cwd=None, capture=True):
    """Executes a shell command and returns the output."""
    result = subprocess.run(cmd, cwd=cwd, shell=True, text=True, capture_output=capture)
    if result.returncode != 0 and capture:
        print(f"[ERROR] Command failed: {cmd}\n{result.stderr}")
    return result

def setup_sandbox():
    """Creates a fresh dummy repository to test our worktree logic safely."""
    if os.path.exists(SANDBOX_DIR):
        safe_rmtree(SANDBOX_DIR) # Use the safe version
    
    os.makedirs(MAIN_REPO_DIR)
    os.makedirs(WORKTREE_BASE_DIR)
    
    # Initialize git and create a dummy main commit
    run_cmd("git init -b main", cwd=MAIN_REPO_DIR)
    
    # Create a baseline file representing our "broken" code
    baseline_code = os.path.join(MAIN_REPO_DIR, "calculator.py")
    with open(baseline_code, "w") as f:
        f.write("def add(a, b):\n    return a - b  # Intentional bug\n")
    
    run_cmd("git add .", cwd=MAIN_REPO_DIR)
    run_cmd('git commit -m "Initial commit with a bug"', cwd=MAIN_REPO_DIR)
    print(f"    Sandbox created at: {os.path.abspath(MAIN_REPO_DIR)}")

def create_worktree(branch_name):
    """Spawns an isolated Git Worktree for a specific branch."""
    worktree_path = os.path.abspath(os.path.join(WORKTREE_BASE_DIR, branch_name))
    
    # Ensure the directory is created by Git
    run_cmd(f'git worktree add -b "{branch_name}" "{worktree_path}" main', cwd=MAIN_REPO_DIR)
    
    # WAIT for the file to actually exist (The Fix)
    target_file = os.path.join(worktree_path, "calculator.py")
    timeout = 5
    while not os.path.exists(target_file) and timeout > 0:
        time.sleep(0.5)
        timeout -= 1
        
    return worktree_path

def simulate_agent_execution(branch_name, worktree_path):
    """Mocks the Codex API and a deterministic test eval."""
    target_file = os.path.join(worktree_path, "calculator.py")
    
    # Double check file exists
    if not os.path.exists(target_file):
        print(f"    [ERROR] {branch_name} failed to initialize file at {target_file}")
        return None

    # Simulate Codex API latency
    time.sleep(random.uniform(1.0, 2.5))
    
    if "patch" in branch_name:
        with open(target_file, "w") as f:
            f.write("def add(a, b):\n    return a + b  # Fixed!\n")
        exit_code = 0
    else:
        with open(target_file, "w") as f:
            f.write("def add(a, b):\n    pass # AI Hallucinated\n")
        exit_code = 1
    
    # Ensure Git registers the change
    run_cmd(f'git add "calculator.py"', cwd=worktree_path)
    run_cmd(f'git commit -m "Agent {branch_name} execution"', cwd=worktree_path)
    
    return branch_name if exit_code == 0 else None

def orchestrate_swarm():
    """Runs the parallel branching, execution, and deterministic merging."""
    print("\n>>> [2] FORKING REALITY (SPAWNING WORKTREES)...")
    strategies = ["Locale Validation Layer", "Guard Clause Fix", "Contract-First Rewrite"]
    
    # Create isolated file systems
    paths = {strat: create_worktree(strat) for strat in strategies}
    
    print("\n>>> [3] EXECUTING PARALLEL AGENTS & EVALS...")
    winner = None
    
    # Run the agents simultaneously using multi-threading
    with concurrent.futures.ThreadPoolExecutor() as executor:
        futures = {
            executor.submit(simulate_agent_execution, strat, path): strat 
            for strat, path in paths.items()
        }
        
        for future in concurrent.futures.as_completed(futures):
            successful_branch = future.result()
            if successful_branch:
                winner = successful_branch
                
    print("\n>>> [4] DETERMINISTIC MERGE RESOLUTION...")
    if winner:
        print(f"    🏆 Winner identified: {winner}. Merging into main...")
        # Merge the winning branch into main
        run_cmd(f"git merge {winner}", cwd=MAIN_REPO_DIR)
        print("    ✅ Merge successful. The codebase is stable.")
    else:
        print("    ❌ All agents failed. Main branch remains untouched.")

    print("\n>>> [5] PRUNING FAILURES (CLEANUP)...")
    for strat in strategies:
        # 1. Remove the worktree reference
        run_cmd(f'git worktree remove -f "{strat}"', cwd=MAIN_REPO_DIR)
        # 2. Force delete the branch
        run_cmd(f"git branch -D {strat}", cwd=MAIN_REPO_DIR)
    
    # 3. Clean up the physical directory
    safe_rmtree(WORKTREE_BASE_DIR)
    print("    🧹 File system reset. Sandbox clean.")

if __name__ == "__main__":
    setup_sandbox()
    orchestrate_swarm()