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

export default function Home() {
  const [workflowState, setWorkflowState] = useState<WorkflowState>({ stage: 'idle' });
  const [isPolling, setIsPolling] = useState<boolean>(true);
  const [task, setTask] = useState<string>('');
  const [isLaunching, setIsLaunching] = useState<boolean>(false);
  const [agentResults, setAgentResults] = useState<Record<string, AgentResult>>({});

  const [sidebarOpen, setSidebarOpen] = useState<boolean>(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  const terminalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isPolling) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/state');
        if (!res.ok) return;
        const data = await res.json();
        setWorkflowState(data);

        if (data.stage === 'results' || data.stage === 'merging') {
          const rRes = await fetch('/api/results');
          if (rRes.ok) {
            const results = await rRes.json();
            setAgentResults(results);
            // We load the data, but DO NOT force the sidebar open automatically.
            // We just ensure a tab is selected in the background so it's ready.
            if (Object.keys(results).length > 0) {
              setSelectedAgentId(prev => prev ?? Object.keys(results)[0]);
            }
          }
        }
      } catch { }
    }, 500);
    return () => clearInterval(interval);
  }, [isPolling]);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [workflowState]);

  const launchSwarm = async () => {
    if (!task.trim() || isLaunching) return;
    setIsLaunching(true);
    setSidebarOpen(false);
    setSelectedAgentId(null);
    setAgentResults({});
    try {
      await fetch('/api/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task }),
      });
    } catch (e) {
      console.error('Launch failed:', e);
    } finally {
      setIsLaunching(false);
    }
  };

  const resetDashboard = async () => {
    try {
      await fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: 'idle', agents: [] }),
      });
      setWorkflowState({ stage: 'idle' });
      setAgentResults({});
      setSelectedAgentId(null);
      setSidebarOpen(false);
    } catch { }
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
            Live Telemetry
          </div>
          <button
            onClick={() => setIsPolling(p => !p)}
            className={`px-4 py-2 rounded-xl font-bold transition text-sm ${isPolling
                ? 'bg-amber-600/20 text-amber-500 hover:bg-amber-600/40'
                : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
              }`}
          >
            {isPolling ? 'Pause Sync' : 'Resume Sync'}
          </button>
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
