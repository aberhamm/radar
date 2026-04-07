# Prisma Specialist Checklist

When investigating a project that uses Prisma, check each of the following areas systematically. Record findings with evidence for every item that applies.

## Schema and Migration State

- Check for pending migrations in `prisma/migrations/` — are there migration files that have not been applied?
- Look for schema drift: differences between `prisma/schema.prisma` and what the migration history represents. Run `prisma migrate status` conceptually by comparing the latest migration SQL against the current schema.
- Verify that `prisma generate` output is not committed to version control (check `.gitignore` for `node_modules/.prisma`).

## Relation Loading Patterns

- Check for excessive use of `include` that pulls in deeply nested relations — this over-fetches data and can cause performance issues.
- Look for queries that should use `select` to pick specific fields instead of returning entire models.
- Verify that relation loading is intentional — accidental `include: { posts: true }` on a user query can load thousands of records.

## Raw Query Usage

- Search for `$queryRaw`, `$executeRaw`, `$queryRawUnsafe`, `$executeRawUnsafe` usage. The `Unsafe` variants accept string interpolation and are SQL injection risks.
- If raw queries are used, verify that they use parameterized templates (`$queryRaw\`SELECT ... WHERE id = ${id}\``) not string concatenation.
- Check whether raw queries are necessary or if the Prisma Client API could handle the same operation safely.

## Connection Pooling

- Check the `DATABASE_URL` connection string for pooling parameters (`pgbouncer=true`, `connection_limit`).
- For serverless deployments (Vercel, AWS Lambda), verify that connection pooling is configured — without it, each function invocation opens a new connection.
- Look for Prisma Accelerate or external poolers (PgBouncer, Neon pooler) in the configuration.

## Transaction Patterns

- Check for interactive transactions (`prisma.$transaction(async (tx) => { ... })`) and verify they have reasonable timeouts configured.
- Look for sequential transactions (`prisma.$transaction([query1, query2])`) that could be interactive transactions for better error handling.
- Verify that long-running operations inside transactions don't hold locks excessively.

## Soft Deletes and Middleware

- Check for Prisma middleware or client extensions that implement soft deletes (`deletedAt` field filtering).
- If soft deletes are used, verify that all queries consistently filter out deleted records — missing filters cause data leaks.
- Look for deprecated middleware patterns that should be migrated to Prisma client extensions (Prisma 4.16+).
