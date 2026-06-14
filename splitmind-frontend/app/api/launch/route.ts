/**
 * api/launch/route.ts
 *
 * Fires the Python orchestrator as a background process.
 * Returns immediately (fire-and-forget) — the Python script
 * updates state.json on its own timeline.
 *
 * SETUP: Set SPLITMIND_SCRIPT_DIR in your .env.local to the absolute path
 * of the folder containing splitmind_orchestrator.py, e.g.:
 *   SPLITMIND_SCRIPT_DIR=C:\Users\you\projects\ecommerce_demo
 * or on Mac/Linux:
 *   SPLITMIND_SCRIPT_DIR=/Users/you/projects/ecommerce_demo
 *
 * If not set, falls back to the Next.js project root.
 */

import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

const SCRIPT_DIR = process.env.SPLITMIND_SCRIPT_DIR || process.cwd();
const SCRIPT_PATH = path.join(SCRIPT_DIR, 'splitmind_orchestrator.py');

const PYTHON_BIN = process.env.PYTHON_BIN || 'python';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const task: string = (body.task || '').trim();

    if (!task) {
      return NextResponse.json({ success: false, error: 'No task provided' }, { status: 400 });
    }

    // Verify the script actually exists — fail fast with a clear message
    if (!fs.existsSync(SCRIPT_PATH)) {
      const msg = `[api/launch] Script not found at: ${SCRIPT_PATH}\n` +
        `Set SPLITMIND_SCRIPT_DIR in .env.local to fix this.`;
      console.error(msg);
      return NextResponse.json({ success: false, error: msg }, { status: 500 });
    }

    console.log(`[api/launch] Starting swarm`);
    console.log(`[api/launch]   script : ${SCRIPT_PATH}`);
    console.log(`[api/launch]   python : ${PYTHON_BIN}`);
    console.log(`[api/launch]   task   : ${task}`);
    console.log(`[api/launch]   cwd    : ${SCRIPT_DIR}`);

    // Use spawn() with args as an array — no shell escaping issues, works on Windows
    const child = spawn(
      // PYTHON_BIN,
      // [SCRIPT_PATH, '--task', task],
      // We wrap the path in quotes so Windows doesn't break at the space
      PYTHON_BIN,
      [SCRIPT_PATH, '--task', task],
      {
        cwd: SCRIPT_DIR,   // Python's os.getcwd() must be the repo root
        detached: true,         // Let it outlive the HTTP response
        stdio: 'pipe',       // Capture output so we can log it
        windowsHide: true
      }
    );

    // Stream Python stdout/stderr to Next.js console for easy debugging
    child.stdout?.on('data', (data: Buffer) => {
      process.stdout.write(`[python] ${data}`);
    });
    child.stderr?.on('data', (data: Buffer) => {
      process.stderr.write(`[python ERR] ${data}`);
    });
    child.on('error', (err: Error) => {
      console.error(`[api/launch] Spawn error: ${err.message}`);
      console.error(`  → Make sure '${PYTHON_BIN}' is in your PATH, or set PYTHON_BIN in .env.local`);
    });
    child.on('close', (code: number) => {
      console.log(`[api/launch] Python process exited with code ${code}`);
    });

    child.unref();

    return NextResponse.json({ success: true, message: 'Swarm launched', task });

  } catch (error) {
    console.error('[api/launch] Unexpected error:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
