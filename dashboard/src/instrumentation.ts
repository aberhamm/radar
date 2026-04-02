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
