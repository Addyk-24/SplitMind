'use client';

import { useEffect, useRef } from 'react';
import { X, XCircle, Clock, GitBranch, ChevronRight, Trophy } from 'lucide-react';

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

interface Agent {
  id: string;
  strategy: string;
  status: string;
  timing: number | null;
  exitCode: number | null;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  agents: Agent[];
  agentResults: Record<string, AgentResult>;
  selectedAgentId: string | null;
  onSelectAgent: (id: string) => void;
  winnerId?: string | null;
}

// Compute a simple line-level diff between two code strings
function computeDiff(before: string, after: string) {
  const beforeLines = before.split('\n');
  const afterLines  = after.split('\n');
  const maxLen = Math.max(beforeLines.length, afterLines.length);
  const result: { line: string; type: 'same' | 'removed' | 'added' }[] = [];

  for (let i = 0; i < maxLen; i++) {
    const b = beforeLines[i];
    const a = afterLines[i];
    if (b === a) {
      result.push({ line: b ?? '', type: 'same' });
    } else {
      if (b !== undefined) result.push({ line: b, type: 'removed' });
      if (a !== undefined) result.push({ line: a, type: 'added' });
    }
  }
  return result;
}

const STRATEGY_DESCRIPTIONS: Record<string, string> = {
  'Locale Validation Layer':
    'Restructures the module with a proper validation layer — extracts locale/currency rules into a mapping dict and makes it extensible for future locales.',
  'Guard Clause Fix':
    'Makes the smallest possible change that fixes the bug. One or two lines. Does not restructure or rename anything.',
  'Contract-First Rewrite':
    'Rewrites the function from scratch treating the test file as the specification. Adds a docstring describing the contract.',
};

export default function AgentSidebar({
  isOpen,
  onClose,
  agents,
  agentResults,
  selectedAgentId,
  onSelectAgent,
  winnerId,
}: Props) {
  const activeResult = selectedAgentId ? agentResults[selectedAgentId] : null;
  const activeAgent = agents.find(a => a.id === selectedAgentId);
  const sidebarRef   = useRef<HTMLDivElement>(null);
  const branchName = activeResult?.branch ?? selectedAgentId;
  const targetFile = activeResult?.target_file ?? 'src/payment_gateway.py';
  const testCommand = activeResult?.test_command ?? 'pytest tests/';

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const diff = activeResult
    ? computeDiff(activeResult.broken_code, activeResult.fixed_code)
    : [];

  const activeIsWinner = !!activeResult && activeResult.exit_code === 0 && selectedAgentId === winnerId;
  const activePassedAwaitingDecision = !!activeResult && activeResult.exit_code === 0 && !winnerId
    && activeAgent?.status === 'success';
  const activePassedButPruned = !!activeResult && activeResult.exit_code === 0 && !!winnerId && selectedAgentId !== winnerId;
  const activeFailed = !!activeResult && activeResult.exit_code !== 0;
  const activeDecision = activeIsWinner
    ? 'Winner - merged by minimal-diff tiebreaker'
      : activePassedButPruned
        ? 'Passed - pruned by minimal-diff tiebreaker'
        : activePassedAwaitingDecision
          ? 'Tests passed - awaiting merge decision'
      : activeFailed
        ? 'Failed - branch pruned'
        : 'Awaiting result';
  const activeDecisionClass = activeIsWinner
    ? 'text-emerald-300'
    : activePassedAwaitingDecision
      ? 'text-emerald-300'
    : activePassedButPruned
      ? 'text-slate-300'
      : 'text-red-300';

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-300 ${
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      {/* Sidebar panel */}
      <div
        ref={sidebarRef}
        className={`fixed top-0 right-0 z-50 h-full w-[720px] max-w-[95vw]
                    bg-[#0d1424] border-l border-slate-700/60 shadow-2xl
                    flex flex-col transition-transform duration-300 ease-out ${
                      isOpen ? 'translate-x-0' : 'translate-x-full'
                    }`}
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700/60">
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-sky-400" />
            <span className="font-mono text-sm font-bold text-white">Agent Results</span>
            <span className="text-xs text-slate-500 font-mono">
              {Object.keys(agentResults).length}/{agents.length} evaluated
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/60 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Agent tab strip ─────────────────────────────────────────────── */}
        <div className="flex border-b border-slate-700/60 px-2 pt-2 gap-1 shrink-0">
          {agents.map(agent => {
            const res      = agentResults[agent.id];
            const isActive = selectedAgentId === agent.id;
            const passed   = res?.exit_code === 0;
            const winner   = passed && agent.id === winnerId;
            const awaiting = passed && !winnerId && agent.status === 'success';
            const pruned   = passed && !!winnerId && !winner;
            const failed   = !!res && res.exit_code !== 0;
            const hasData  = !!res;

            return (
              <button
                key={agent.id}
                onClick={() => hasData && onSelectAgent(agent.id)}
                disabled={!hasData}
                className={`flex items-center gap-2 px-3 py-2 rounded-t-lg text-xs font-mono
                            transition border-b-2 -mb-px
                            ${isActive
                              ? winner || awaiting
                                ? 'border-emerald-400 bg-emerald-950/30 text-emerald-300'
                                : failed
                                  ? 'border-red-400 bg-red-950/30 text-red-300'
                                  : 'border-slate-400 bg-slate-800/60 text-slate-300'
                              : 'border-transparent text-slate-500 hover:text-slate-300 hover:bg-slate-800/40'
                            }
                            ${!hasData ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                {winner
                  ? <Trophy className="w-3.5 h-3.5 text-emerald-400" />
                  : awaiting
                    ? <GitBranch className="w-3.5 h-3.5 text-emerald-400" />
                  : pruned
                    ? <GitBranch className="w-3.5 h-3.5 text-slate-400" />
                  : failed
                    ? <XCircle className="w-3.5 h-3.5 text-red-400" />
                    : <div className="w-3.5 h-3.5 rounded-full border border-slate-600" />
                }
                <span>{agent.strategy}</span>
                {(res?.timing ?? agent.timing) != null && (
                  <span className="opacity-60">{res?.timing ?? agent.timing}s</span>
                )}
              </button>
            );
          })}
        </div>

        {/* ── Content area ────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">
          {!activeResult ? (
            /* Empty state */
            <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-600">
              <ChevronRight className="w-8 h-8" />
              <p className="font-mono text-sm">Select an agent tab above to view its code</p>
            </div>
          ) : (
            <div className="flex flex-col h-full">

              {/* Result banner */}
              <div className={`flex items-center justify-between px-5 py-3 border-b border-slate-700/40
                              ${activeIsWinner
                                ? 'bg-emerald-950/20'
                                : activePassedButPruned
                                  ? 'bg-slate-900/70'
                                  : 'bg-red-950/20'}`}>
                <div className="flex items-center gap-3">
                  {activeIsWinner
                    ? <Trophy className="w-5 h-5 text-emerald-400" />
                    : activePassedButPruned
                      ? <GitBranch className="w-5 h-5 text-slate-400" />
                      : <XCircle className="w-5 h-5 text-red-400" />
                  }
                  <div>
                    <p className={`font-bold text-sm ${activeDecisionClass}`}>
                      {activeDecision}
                      <span className="hidden">
                      {activeResult.exit_code === 0 ? 'Tests passed — merged to main' : 'Tests failed — branch pruned'}
                      </span>
                    </p>
                    <p className="text-xs text-slate-500 font-mono mt-0.5">
                      {STRATEGY_DESCRIPTIONS[activeResult.strategy] || activeResult.strategy}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-xs font-mono text-slate-400
                                bg-slate-800 px-2 py-1 rounded-lg border border-slate-700">
                  <Clock className="w-3 h-3" />
                  {activeResult.timing}s
                </div>
              </div>

              {/* Execution metadata */}
              <div className="grid grid-cols-2 gap-2 px-5 py-3 border-b border-slate-700/40 bg-[#0a1020] text-[11px] font-mono">
                <div className="rounded-lg border border-slate-700/60 bg-slate-900/50 px-3 py-2">
                  <p className="text-slate-500 uppercase tracking-widest">Branch</p>
                  <p className="text-slate-200 mt-1">{branchName}</p>
                </div>
                <div className="rounded-lg border border-slate-700/60 bg-slate-900/50 px-3 py-2">
                  <p className="text-slate-500 uppercase tracking-widest">Decision</p>
                  <p className={activeDecisionClass}>{activeDecision}</p>
                </div>
                <div className="rounded-lg border border-slate-700/60 bg-slate-900/50 px-3 py-2">
                  <p className="text-slate-500 uppercase tracking-widest">Test Command</p>
                  <p className="text-slate-200 mt-1">{testCommand}</p>
                </div>
                <div className="rounded-lg border border-slate-700/60 bg-slate-900/50 px-3 py-2">
                  <p className="text-slate-500 uppercase tracking-widest">Exit Code</p>
                  <p className={activeResult.exit_code === 0 ? 'text-emerald-300 mt-1' : 'text-red-300 mt-1'}>
                    EXIT {activeResult.exit_code}
                  </p>
                </div>
              </div>

              {/* Code diff */}
              <div className="px-5 pt-4 pb-2 shrink-0">
                <p className="text-xs font-mono text-slate-500 uppercase tracking-widest mb-3">
                  Code Diff - {targetFile}
                </p>
                <div className="rounded-xl overflow-hidden border border-slate-700/60 text-xs font-mono">
                  {/* Column headers */}
                  <div className="grid grid-cols-2 divide-x divide-slate-700/60">
                    <div className="px-3 py-1.5 bg-red-950/30 text-red-400 text-[10px] uppercase tracking-widest">
                      Before (broken)
                    </div>
                    <div className="px-3 py-1.5 bg-emerald-950/30 text-emerald-400 text-[10px] uppercase tracking-widest">
                      After (Agent Output)
                    </div>
                  </div>

                  {/* Side-by-side diff lines */}
                  <div className="grid grid-cols-2 divide-x divide-slate-700/40 max-h-64 overflow-y-auto">
                    <pre className="p-3 text-[11px] whitespace-pre-wrap leading-5 bg-slate-900/60 text-red-200">
                      {activeResult.broken_code}
                    </pre>
                    <pre className={`p-3 text-[11px] whitespace-pre-wrap leading-5 bg-slate-900/60 ${
                      activeResult.exit_code === 0 ? 'text-emerald-200' : 'text-slate-400'
                    }`}>
                      {activeResult.fixed_code}
                    </pre>
                  </div>
                </div>
              </div>

              {/* Inline diff (changed lines highlighted) */}
              <div className="px-5 pt-2 pb-4">
                <p className="text-xs font-mono text-slate-500 uppercase tracking-widest mb-2">
                  Changed lines
                </p>
                <div className="rounded-xl border border-slate-700/60 overflow-auto max-h-40 bg-[#080d18]">
                  <table className="w-full text-[11px] font-mono">
                    <tbody>
                      {diff.map((row, i) => (
                        <tr
                          key={i}
                          className={
                            row.type === 'removed' ? 'bg-red-950/40' :
                            row.type === 'added'   ? 'bg-emerald-950/40' :
                            ''
                          }
                        >
                          <td className={`pl-3 pr-2 py-0.5 select-none w-4 text-right opacity-50 ${
                            row.type === 'removed' ? 'text-red-400' :
                            row.type === 'added'   ? 'text-emerald-400' :
                            'text-slate-600'
                          }`}>
                            {row.type === 'removed' ? '−' : row.type === 'added' ? '+' : ' '}
                          </td>
                          <td className={`pr-3 py-0.5 whitespace-pre ${
                            row.type === 'removed' ? 'text-red-300' :
                            row.type === 'added'   ? 'text-emerald-300' :
                            'text-slate-500'
                          }`}>
                            {row.line}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Pytest output */}
              <div className="px-5 pb-5">
                <p className="text-xs font-mono text-slate-500 uppercase tracking-widest mb-2">
                  pytest output
                </p>
                <div className="rounded-xl border border-slate-700/60 bg-black p-3 max-h-48 overflow-y-auto">
                  <pre className="text-[11px] font-mono whitespace-pre-wrap leading-5 text-slate-300">
                    {activeResult.test_output || 'No output captured.'}
                  </pre>
                </div>
              </div>

            </div>
          )}
        </div>
      </div>
    </>
  );
}
