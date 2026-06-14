/**
 * api/state/route.ts
 *
 * WHY FILE-BASED (not in-memory global):
 * Next.js runs each API route in its own module scope.
 * A `let globalState = {}` in this file is NOT shared with the POST handler
 * when Python writes to it — they are different module instances.
 * Writing to state.json on disk is the only reliable local bridge.
 *
 * Place state.json in your Next.js project root (same level as package.json).
 */

import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// Always resolve relative to the Next.js project root
const STATE_FILE = path.resolve(process.cwd(), 'state.json');

const DEFAULT_STATE = {
  stage: 'idle',
  task: '',
  agents: [
    { id: 'sm-refactor', strategy: 'Locale Validation Layer',  status: 'idle', timing: null, exitCode: null },
    { id: 'sm-patch',    strategy: 'Guard Clause Fix',         status: 'idle', timing: null, exitCode: null },
    { id: 'sm-tdd',      strategy: 'Contract-First Rewrite',   status: 'idle', timing: null, exitCode: null },
  ],
};

function readState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return DEFAULT_STATE;
    const raw = fs.readFileSync(STATE_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return DEFAULT_STATE;
  }
}

function writeState(data: object) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

export async function GET() {
  const state = readState();
  return NextResponse.json(state);
}

export async function POST(request: Request) {
  try {
    const data = await request.json();
    writeState(data);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[api/state POST] Failed to write state:', error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}