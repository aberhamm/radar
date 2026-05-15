# Sitecore XP Migration Readiness

Assessment criteria for evaluating migration complexity from Sitecore XP (10.x) to XM Cloud, headless XP/XM, or SitecoreAI.

## Target state options

Three migration paths exist for XP customers:

1. **XM Cloud (SaaS)** — Sitecore's recommended path. Headless, managed infrastructure, JSS-based rendering. Requires complete re-platform of the rendering tier.
2. **Headless XP/XM (self-hosted)** — Keep on-prem but adopt headless rendering (JSS + Next.js). Less disruptive than XM Cloud but still requires rendering tier rewrite.
3. **SitecoreAI** — Emerging option. Migration path not yet fully documented. Evaluate readiness but note uncertainty.

## Platform support and licensing

- XP 10.2 mainstream support ended late 2024. Now in extended/sustaining support (limited hotfixes, security patches best-effort only).
- XP 10.3 extended mainstream support. Check exact end date per license agreement.
- XP 10.4 is the last XP release. No further XP versions planned.
- Migration timeline is often contractually driven by support end dates, not just technical readiness.

**Assessment items:**
- Document current license type (perpetual vs subscription) and support tier
- Identify contractual deadline for platform migration
- Note whether current hotfix level is current or behind

## Capabilities without XM Cloud equivalents

These XP features have no direct replacement in XM Cloud. Each requires a third-party substitute or custom solution:

| XP Feature | XM Cloud Status | Typical Replacement |
|-----------|----------------|-------------------|
| xDB (contact tracking, behavioral data) | Not available | Sitecore CDP, Segment, or custom analytics |
| xConnect (contact data APIs) | Not available | CDP APIs or custom integration layer |
| EXM (Email Experience Manager) | Not available | Sitecore Send, Braze, Mailchimp, etc. |
| Marketing Automation | Not available | Sitecore Personalize, HubSpot, Marketo |
| Sitecore Forms (with xDB storage) | Partial (Sitecore Forms exists but no xDB) | Forms with external submission handling |
| Custom pipeline processors | Not available | Middleware, webhooks, or edge functions |
| Scheduled agents | Not available | External scheduler (Azure Functions, cron) |
| Custom Solr indexes | Not available (uses built-in search) | External search (Algolia, Coveo, Solr standalone) |

**Assessment items:**
- Inventory which of these features are actively used (not just installed)
- For each used feature, assess data volume and complexity
- Identify which third-party replacements are already in evaluation

## Custom code inventory

XP allows deep server-side customization that must be inventoried and classified:

### Pipeline processors
- `httpRequestBegin` — URL rewriting, redirects, authentication
- `renderRendering` — custom rendering logic
- `publishItem` — publish-time validation or transformation
- `indexing` — custom computed fields, index configuration
- Custom pipelines (project-specific)

### Event handlers
- `item:saved`, `item:created`, `item:deleted` — content lifecycle hooks
- `publish:end` — post-publish automation
- Custom events

### Scheduled agents
- Content synchronization jobs
- Cache warming
- External system polling
- Data cleanup/archival

**Assessment items:**
- Count and classify all custom processors by pipeline
- Identify which processors implement business logic vs infrastructure concerns
- Map each custom processor to its migration path (webhook, middleware, external service, or eliminate)
- Flag processors with external system dependencies

## Content and data migration

### Content tree
- Total item count and tree depth
- Content types and template count
- Language versions (each language version multiplies migration effort)
- Workflow states per item (only published items migrate, but workflow definitions need recreation)

### Bilingual/multilingual content
- Language fallback configuration (shared fields vs language-specific)
- Translation workflow maturity (manual, workflow-driven, integrated with TMS)
- Shared content items vs forked-per-language items
- URL structure per language (prefix, domain, subfolder)

### xDB contact data
- Whether xDB is actively collecting (check xDB configuration and xConnect status)
- Volume of contact records
- Custom contact facets defined
- Whether personalization rules reference xDB data
- Data retention policies and privacy compliance (PIPEDA, GDPR, Law 25)
- Consent mechanisms and deletion capabilities
- Plan for data during migration (archive, migrate to CDP, or discard)

**Assessment items:**
- Document content volume per language
- Identify shared vs forked content strategy
- Assess xDB data collection status and volume
- Map privacy/compliance requirements for contact data

## Integration complexity

### Connection patterns
- API integrations via custom handlers (most common in XP)
- Sitecore Connect / Data Exchange Framework usage
- Direct database connections from custom code
- File-based integrations (SFTP drops, file watchers)

### Integration inventory items
- Each integration's authentication method
- Data flow direction (inbound to Sitecore, outbound, bidirectional)
- Frequency (real-time, scheduled, event-driven)
- Whether the integration depends on xConnect or custom pipelines

**Assessment items:**
- Map each integration to its connection pattern
- Identify which integrations depend on XP-only features (pipelines, xConnect)
- Assess whether each integration can survive a rendering-tier-only migration or requires backend changes

## Infrastructure considerations

### Current topology
- Number of CD/CM roles and their configuration
- Session state management (InProc, shared database, Redis)
- Load balancing and CDN configuration
- Solr topology (standalone, SolrCloud, Azure Search)

### Deployment patterns
- SIF/SIA scripts for installation
- CI/CD pipeline configuration
- Environment parity (dev/test/staging/prod)
- Container usage (Docker, Kubernetes) vs IIS-on-VM

**Assessment items:**
- Document current topology (diagram preferred)
- Identify deployment automation maturity
- Assess whether infrastructure team has cloud-native experience

## Migration complexity scoring

Use these heuristics to classify overall migration complexity:

| Factor | Low | Medium | High |
|--------|-----|--------|------|
| Custom processors | 0-5 | 6-20 | 20+ |
| xDB usage | Not collecting | Collecting, no personalization rules | Active personalization from xDB |
| Languages | 1 | 2-3 | 4+ |
| EXM usage | Not installed | Installed, low volume | Active campaigns, complex templates |
| Integration count | 0-3 | 4-8 | 9+ |
| Content items | <10k | 10k-100k | 100k+ |
| Custom Solr indexes | 0 | 1-2 | 3+ |
