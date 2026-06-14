'use client';

import React, { useEffect, useRef, useCallback } from 'react';
import {
    ReactFlow,
    Background,
    useNodesState,
    useEdgesState,
    Handle,
    Position,
    MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
    GitBranch, BrainCircuit, XCircle, CheckCircle2,
    FlaskConical, Loader2, Clock,
} from 'lucide-react';
import { twMerge } from 'tailwind-merge';

//  LAYOUT 
const X_START = 80;
const X_AGENTS = 460;
const X_FINAL = 860;
const Y_CENTER = 280;
const Y_GAP = 190;

const nodeDefaults = { sourcePosition: Position.Right, targetPosition: Position.Left };

const mkEdge = (id, source, target, opts = {}) => ({
    id, source, target,
    type: 'smoothstep',
    animated: opts.animated ?? true,
    style: opts.style ?? { strokeWidth: 2, stroke: '#64748b' },
    markerEnd: opts.markerEnd ?? { type: MarkerType.ArrowClosed, color: '#64748b' },
});

//  NODE COMPONENT 
const AgentNode = ({ data }) => {

    const isPruned = data.status === 'failed' && data.exitCode === 0;
    const isWinner = data.isWinner;

    const colors = {
        idle: 'border-slate-600   bg-slate-900/50  text-slate-400',
        running: 'border-sky-500    bg-sky-950/50    text-sky-200    shadow-lg shadow-sky-500/20',
        testing: 'border-amber-500  bg-amber-950/50  text-amber-200  shadow-lg shadow-amber-500/20',
        success: 'border-emerald-500 bg-emerald-950/50 text-emerald-200 shadow-lg shadow-emerald-500/20',

        failed: isPruned
            ? 'border-slate-600 bg-slate-900/80 text-slate-400 opacity-50'
            : 'border-red-500 bg-red-950/50 text-red-200 opacity-70',
        merged: 'border-emerald-400 bg-emerald-900   text-emerald-50',
    };
    const icons = {
        idle: <BrainCircuit className="w-5 h-5 shrink-0" />,
        running: <Loader2 className="w-5 h-5 shrink-0 animate-spin" />,
        testing: <FlaskConical className="w-5 h-5 shrink-0 animate-pulse" />,
        success: <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-400" />,


        failed: isPruned
            ? <GitBranch className="w-5 h-5 shrink-0 text-slate-500" />
            : <XCircle className="w-5 h-5 shrink-0 text-red-400" />,
        merged: <GitBranch className="w-5 h-5 shrink-0" />,
    };

    // const detail = {
    //     idle: '', running: 'Calling AI API…', testing: 'Running pytest…',
    //     success: 'Tests passed (Exit 0)', failed: 'Regression detected (Exit 1)',
    //     merged: 'Validated & merged',
    // };

    let detail = '';
    if (data.status === 'running') detail = 'Calling AI API…';
    else if (data.status === 'testing') detail = 'Running pytest…';
    else if (data.status === 'success') detail = isWinner ? 'Winner: tests passed' : 'Tests passed (Exit 0)';
    else if (data.status === 'merged') detail = 'Validated & merged';
    else if (data.status === 'failed') {
        detail = isPruned ? 'Pruned (Tiebreaker)' : 'Regression detected (Exit 1)';
    }

    const clickable = (data.status === 'success' || data.status === 'failed') && data.hasResult;

    return (
        <div className={twMerge(
            'px-4 py-3 rounded-xl border-2 shadow-2xl backdrop-blur-sm min-w-[230px] transition-all duration-300',
            colors[data.status] ?? colors.idle,
            clickable ? 'cursor-pointer hover:ring-1 hover:ring-white/30' : '',
        )}>
            <Handle type="target" position={Position.Left} className="w-3 h-3 !bg-slate-700" />
            <div className="flex items-center gap-3">
                {icons[data.status] ?? icons.idle}
                <div className="flex-1 min-w-0">
                    <div className="font-mono text-[10px] uppercase text-slate-500 truncate">
                        {data.strategy || 'MAIN BRANCH'}
                    </div>
                    <div className="font-bold text-sm tracking-tight truncate">
                        {data.status === 'idle' ? 'Awaiting task…' : data.label}
                    </div>
                    <div className="text-xs italic opacity-70 mt-0.5 truncate">
                        {detail}
                    </div>
                </div>
                {data.timing != null && (
                    <div className={twMerge(
                        'flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full shrink-0',
                        data.status === 'success' ? 'bg-emerald-900 text-emerald-300' :
                            isPruned ? 'bg-slate-800 text-slate-400' : 'bg-red-900/60 text-red-300',
                    )}>
                        <Clock className="w-3 h-3" />{data.timing}s
                    </div>
                )}
            </div>
            <Handle type="source" position={Position.Right} className="w-3 h-3 !bg-slate-700" />
        </div>
    );
};

const nodeTypes = { agent: AgentNode };

const INITIAL_NODES = [{
    id: 'main-v1', type: 'agent',
    position: { x: X_START, y: Y_CENTER },
    data: { label: 'Main (v1.0)', status: 'merged', strategy: 'Trunk' },
    ...nodeDefaults,
}];

//  MAIN COMPONENT 
export default function SplitMindVisualizer({ workflowState, onNodeClick }) {
    const [nodes, setNodes, onNodesChange] = useNodesState(INITIAL_NODES);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);

    // Refs — always fresh, never stale in effects
    const yMapRef = useRef({});   // agentId → Y coordinate, set at branching
    const mergeDrawnRef = useRef(false); // guard: only draw final node once
    const prevStageRef = useRef('idle');

    useEffect(() => {
        if (!workflowState) return;
        const { stage, agents = [], winnerID } = workflowState;
        const winnerId = winnerID;

        //  IDLE: full reset 
        if (stage === 'idle') {
            setNodes(INITIAL_NODES);
            setEdges([]);
            yMapRef.current = {};
            mergeDrawnRef.current = false;
            prevStageRef.current = 'idle';
            return;
        }

        //  BRANCHING: build agent nodes and record Y positions 
        if (stage === 'branching' && prevStageRef.current === 'idle') {
            prevStageRef.current = 'branching';
            mergeDrawnRef.current = false;
            yMapRef.current = {};

            const total = agents.length;
            const agentNodes = agents.map((agent) => {
                // Deterministic Y: sorted by agent id so order never changes between renders
                const sortedIds = [...agents].sort((a, b) => a.id.localeCompare(b.id)).map(a => a.id);
                const sortedIdx = sortedIds.indexOf(agent.id);
                const y = Y_CENTER + (sortedIdx - (total - 1) / 2) * Y_GAP;

                // Store in ref immediately — this is the single source of truth for Y
                yMapRef.current[agent.id] = y;

                return {
                    id: agent.id, type: 'agent',
                    position: { x: X_AGENTS, y },
                    data: {
                        label: `Agent ${agent.id.split('-')[1]}`,
                        status: agent.status,
                        strategy: agent.strategy,
                        timing: agent.timing,
                        isWinner: agent.id === winnerId,
                        hasResult: false,
                    },
                    ...nodeDefaults,
                };
            });

            const branchEdges = agents.map(a =>
                mkEdge(`e-main-${a.id}`, 'main-v1', a.id)
            );

            setNodes(nds => [...nds, ...agentNodes]);
            setTimeout(() => setEdges(branchEdges), 100);
            return;
        }

        //  EXECUTING / TESTING / RESULTS / MERGING: update statuses ─
        if (['executing', 'testing', 'results', 'merging'].includes(stage)) {
            prevStageRef.current = stage;

            // Update node data
            setNodes(nds => nds.map(node => {
                const agent = agents.find(a => a.id === node.id);
                if (!agent) return node;
                return {
                    ...node,
                    data: {
                        ...node.data,
                        status: agent.status,
                        timing: agent.timing,
                        exitCode: agent.exitCode,
                        isWinner: agent.id === winnerId,
                        hasResult: agent.status === 'success' || agent.status === 'failed',
                    },
                };
            }));

            // Colour edges once results are known
            if (stage === 'results' || stage === 'merging') {
                setEdges(eds => eds.map(edge => {
                    const agent = agents.find(a => a.id === edge.target);
                    if (!agent) return edge;
                    if (agent.status === 'failed') {
                        const prunedByTiebreaker = agent.exitCode === 0;
                        return mkEdge(edge.id, edge.source, edge.target, {
                            animated: false,
                            style: {
                                stroke: prunedByTiebreaker ? '#64748b' : '#ef4444',
                                strokeWidth: 1,
                                opacity: prunedByTiebreaker ? 0.35 : 0.4,
                            },
                            markerEnd: {
                                type: MarkerType.ArrowClosed,
                                color: prunedByTiebreaker ? '#64748b' : '#ef4444',
                            },
                        });
                    }
                    if (agent.status === 'success') return mkEdge(edge.id, edge.source, edge.target, {
                        style: { stroke: '#10b981', strokeWidth: 3 },
                        markerEnd: { type: MarkerType.ArrowClosed, color: '#10b981' },
                    });
                    return edge;
                }));
            }

            // Draw final merged node — only once, only in merging stage
            if (stage === 'merging' && !mergeDrawnRef.current && winnerId) {
                // KEY FIX: read Y from yMapRef (set at branching, never changes)
                // NOT from nodes state (which is stale in this closure)
                const winnerY = yMapRef.current[winnerId];

                if (winnerY !== undefined) {
                    mergeDrawnRef.current = true;

                    const finalNode = {
                        id: 'main-v1-1', type: 'agent',
                        position: { x: X_FINAL, y: winnerY },  // ← always correct Y
                        data: { label: 'Main (v1.1)', status: 'merged', strategy: 'Trunk' },
                        ...nodeDefaults,
                    };

                    const mergeEdge = mkEdge(`e-${winnerId}-final`, winnerId, 'main-v1-1', {
                        style: { stroke: '#10b981', strokeWidth: 4 },
                        markerEnd: { type: MarkerType.ArrowClosed, color: '#10b981' },
                    });

                    setNodes(nds => [...nds, finalNode]);
                    setTimeout(() => setEdges(eds => [...eds, mergeEdge]), 200);
                } else {
                    // yMapRef not populated yet (branching fired before this component mounted)
                    // Fallback: rebuild yMap from current nodes
                    const rebuilt = {};
                    nodes.forEach(n => {
                        if (agents.find(a => a.id === n.id)) {
                            rebuilt[n.id] = n.position.y;
                        }
                    });
                    const fallbackY = rebuilt[winnerId] ?? Y_CENTER;
                    mergeDrawnRef.current = true;

                    const finalNode = {
                        id: 'main-v1-1', type: 'agent',
                        position: { x: X_FINAL, y: fallbackY },
                        data: { label: 'Main (v1.1)', status: 'merged', strategy: 'Trunk' },
                        ...nodeDefaults,
                    };
                    const mergeEdge = mkEdge(`e-${winnerId}-final`, winnerId, 'main-v1-1', {
                        style: { stroke: '#10b981', strokeWidth: 4 },
                        markerEnd: { type: MarkerType.ArrowClosed, color: '#10b981' },
                    });
                    setNodes(nds => [...nds, finalNode]);
                    setTimeout(() => setEdges(eds => [...eds, mergeEdge]), 200);
                }
            }
        }
    }, [workflowState]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleNodeClick = useCallback((_, node) => {
        if (onNodeClick && node.data?.hasResult) onNodeClick(node.id);
    }, [onNodeClick]);

    const displayStage = workflowState?.stage === 'merging' && workflowState?.winnerID
        ? 'merged'
        : workflowState?.stage === 'results' && !workflowState?.winnerID
            ? 'no winner'
            : workflowState?.stage || 'idle';

    return (
        <div className="w-full h-full bg-[#0a0f1e] text-white">
            <ReactFlow
                nodes={nodes} edges={edges}
                onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
                nodeTypes={nodeTypes} onNodeClick={handleNodeClick}
                fitView className="font-sans" proOptions={{ hideAttribution: true }}
            >
                <Background color="#1e293b" gap={20} size={1} />

                <div className="absolute top-4 left-4 z-10 bg-slate-900/80 p-4 rounded-xl
                        border border-slate-700 backdrop-blur-sm shadow-xl">
                    <div className="flex items-center gap-2 mb-1">
                        <BrainCircuit className="w-6 h-6 text-sky-400" />
                        <h1 className="text-xl font-bold tracking-tighter">SplitMind</h1>
                    </div>
                    <p className="text-xs text-slate-400 max-w-[260px]">
                        Worktree swarms. Parallel strategies. Deterministic evals pick the winner.
                    </p>
                    <div className="mt-2 text-xs px-2 py-1 inline-block bg-slate-800
                          rounded-md border border-slate-700 font-mono">
                        Status:{' '}
                        <span className={
                            displayStage === 'idle'
                                ? 'text-slate-500'
                                : displayStage === 'no winner'
                                    ? 'text-red-400 uppercase font-bold'
                                    : displayStage === 'merged'
                                        ? 'text-emerald-400 uppercase font-bold'
                                    : 'text-sky-400 uppercase font-bold'
                        }>
                            {displayStage}
                        </span>
                    </div>
                    {(workflowState?.stage === 'results' || workflowState?.stage === 'merging') && (
                        <p className="text-[10px] text-slate-500 mt-1">
                            Click a node to view generated code
                        </p>
                    )}
                </div>
            </ReactFlow>
        </div>
    );
}
