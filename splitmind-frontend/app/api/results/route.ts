/**
 * api/results/route.ts
 *
 * Serves the .splitmind_results.json file written by the Python orchestrator
 * after all agents finish. Returns {} if the file doesn't exist yet.
 * The dashboard polls this during 'results' and 'merging' stages
 * to populate the code diff modal.
 */

import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const RESULT_CANDIDATES = [
  process.env.SPLITMIND_RESULT_DIR,
  process.cwd(),
  path.resolve(process.cwd(), '..'),
].filter(Boolean).map(dir => path.join(dir as string, '.splitmind_results.json'));

export async function GET() {
  try {
    const resultsFile = RESULT_CANDIDATES.find(file => fs.existsSync(file));
    if (!resultsFile) {
      return NextResponse.json({});
    }
    const data = fs.readFileSync(resultsFile, 'utf-8');
    return NextResponse.json(JSON.parse(data));
  } catch (error) {
    console.error('[api/results] Failed to read results file:', error);
    return NextResponse.json({});
  }
}
