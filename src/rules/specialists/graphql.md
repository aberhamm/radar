# GraphQL Specialist Checklist

When investigating a project that uses GraphQL, check each of the following areas systematically. Record findings with evidence for every item that applies.

## Schema and Type Generation

- Check for a GraphQL codegen setup (`codegen.ts`, `codegen.yml`, `.graphqlrc`). If absent, types are likely hand-written and may drift from the schema.
- If codegen is present, verify the generated output is not stale — check whether generated files are committed and whether a generate script exists in `package.json`.
- Look for `any` or loose typing on query results that bypasses the type safety codegen provides.

## Query Complexity and Depth

- Check whether the server (or API gateway) enforces query depth limits or cost analysis. Without limits, a deeply nested query can cause expensive resolution.
- Look for queries that request deeply nested relations without pagination — these can return unbounded data.
- If using a public-facing GraphQL endpoint, verify that introspection is disabled in production.

## N+1 Resolution Patterns

- Check for dataloaders or batching utilities (`dataloader`, `@graphql-tools/batch-execute`). Without them, resolver chains often produce N+1 database queries.
- If the project is a client consuming a GraphQL API, check whether queries are structured to fetch related data in a single request rather than chaining multiple queries.

## Fragment Usage

- Look for queries that fetch full objects when only a few fields are needed — over-fetching wastes bandwidth and can leak sensitive fields.
- Check whether GraphQL fragments are used to share field selections across related queries. Duplicated field lists are a maintenance risk.
- Verify that fragment types match the target type — mismatched fragments silently return null fields.

## Error Handling

- Check how GraphQL errors are handled on the client. GraphQL responses return 200 even on errors — are `errors` in the response body inspected?
- Look for swallowed errors: `catch` blocks that log but don't surface GraphQL-specific error details (extensions, path, locations).
- Verify that partial data responses (data + errors) are handled correctly, not treated as full successes.

## Persisted Queries

- Check whether persisted queries or automatic persisted queries (APQ) are configured for production. They reduce payload size and prevent arbitrary query execution.
- If not using persisted queries, verify that query allowlisting or depth limiting is in place to mitigate abuse.
