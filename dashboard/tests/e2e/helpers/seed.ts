import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIXTURES_DIR = path.resolve(__dirname, '..', '..', 'fixtures');
const OUTPUT_RUNS_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'output', 'runs');

interface IndexEntry {
  id: string;
  goal: string;
  repoName: string;
  overallScore?: string;
  startedAt: string;
  completedAt?: string;
  findingsCount?: number;
  status: string;
}

export async function seed(): Promise<void> {
  // Read all fixture directories
  const fixtureDirs = fs.readdirSync(FIXTURES_DIR).filter((name) => {
    const fullPath = path.join(FIXTURES_DIR, name);
    return fs.statSync(fullPath).isDirectory() && name.startsWith('run-');
  });

  // Ensure output/runs/ exists
  fs.mkdirSync(OUTPUT_RUNS_DIR, { recursive: true });

  const fixtureEntries: IndexEntry[] = [];

  for (const fixtureDir of fixtureDirs) {
    const fixtureSourceDir = path.join(FIXTURES_DIR, fixtureDir);
    const envelopePath = path.join(fixtureSourceDir, 'envelope.json');

    if (!fs.existsSync(envelopePath)) continue;

    const envelope = JSON.parse(fs.readFileSync(envelopePath, 'utf-8'));
    const runId: string = envelope.id;
    const runOutputDir = path.join(OUTPUT_RUNS_DIR, runId);

    // Create run directory
    fs.mkdirSync(runOutputDir, { recursive: true });

    // Copy envelope.json
    fs.copyFileSync(envelopePath, path.join(runOutputDir, 'envelope.json'));

    // Copy findings.json if present
    const findingsPath = path.join(fixtureSourceDir, 'findings.json');
    if (fs.existsSync(findingsPath)) {
      fs.copyFileSync(findingsPath, path.join(runOutputDir, 'findings.json'));
    }

    // Copy events.jsonl if present
    const eventsPath = path.join(fixtureSourceDir, 'events.jsonl');
    if (fs.existsSync(eventsPath)) {
      fs.copyFileSync(eventsPath, path.join(runOutputDir, 'events.jsonl'));
    }

    // Build index entry from envelope
    const findings = fs.existsSync(findingsPath)
      ? JSON.parse(fs.readFileSync(findingsPath, 'utf-8'))
      : [];

    fixtureEntries.push({
      id: runId,
      goal: envelope.goal,
      repoName: envelope.repoName,
      overallScore: envelope.scorecard?.overallScore,
      startedAt: envelope.startedAt,
      completedAt: envelope.completedAt,
      findingsCount: findings.length,
      status: 'completed',
    });
  }

  // Merge fixture entries into existing index (don't overwrite real data)
  const indexPath = path.join(OUTPUT_RUNS_DIR, 'index.json');
  let existingEntries: IndexEntry[] = [];
  if (fs.existsSync(indexPath)) {
    try {
      existingEntries = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
      // Remove any stale fixture entries
      existingEntries = existingEntries.filter(
        (e) => !e.id.startsWith('fixture-'),
      );
    } catch {
      existingEntries = [];
    }
  }

  const mergedEntries = [...fixtureEntries, ...existingEntries];
  fs.writeFileSync(indexPath, JSON.stringify(mergedEntries, null, 2));

  console.log(
    `[seed] Seeded ${fixtureEntries.length} fixture run(s) to ${OUTPUT_RUNS_DIR}`,
  );
}

async function setup(): Promise<void> {
  await seed();
}

export default setup;
