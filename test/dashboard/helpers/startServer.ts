/**
 * Helper to start and stop the Next.js dev server for integration tests.
 *
 * Strategy:
 * 1. If TEST_BASE_URL env var is set, use that directly (for CI or pre-started servers)
 * 2. Otherwise, try to connect to an existing dev server on the target port
 * 3. If no server is found, spawn `next dev --port <port>` and wait for "Ready"
 *
 * Next.js 16 only allows one dev server per project directory, so if a dev server
 * is already running (e.g. on port 3000), we reuse it rather than fighting the lock.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ServerHandle {
  port: number;
  baseUrl: string;
  kill: () => void;
}

// Resolve from import.meta.url for ESM compatibility (Vitest runs as ESM)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DASHBOARD_DIR = path.resolve(__dirname, '..', '..', '..', 'dashboard');
const STARTUP_TIMEOUT_MS = 60_000;

/**
 * Check if a server is already responding on the given URL.
 */
async function isServerReady(baseUrl: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${baseUrl}/api/health`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Wait for a server to become ready, polling every 500ms.
 */
async function waitForServer(baseUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isServerReady(baseUrl)) return;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`Server at ${baseUrl} did not become ready within ${timeoutMs}ms`);
}

/**
 * Start or connect to the Next.js dev server.
 * Returns a handle with the base URL and a kill function.
 *
 * - If TEST_BASE_URL is set, uses that (no process to kill).
 * - If a server is already running on the default port (3000), reuses it.
 * - Otherwise spawns a new server on the given port.
 */
export async function startServer(port: number): Promise<ServerHandle> {
  // Option 1: Explicit base URL from environment
  const envUrl = process.env.TEST_BASE_URL;
  if (envUrl) {
    await waitForServer(envUrl, 10_000);
    const parsedPort = new URL(envUrl).port ? parseInt(new URL(envUrl).port) : 80;
    return { port: parsedPort, baseUrl: envUrl, kill: () => {} };
  }

  // Option 2: Check if an existing dev server is running (common ports)
  // Use 127.0.0.1 for detection to avoid IPv6 resolution issues on Windows
  const candidatePorts = [port, 3000, 3001];
  for (const candidatePort of candidatePorts) {
    const candidateUrl = `http://127.0.0.1:${candidatePort}`;
    if (await isServerReady(candidateUrl)) {
      return { port: candidatePort, baseUrl: `http://localhost:${candidatePort}`, kill: () => {} };
    }
  }

  // Option 3: Start a new server
  // First, remove any stale Next.js 16 dev lock file that would prevent starting.
  // Next.js 16 stores the lock at `.next/dev/lock` with PID + port info.
  // If the process in the lock is dead, the lock is stale and we can safely remove it.
  const lockFile = path.join(DASHBOARD_DIR, '.next', 'dev', 'lock');
  try {
    const fs = await import('node:fs');
    if (fs.existsSync(lockFile)) {
      const lockContent = JSON.parse(fs.readFileSync(lockFile, 'utf-8'));
      const lockPid = lockContent.pid;
      // Check if the lock holder process is still alive
      let isAlive = false;
      try {
        process.kill(lockPid, 0); // Signal 0 = just check if process exists
        isAlive = true;
      } catch {
        isAlive = false;
      }
      if (!isAlive) {
        fs.unlinkSync(lockFile);
      }
    }
  } catch {
    // Best effort — lock cleanup is optional
  }

  const nextBin = path.join(DASHBOARD_DIR, 'node_modules', '.bin', 'next');
  const baseUrl = `http://localhost:${port}`;

  const child: ChildProcess = spawn(
    process.platform === 'win32' ? `${nextBin}.cmd` : nextBin,
    ['dev', '--webpack', '--port', String(port)],
    {
      cwd: DASHBOARD_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PORT: String(port),
        NODE_ENV: 'development',
      },
      shell: process.platform === 'win32',
    },
  );

  const killFn = () => {
    try {
      if (process.platform === 'win32') {
        // Use cmd /c to avoid Git Bash mangling /pid → C:/Program Files/Git/pid
        spawn('cmd', ['/c', `taskkill /PID ${child.pid} /F /T`], { stdio: 'ignore' });
      } else {
        child.kill('SIGTERM');
      }
    } catch {
      // Process may have already exited
    }
  };

  return new Promise<ServerHandle>((resolve, reject) => {
    const timeout = setTimeout(() => {
      killFn();
      reject(new Error(`Next.js dev server failed to start within ${STARTUP_TIMEOUT_MS}ms`));
    }, STARTUP_TIMEOUT_MS);

    let stdout = '';
    let stderr = '';
    let resolved = false;

    const finishResolve = async () => {
      if (resolved) return;
      try {
        await waitForServer(baseUrl, 15_000);
        resolved = true;
        clearTimeout(timeout);
        resolve({ port, baseUrl, kill: killFn });
      } catch {
        // If fetch-based check fails but Next.js said "Ready", resolve anyway
        resolved = true;
        clearTimeout(timeout);
        resolve({ port, baseUrl, kill: killFn });
      }
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      if (text.includes('Ready') || text.includes(`localhost:${port}`)) {
        finishResolve();
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      if (!resolved) {
        clearTimeout(timeout);
        reject(new Error(`Failed to spawn Next.js dev server: ${err.message}`));
      }
    });

    child.on('exit', (code) => {
      if (!resolved) {
        clearTimeout(timeout);
        if (code !== null && code !== 0) {
          reject(new Error(
            `Next.js dev server exited with code ${code}\nstdout: ${stdout}\nstderr: ${stderr}`,
          ));
        }
      }
    });
  });
}
