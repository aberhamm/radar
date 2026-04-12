# Web Application Best Practices Reference

## Security Essentials

### Secrets Management
- Never commit secrets to version control. Use environment variables or secrets managers.
- `.env` files should be in `.gitignore`. Provide `.env.example` with placeholder values.
- Client-side code must never contain server-side secrets. In Next.js, only `NEXT_PUBLIC_` prefixed vars are exposed. Other frameworks have similar conventions.
- Rotate credentials immediately if a secret is found in git history.

### HTTP Security Headers
Essential headers for any web application:
- `Strict-Transport-Security` (HSTS) — enforce HTTPS
- `Content-Security-Policy` (CSP) — prevent XSS and injection attacks
- `X-Content-Type-Options: nosniff` — prevent MIME sniffing
- `X-Frame-Options` or CSP `frame-ancestors` — prevent clickjacking
- `Referrer-Policy` — control referrer information leakage

### Authentication Patterns
- Session tokens should be HttpOnly, Secure, SameSite cookies. Not localStorage.
- API keys in client-side code are public. They should only grant read access to public data.
- OAuth/OIDC flows should use PKCE for SPAs and mobile apps.
- Rate limiting on auth endpoints prevents brute-force attacks.

### Input Validation
- Validate on the server. Client-side validation is UX, not security.
- Use parameterized queries. Never interpolate user input into SQL or GraphQL strings.
- Sanitize HTML content from user input or CMS fields before rendering.

## Architecture Patterns

### Separation of Concerns
- Business logic should not live in route handlers or UI components.
- Data access should be abstracted behind a service or repository layer.
- Configuration should be centralized, not scattered across files.

### API Design
- RESTful APIs should use proper HTTP methods and status codes.
- GraphQL APIs should have query depth limits and complexity analysis.
- API versioning strategy should be explicit (URL path, header, or query param).
- Error responses should be structured and consistent.

### State Management
- Server state and client state should be treated differently.
- Avoid prop drilling through many component layers. Use context or state management libraries where appropriate.
- Cache invalidation strategy should be explicit, not accidental.

### Performance
- Static content should be statically generated where possible.
- Images should be optimized and lazy-loaded.
- JavaScript bundles should be code-split by route.
- Database queries should be indexed and monitored for N+1 patterns.

## Dependency Management

### Version Currency
- Major version gaps in core framework packages indicate significant tech debt.
- Security patches should be applied within days, not weeks.
- Lock files (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `Gemfile.lock`, `poetry.lock`) should be committed and kept in sync.

### Supply Chain
- Pin dependencies to exact versions in production.
- Audit dependencies regularly (`npm audit`, `pip-audit`, `bundle audit`).
- Minimize dependency count. Each dependency is a trust decision.

## Testing Expectations

### Test Pyramid
- Unit tests for business logic and utilities.
- Integration tests for API endpoints and data access.
- E2E tests for critical user paths (login, checkout, data submission).

### Coverage
- 0% coverage is a red finding. Any project in production should have some tests.
- 80%+ line coverage is a goal, not a requirement. Focus on testing behavior, not lines.
- Missing tests for authentication, payment, and data mutation are high-severity findings.

## Deployment & Operations

### CI/CD
- Automated builds on every push to main/master.
- Automated tests before merge.
- Environment-specific configuration (dev, staging, production) should be explicit.

### Monitoring
- Application error tracking (Sentry, Datadog, etc.) should be configured.
- Health check endpoints for load balancers.
- Structured logging for production debugging.

### Environment Strategy
- Development, staging, and production environments should be documented.
- Database migrations should be automated and reversible.
- Feature flags for gradual rollouts of significant changes.

## Documentation

### README
- Should explain: what the project does, how to set it up locally, how to run tests, how to deploy.
- Tech stack should be listed explicitly.
- Environment variable documentation with descriptions (not just names).

### Code Documentation
- Complex business logic should have comments explaining WHY, not WHAT.
- API endpoints should have request/response documentation.
- Architecture decisions should be recorded (ADRs or equivalent).
