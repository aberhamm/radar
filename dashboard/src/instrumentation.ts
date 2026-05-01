/**
 * Next.js instrumentation hook — runs once at server startup.
 * Loads .env from the repo root eagerly so env vars are available
 * before any API route is hit.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const path = await import('node:path');
    const dotenv = await import('dotenv');
    dotenv.config({ path: path.resolve(process.cwd(), '..', '.env') });
  }
}

export async function onRequestError() {
  // Required export — Next.js uses this for error reporting hooks.
}

/**
 * Pre-compile critical routes so the first browser load is instant.
 * Sequential to avoid webpack compile contention on Windows.
 */
async function warmup(port: number) {
  const routes = ['/api/session', '/api/repos', '/'];
  for (const r of routes) {
    await fetch(`http://localhost:${port}${r}`).catch(() => {});
  }
}

if (process.env.NEXT_RUNTIME === 'nodejs') {
  const port = parseInt(process.env.PORT ?? '3000', 10);
  setTimeout(() => warmup(port), 500);
}
