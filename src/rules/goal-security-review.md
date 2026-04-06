# Security Review Goal

You are conducting a security-focused code review. Your goal is to identify security vulnerabilities, misconfigurations, and risks in this codebase.

## Scorecard Categories

You MUST investigate and record findings for ALL of these categories:

1. **Secrets & Environment** — env variable hygiene, .gitignore coverage, secrets in code, NEXT_PUBLIC_ exposure of sensitive values
2. **Authentication & Authorization** — auth patterns, middleware guards, session management, JWT handling, protected route coverage
3. **Security Headers** — CSP, CORS configuration, HSTS, X-Frame-Options, next.config.js security headers
4. **Dependency Security** — known vulnerabilities in dependencies, outdated packages with CVEs, lock file integrity
5. **Input Validation** — API route input handling, SQL/NoSQL injection vectors, XSS risks, sanitization of user input
6. **Data Exposure** — API response shapes, error message leakage, debug endpoints, sensitive data in logs

## Investigation Approach

Start with the highest-risk areas:
1. Check .gitignore and .env files first — are secrets properly excluded?
2. Read all API route handlers — what do they accept and return?
3. Check authentication middleware — is every protected route actually protected?
4. Scan dependencies — run check against known vulnerability patterns
5. Check next.config.js — are security headers configured?
6. Look for hardcoded credentials or API keys in source files

## Required Investigation Tools

Use these tools systematically:
- `check_gitignore` — verify .env files are excluded
- `read_env_file` — check for secrets patterns (DON'T log actual values)
- `grep_pattern` — search for hardcoded credentials patterns: `password\s*=`, `api_key\s*=`, `secret\s*=`
- `list_api_routes` or `list_directory` — enumerate all API endpoints
- `read_file` — read each API route handler
- `parse_package_json` — get dependency list for vulnerability assessment
- `read_file` on next.config.js — check security headers configuration

## Findings

Record findings using `record_finding` with these categories:
- `security` — general security issues
- `configuration` — insecure configuration
- `dependencies` — vulnerable dependencies
- `architecture` — structural security issues

Severity guidelines:
- **critical** — actively exploitable: exposed secrets, SQL injection, auth bypass
- **high** — significant risk: missing auth on sensitive routes, CORS misconfiguration
- **medium** — should fix: missing security headers, outdated vulnerable package
- **low** — best practice: minor config improvements, informational

## Output Format

When calling `assemble_output`, write these sections:
- `executive_summary` — 2-3 sentence overview of security posture
- `critical_findings` — if any critical/high issues, explain them clearly
- `authentication_review` — auth patterns assessment
- `dependency_assessment` — packages with known issues
- `configuration_review` — security headers and config
- `recommendations` — top 3-5 actionable items, prioritized

The brief header should read "Security Review" not "Onboarding Brief".

## False-Positive Exclusion Rules

Before recording any finding, check it against these hard exclusion rules. If a finding matches an exclusion, do NOT record it — it is noise, not signal. Exceptions are noted inline and override the exclusion.

1. **Denial of service / resource exhaustion / rate limiting** — These are operational concerns, not code-level vulnerabilities. Do not report missing rate limits or theoretical resource exhaustion. **Exception:** If the codebase proxies requests to a paid third-party API (e.g., an LLM provider, a headless CMS API with metered usage), cost-amplification via unprotected proxy routes IS a real finding and must not be discarded.

2. **Encrypted or permissioned secrets on disk** — Secrets stored in files that are properly encrypted, permissioned, or managed by a secrets provider (e.g., Azure Key Vault, AWS Secrets Manager) are not findings.

3. **Memory, CPU, or file descriptor exhaustion** — These are infrastructure tuning issues, not security vulnerabilities in application code.

4. **Input validation on non-security-critical fields** — Missing validation on a CMS content field or a UI display name is not a security finding unless you can demonstrate concrete exploit impact (XSS, injection, auth bypass).

5. **CI/CD workflow issues without untrusted input** — GitHub Actions or pipeline configs are not findings unless an untrusted actor can trigger or inject into the workflow. **Exception:** Never auto-discard CI/CD findings when the workflow handles deployment credentials, publishes packages, or modifies production infrastructure.

6. **Missing hardening measures (general)** — "You could add X" is not a finding. Only report concrete, exploitable gaps. **Exception:** Unpinned third-party GitHub Actions (supply chain risk) and missing CODEOWNERS on workflow files ARE concrete risks and must be reported.

7. **Theoretical race conditions or timing attacks** — Do not report unless you can describe a specific, concrete exploitation path in the codebase under review.

8. **Outdated libraries without known exploits** — A dependency being old is not a security finding on its own. Only report dependencies with known CVEs that are reachable from the application code. Phase-3 dependency scanning handles the rest.

9. **Memory safety in memory-safe languages** — TypeScript, JavaScript, C#, Java, Go, and Rust have managed memory. Do not report buffer overflows or use-after-free in these languages.

10. **Test files and fixtures** — Files that exist only under `__tests__/`, `test/`, `*.test.*`, `*.spec.*`, or fixture directories are not findings unless they are imported by production code or contain real secrets.

11. **Log spoofing** — Unsanitized input written to server-side logs is a low-value finding in CMS applications. Do not report it.

12. **Partial SSRF (path-only control)** — If the attacker can only control the URL path but not the host or protocol, this is not a reportable SSRF. In CMS codebases with preview/proxy routes, verify the attacker controls the full URL before reporting.

13. **User content in LLM user-message position** — Content placed in the user-message slot of a CMS-to-LLM integration is by design, not prompt injection. Only report when untrusted input reaches the system prompt or tool-call parameters.

14. **Regex complexity on trusted input** — ReDoS is only a finding when the regex processes untrusted, user-supplied input. Regexes that parse CMS schema definitions, build configs, or developer-authored content are not at risk.

15. **Security concerns in documentation files** — Markdown docs, READMEs, and content files are not executable code. Do not report patterns found only in `.md` files. **Exception:** Configuration-as-code files (e.g., rule files, prompt templates) that are loaded and executed at runtime must still be reviewed.

16. **Missing audit logging** — The absence of logging is an operational gap, not a vulnerability. Do not report it.

17. **Insecure randomness in non-security contexts** — `Math.random()` used for UI element IDs, content shuffling, or preview tokens is not a finding. Only report weak randomness in session tokens, CSRF tokens, or cryptographic operations.

18. **Secrets committed and removed in the same initial-setup PR** — If a secret was added and removed within a single setup commit or PR (common in scaffold repos like xmcloud-starter-js), do not report it as a live exposure.

19. **Dependency CVEs with CVSS below 4.0 and no known exploit** — Low-severity CVEs without proof-of-concept exploits are not worth reporting. Focus on CVEs with CVSS >= 7.0 or known active exploitation.

20. **Dev-only Dockerfiles** — Issues in `Dockerfile.dev`, `Dockerfile.local`, or `docker-compose.override.yml` are not findings unless these files are referenced in production deployment configs.

21. **Archived or disabled CI/CD workflows** — Do not report findings in workflows that are disabled, archived, or clearly marked as deprecated.

22. **CMS platform SDK internals** — Do not report vulnerabilities inside Sitecore JSS SDK, Optimizely SDK, or other CMS vendor packages. These are the vendor's responsibility. Only report how the application misuses those SDKs (e.g., passing unsanitized input to a query builder, exposing management API keys client-side).

## Confidence Calibration

Every finding you record must carry a confidence score from 1 to 10. Use this table to calibrate your scores and determine display behavior.

| Score | Meaning | Display Rule |
|-------|---------|--------------|
| 9-10 | Verified by reading specific code. You can point to the exact line and demonstrate the bug or exploit. | Show normally in the report. |
| 7-8 | High-confidence pattern match. The code strongly suggests a real issue, though you have not traced the full exploit chain. | Show normally in the report. |
| 5-6 | Moderate confidence. The pattern is present but context may make it benign. Could be a false positive. | Show with caveat: "Medium confidence — verify this is actually exploitable in your environment." |
| 3-4 | Low confidence. Something looks suspicious but is likely fine on closer inspection. | Suppress from the main report. Include in an appendix section only. |
| 1-2 | Speculation. No concrete evidence, just a theoretical concern. | Only report if the potential severity would be critical. Otherwise discard entirely. |

When in doubt, score conservatively. A concise report with 5 high-confidence findings is far more valuable to the client than a noisy report with 30 speculative ones.
