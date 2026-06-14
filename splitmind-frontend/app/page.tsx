'use client';

import { useState, useEffect, useRef } from 'react';
import SplitMindVisualizer from '@/components/SplitMindVisualizer';
import AgentSidebar from '@/components/AgentSidebar';
import { RotateCcw, Activity, Terminal, Play, PanelRightOpen } from 'lucide-react';

type AgentStatus = 'idle' | 'running' | 'testing' | 'success' | 'failed' | 'merged';
type WorkflowStage = 'idle' | 'branching' | 'executing' | 'testing' | 'results' | 'merging';

interface Agent {
  id: string;
  strategy: string;
  status: AgentStatus;
  timing: number | null;
  exitCode: number | null;
}

interface WorkflowState {
  stage: WorkflowStage;
  agents?: Agent[];
  task?: string;
  winnerID?: string | null;
}

interface AgentResult {
  strategy: string;
  broken_code: string;
  fixed_code: string;
  test_output: string;
  exit_code: number;
  timing: number;
  branch?: string;
  target_file?: string;
  test_command?: string;
}

const DEMO_TASK = 'Fix the corrupted payment gateway implementation and preserve all payment contract tests.';

const DEMO_AGENTS: Agent[] = [
  { id: 'sm-refactor', strategy: 'Locale Validation Layer', status: 'idle', timing: null, exitCode: null },
  { id: 'sm-patch', strategy: 'Guard Clause Fix', status: 'idle', timing: null, exitCode: null },
  { id: 'sm-tdd', strategy: 'Contract-First Rewrite', status: 'idle', timing: null, exitCode: null },
];

const BROKEN_PAYMENT_CODE = `# src/payment_gateway.py

def get_cart_total(cart):
    return sum(item["price"] for item in cart["items"])

def process_payment(cart, user_locale):
    if user_locale == "US" and cart["currency"] != "USD":
        raise ValueError("Currency mismatch")

    return {
        "success": True,
        "total": get_cart_total(cart),
        "currency": cart["currency"],
    }
`;

const PATCH_PAYMENT_CODE = `# src/payment_gateway.py

def get_cart_total(cart):
    return sum(item.get("price", item.get("unit_price", 0)) for item in cart["items"])

def process_payment(cart, user_locale):
    locale_currency = {"US": "USD", "IN": "INR", "GB": "GBP", "DE": "EUR", "FR": "EUR"}
    expected = locale_currency.get(user_locale)
    if expected and cart["currency"] != expected:
        raise ValueError("Currency mismatch")

    return {
        "success": True,
        "total": get_cart_total(cart),
        "currency": cart["currency"],
    }
`;

const REFACTOR_PAYMENT_CODE = `# src/payment_gateway.py

LOCALE_RULES = {
    "US": "USD",
    "IN": "INR",
    "GB": "GBP",
    "DE": "EUR",
    "FR": "EUR",
}

def get_cart_total(cart):
    return float(sum(item.get("price", item.get("unit_price", 0)) for item in cart.get("items", [])))

def process_payment(cart, user_locale):
    expected = LOCALE_RULES.get(str(user_locale).upper())
    if expected and str(cart.get("currency", "")).upper() != expected:
        raise ValueError(f"Currency mismatch: expected {expected}")
    return {"success": True, "total": get_cart_total(cart), "currency": cart.get("currency")}
`;

const TDD_PAYMENT_CODE = `# src/payment_gateway.py

LOCALE_CURRENCY_RULES = {
    "US": "USD",
    "IN": "INR",
    "GB": "GBP",
    "DE": "EUR",
    "FR": "EUR",
}

def get_cart_total(cart):
    total = 0
    for item in cart.get("items", []):
        total += item.get("price", item.get("unit_price", 0))
    return float(total)

def process_payment(cart, user_locale):
    expected = LOCALE_CURRENCY_RULES.get(str(user_locale).upper())
    currency = str(cart.get("currency", "")).upper()

    if expected and currency != expected:
        raise ValueError(
            f"Currency mismatch: locale {user_locale} requires {expected}, got {cart.get('currency')}"
        )

    return {
        "success": True,
        "total": get_cart_total(cart),
        "currency": cart.get("currency"),
    }
`;

const TEST_OUTPUT = `============================= test session starts =============================
collecting ... collected 3 items

tests/test_payments.py::test_valid_usd_payment PASSED                    [ 33%]
tests/test_payments.py::test_eu_locales_raise_error PASSED               [ 66%]
tests/test_payments.py::test_cart_total_supports_unit_price PASSED       [100%]

============================== 3 passed in 0.05s ==============================`;

const DEMO_RESULTS: Record<string, AgentResult> = {
  'sm-refactor': {
    strategy: 'Locale Validation Layer',
    broken_code: BROKEN_PAYMENT_CODE,
    fixed_code: REFACTOR_PAYMENT_CODE,
    test_output: TEST_OUTPUT,
    exit_code: 0,
    timing: 7.6,
    branch: 'sm-refactor',
    target_file: 'src/payment_gateway.py',
    test_command: 'pytest tests/ -v --tb=short --no-header',
  },
  'sm-patch': {
    strategy: 'Guard Clause Fix',
    broken_code: BROKEN_PAYMENT_CODE,
    fixed_code: PATCH_PAYMENT_CODE,
    test_output: TEST_OUTPUT,
    exit_code: 0,
    timing: 5.9,
    branch: 'sm-patch',
    target_file: 'src/payment_gateway.py',
    test_command: 'pytest tests/ -v --tb=short --no-header',
  },
  'sm-tdd': {
    strategy: 'Contract-First Rewrite',
    broken_code: BROKEN_PAYMENT_CODE,
    fixed_code: TDD_PAYMENT_CODE,
    test_output: TEST_OUTPUT,
    exit_code: 0,
    timing: 5.9,
    branch: 'sm-tdd',
    target_file: 'src/payment_gateway.py',
    test_command: 'pytest tests/ -v --tb=short --no-header',
  },
};

export default function Home() {
  const [workflowState, setWorkflowState] = useState<WorkflowState>({ stage: 'idle' });
  const [isDemoMode, setIsDemoMode] = useState<boolean>(false);
  const [task, setTask] = useState<string>('');
  const [agentResults, setAgentResults] = useState<Record<string, AgentResult>>({});

  const [sidebarOpen, setSidebarOpen] = useState<boolean>(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  const terminalRef = useRef<HTMLDivElement>(null);
  const demoTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const isLaunching = false;

  useEffect(() => {
    return () => {
      demoTimersRef.current.forEach(clearTimeout);
    };
  }, []);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [workflowState]);

  const launchSwarm = () => {
    if (!task.trim() || isLaunching) return;
    playDemo(task.trim());
  };

  const scheduleDemoState = (
    delay: number,
    state: WorkflowState,
    results?: Record<string, AgentResult>,
    selectedAgent?: string,
  ) => {
    const timer = setTimeout(() => {
      setWorkflowState(state);
      if (results) {
        setAgentResults(results);
      }
      if (selectedAgent) {
        setSelectedAgentId(selectedAgent);
      }
    }, delay);
    demoTimersRef.current.push(timer);
  };

  const playDemo = (promptText = DEMO_TASK) => {
    if (workflowState.stage !== 'idle' || isLaunching) return;

    const demoTask = promptText.trim() || DEMO_TASK;
    demoTimersRef.current.forEach(clearTimeout);
    demoTimersRef.current = [];
    setIsDemoMode(true);
    setTask(demoTask);
    setSidebarOpen(false);
    setSelectedAgentId(null);
    setAgentResults({});

    const runningAgents = DEMO_AGENTS.map(agent => ({ ...agent, status: 'running' as AgentStatus }));
    const testingAgents = DEMO_AGENTS.map(agent => ({ ...agent, status: 'testing' as AgentStatus }));
    const finishedAgents: Agent[] = [
      { ...DEMO_AGENTS[0], status: 'failed', timing: 7.6, exitCode: 0 },
      { ...DEMO_AGENTS[1], status: 'failed', timing: 5.9, exitCode: 0 },
      { ...DEMO_AGENTS[2], status: 'success', timing: 5.9, exitCode: 0 },
    ];

    scheduleDemoState(0, {
      stage: 'branching',
      task: demoTask,
      agents: DEMO_AGENTS,
      winnerID: null,
    });

    scheduleDemoState(900, {
      stage: 'executing',
      task: demoTask,
      agents: runningAgents,
      winnerID: null,
    });

    scheduleDemoState(1900, {
      stage: 'testing',
      task: demoTask,
      agents: testingAgents,
      winnerID: null,
    });

    scheduleDemoState(
      3200,
      {
        stage: 'results',
        task: demoTask,
        agents: finishedAgents,
        winnerID: 'sm-tdd',
      },
      DEMO_RESULTS,
      'sm-tdd',
    );

    scheduleDemoState(
      4400,
      {
        stage: 'merging',
        task: demoTask,
        agents: finishedAgents,
        winnerID: 'sm-tdd',
      },
      DEMO_RESULTS,
      'sm-tdd',
    );
  };

  const resetDashboard = async () => {
    demoTimersRef.current.forEach(clearTimeout);
    demoTimersRef.current = [];
    setIsDemoMode(false);
    setWorkflowState({ stage: 'idle' });
    setAgentResults({});
    setSelectedAgentId(null);
    setSidebarOpen(false);
  };

  const openAgent = (agentId: string) => {
    setSelectedAgentId(agentId);
    setSidebarOpen(true);
  };

  const hasResults = Object.keys(agentResults).length > 0;
  const agents = workflowState.agents ?? [];
  const allAgentsFinished = agents.length > 0 &&
    agents.every(agent => agent.status === 'success' || agent.status === 'failed');
  const allAgentsFailed = allAgentsFinished &&
    agents.every(agent => {
      const result = agentResults[agent.id];
      return (result?.exit_code ?? agent.exitCode ?? 1) !== 0;
    });

  return (
    <main className="flex min-h-screen flex-col bg-[#0a0f1e]">

      {/* Task input bar */}
      <div className="w-full px-6 pt-4 pb-3 border-b border-slate-800 flex gap-3 items-center">
        <Terminal className="w-4 h-4 text-slate-500 shrink-0" />
        <input
          type="text"
          value={task}
          onChange={e => setTask(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && launchSwarm()}
          placeholder="Describe the bug or task — e.g. Fix critical payment currency bug for IN locale"
          disabled={workflowState.stage !== 'idle' || isLaunching}
          className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-4 py-2 text-sm
                     font-mono text-slate-200 placeholder:text-slate-600
                     focus:outline-none focus:border-sky-600
                     disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <button
          onClick={launchSwarm}
          disabled={!task.trim() || workflowState.stage !== 'idle' || isLaunching}
          className="flex items-center gap-2 px-5 py-2 bg-sky-600 hover:bg-sky-500
                     disabled:bg-slate-700 disabled:text-slate-500
                     text-white text-sm font-bold rounded-xl transition"
        >
          <Play className="w-4 h-4" />
          {isLaunching ? 'Launching…' : 'Run Swarm'}
        </button>

        {hasResults && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600
                       text-slate-200 text-sm font-bold rounded-xl transition border border-slate-600"
          >
            <PanelRightOpen className="w-4 h-4" />
            View Code
          </button>
        )}
      </div>

      {/* Graph canvas */}
      <div className="flex-grow w-full h-[65vh] border-b border-slate-800 relative">
        <SplitMindVisualizer
          workflowState={workflowState}
          onNodeClick={(agentId: string) => {
            if (agentResults[agentId]) openAgent(agentId);
          }}
        />

        <div className="absolute bottom-6 right-6 z-20 bg-slate-900/90 p-3 rounded-2xl
                        border border-slate-700 shadow-2xl flex gap-3 items-center">
          <div className="font-mono text-sm text-slate-500 px-3 flex items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-500 animate-pulse" />
            {isDemoMode ? 'Hosted Demo Replay' : 'Demo Ready'}
          </div>
          <button
            onClick={resetDashboard}
            className="p-2 bg-slate-800 text-slate-300 rounded-xl hover:bg-slate-700 transition"
            title="Reset Dashboard"
          >
            <RotateCcw className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Terminal */}
      <div
        ref={terminalRef}
        className="h-[20vh] w-full bg-black p-4 font-mono text-sm text-emerald-400
                   overflow-y-auto border-t border-slate-800"
      >
        <p className="text-slate-600 mb-2">{'// SplitMind Live Telemetry Stream'}</p>

        {workflowState.stage === 'idle' && (
          <p className="text-slate-500 animate-pulse">
            Waiting for task — type above and press Run Swarm…
          </p>
        )}

        {workflowState.task && workflowState.stage !== 'idle' && (
          <p className="text-white">&gt; splitmind --task &quot;{workflowState.task}&quot;</p>
        )}

        {['branching', 'executing', 'testing', 'results', 'merging'].includes(workflowState.stage) && (
          <p className="text-sky-400">[SYSTEM] Spawning isolated Git Worktrees…</p>
        )}

        {['executing', 'testing', 'results', 'merging'].includes(workflowState.stage) && (
          <p className="text-sky-300">[SWARM]  Parallel agents calling AI API…</p>
        )}

        {['testing', 'results', 'merging'].includes(workflowState.stage) && (
          <p className="text-amber-400">[EVAL]   Running pytest across all branches…</p>
        )}

        {['results', 'merging'].includes(workflowState.stage) &&
          agents.map(agent => {
            const res = agentResults[agent.id];
            const timing = res?.timing ?? agent.timing;
            const exitCode = res?.exit_code ?? agent.exitCode;
            const isWinner = workflowState.winnerID === agent.id;

            if (agent.status === 'success') {
              return (
                <p key={agent.id} className="text-emerald-400 font-bold">
                  [EVAL]&nbsp;&nbsp; {agent.id} ({agent.strategy}): ✓ EXIT 0
                  {timing != null ? ` — ${timing}s` : ''}{' '}
                  {isWinner ? ' - winner selected' : ' - tests passed'}
                  {' '}
                  <button
                    className="text-emerald-300 underline cursor-pointer hover:text-emerald-100"
                    onClick={() => openAgent(agent.id)}
                  >
                    [view diff]
                  </button>
                </p>
              );
            }
            // if (agent.status === 'failed') {
            //   return (
            //     <p key={agent.id} className="text-red-400">
            //       [EVAL]&nbsp;&nbsp; {agent.id} ({agent.strategy}): ✗ EXIT {exitCode ?? 1} — Regression detected
            //       {timing != null ? ` (${timing}s)` : ''}{' '}
            //       {res && (
            //         <button
            //           className="text-red-300 underline cursor-pointer hover:text-red-100"
            //           onClick={() => openAgent(agent.id)}
            //         >
            //           [view output]
            //         </button>
            //       )}
            //     </p>
            //   );
            // }
            if (agent.status === 'failed') {
              const isPruned = exitCode === 0;
              
              // If Exit 0, it's a tiebreaker prune. If Exit 1, it's a real failure.
              const reasonText = isPruned ? "Passed, pruned by tiebreaker" : "Regression detected";
              const textColor  = isPruned ? "text-slate-500" : "text-red-400";
              const icon       = isPruned ? "⊘" : "✗";

              return (
                <p key={agent.id} className={textColor}>
                  [EVAL]&nbsp;&nbsp; {agent.id} ({agent.strategy}): {icon} EXIT {exitCode ?? 1} — {reasonText}
                  {timing != null ? ` (${timing}s)` : ''}{' '}
                  {res && (
                    <button
                      className={`${isPruned ? 'text-slate-400 hover:text-slate-200' : 'text-red-300 hover:text-red-100'} underline cursor-pointer`}
                      onClick={() => openAgent(agent.id)}
                    >
                      [view output]
                    </button>
                  )}
                </p>
              );
            }
            return null;
          })
        }

        {workflowState.stage === 'results' && allAgentsFailed && (
          <>
            <p className="text-red-300 font-bold mt-2">
              [MERGE]  Skipped. No branch passed the deterministic test command.
            </p>
            <p className="text-slate-300 font-bold mt-1">MAIN BRANCH UNTOUCHED.</p>
          </>
        )}

        {workflowState.stage === 'merging' && workflowState.winnerID && (
          <>
            <p className="text-sky-300 font-bold mt-2">
              [SELECT] {workflowState.winnerID} selected by minimal-diff tiebreaker among passing branches.
            </p>
            <p className="text-emerald-300 font-bold mt-2">
              [MERGE]  Fast-forwarding main with {workflowState.winnerID ?? 'winning branch'}. Pruning non-winning worktrees.
            </p>
            <p className="text-white font-bold mt-1">✓ SYSTEM STABLE.</p>
          </>
        )}
      </div>

      {/* Sidebar */}
      <AgentSidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        agents={workflowState.agents ?? []}
        agentResults={agentResults}
        selectedAgentId={selectedAgentId}
        onSelectAgent={setSelectedAgentId}
        winnerId={workflowState.winnerID ?? null}
      />
    </main>
  );
}
