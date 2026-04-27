# How to set up the repo and start building with Claude Code

## 1. Create the repo

```bash
mkdir repo-audit-delivery-agent
cd repo-audit-delivery-agent
git init
```

## 2. Add the files

Your repo needs these files to start:

```
repo-audit-delivery-agent/
├── CLAUDE.md                  # Instructions for Claude Code
├── .env.example               # Required environment variables
└── docs/
    └── spec.md                # The implementation spec
```

Copy the spec file:

```bash
mkdir docs
# Move or copy repo-audit-delivery-agent-spec-v2.md to docs/spec.md
cp /path/to/repo-audit-delivery-agent-spec-v2.md docs/spec.md
```

Copy the CLAUDE.md file to the repo root:

```bash
cp /path/to/CLAUDE.md ./CLAUDE.md
```

Create the `.env.example`:

```bash
cat > .env.example << 'EOF'
# Portkey AI Gateway (routes to Amazon Bedrock)
PORTKEY_API_KEY=your-portkey-api-key
PORTKEY_VIRTUAL_KEY=your-bedrock-virtual-key
EOF
```

Add `.env` to `.gitignore`:

```bash
echo ".env" >> .gitignore
echo ".env.local" >> .gitignore
```

Commit:

```bash
git add .
git commit -m "Initial spec and CLAUDE.md"
```

## 3. Set up Portkey + Bedrock

Before running anything, you need the LLM provider configured:

1. **Portkey account**: Go to [portkey.ai](https://portkey.ai), sign up, grab your API key from the dashboard
2. **Virtual key**: In the Portkey dashboard → Virtual Keys → Create → Select "Bedrock" as provider → Enter your AWS Access Key ID, Secret Access Key, and Region (e.g. `us-east-1`)
3. **Bedrock model access**: In AWS Console → Bedrock → Model access → Make sure Claude Sonnet is enabled in your region
4. **Local env**: Copy `.env.example` to `.env` and fill in your keys:

```bash
cp .env.example .env
# Edit .env with your actual keys
```

## 4. Open Claude Code

```bash
claude
```

Claude Code automatically reads CLAUDE.md on startup. It will know:

- what the project is
- where the spec lives
- what order to build in
- what architectural rules to follow

## 5. Start with Phase 1

Give Claude Code a focused starting prompt. Don't say "build the whole thing." Start with:

```
Read docs/spec.md completely. Then start Phase 1: set up the project
structure (package.json, tsconfig, directory layout from section 8 of
the spec). Include portkey-ai as a dependency. Then implement the
first set of tools — the repo tools: clone_repo, list_directory,
read_file, and read_files_batch. Include unit tests with fixture repos.
```

## 6. Continue phase by phase

After Phase 1 tools are working and tested:

```
Continue with Phase 1: implement the search tools (grep_pattern,
find_files), then the config parsing tools (parse_package_json,
parse_next_config, parse_tsconfig, parse_env_file, check_gitignore).
Unit test each one.
```

Then:

```
Continue with Phase 1: implement the dependency tools
(query_npm_versions, compare_versions, cache), the analysis tools,
and the web tools (web_search, fetch_url). Unit test each one.
```

Then Phase 2:

```
Start Phase 2: write the consulting rule markdown files (core.md,
platform-sitecore.md, platform-optimizely.md, goal-onboarding.md,
goal-audit.md, goal-migration.md) based on section 5 of the spec.
Then implement the rule loader and system prompt assembler.
```

And so on through Phases 3 and 4.

## Tips

- **Keep prompts focused on one sub-phase at a time.** Claude Code works best when it can complete a coherent chunk and test it.
- **Run tests between prompts.** Make sure each set of tools passes before moving on.
- **The spec is the source of truth.** If Claude Code asks a design question, tell it to check the spec first.
- **Commit after each phase.** You want clean checkpoints you can roll back to.
- **Phase 2 (rules) may need your input.** The spec has starter content for the rule files, but you'll want to review and add your firm's specific opinions and patterns. Claude Code can write the structure; you fill in the consulting knowledge.
