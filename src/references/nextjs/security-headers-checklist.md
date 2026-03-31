# Security Headers Checklist for Next.js CMS Projects

## Recommended security headers

These should be configured in `next.config.js` `headers()` or middleware:

| Header | Value | Purpose |
|--------|-------|---------|
| `X-Frame-Options` | `SAMEORIGIN` | Prevents clickjacking (but allow CMS editing iframes) |
| `X-Content-Type-Options` | `nosniff` | Prevents MIME type sniffing |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Controls referrer information |
| `X-XSS-Protection` | `1; mode=block` | Legacy XSS protection |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` | Forces HTTPS |
| `Content-Security-Policy` | (project-specific) | Controls resource loading |

## CMS-specific security concerns

### X-Frame-Options and CMS editing
CMS editing UIs (Experience Editor, Visual Builder) load the rendering host in an iframe. Setting `X-Frame-Options: DENY` breaks editing. Use `SAMEORIGIN` or CSP `frame-ancestors` with the CMS domain.

### NEXT_PUBLIC_ variable audit
Any variable prefixed with `NEXT_PUBLIC_` is embedded in the client JavaScript bundle. Check that:
- No API secrets use this prefix
- No server-only configuration uses this prefix
- Public variables are truly safe to expose (public IDs, non-secret keys)

### API route protection
- Editing endpoints (`/api/editing/*`) should validate the editing secret
- Revalidation endpoints (`/api/revalidate`) should validate a revalidation token
- No API route should expose raw CMS credentials in its response

## What we flag

- **Critical**: Server secrets exposed via `NEXT_PUBLIC_*`
- **High**: Missing editing secret validation on editing endpoints
- **Medium**: No security headers configured
- **Low**: Missing CSP (complex to configure, but important for hardened deployments)
