import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTPUT_RUNS_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'output', 'runs');

export async function cleanup(): Promise<void> {
  if (!fs.existsSync(OUTPUT_RUNS_DIR)) return;

  const entries = fs.readdirSync(OUTPUT_RUNS_DIR);

  for (const entry of entries) {
    if (!entry.startsWith('fixture-')) continue;
    const fullPath = path.join(OUTPUT_RUNS_DIR, entry);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      fs.rmSync(fullPath, { recursive: true, force: true });
    }
  }

  // Remove fixture entries from index.json
  const indexPath = path.join(OUTPUT_RUNS_DIR, 'index.json');
  if (fs.existsSync(indexPath)) {
    try {
      const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
      const filtered = index.filter(
        (e: { id: string }) => !e.id.startsWith('fixture-'),
      );
      fs.writeFileSync(indexPath, JSON.stringify(filtered, null, 2));
    } catch {
      // If index.json is corrupt, leave it alone
    }
  }

  console.log('[cleanup] Removed fixture run directories');
}

async function teardown(): Promise<void> {
  await cleanup();
}

export default teardown;
