/**
 * StubProvider — deterministic provider for testing without an LLM.
 *
 * Two modes:
 * 1. Scripted mode (default): Simulates a basic investigation flow with
 *    pre-scripted tool calls covering all scorecard categories.
 * 2. Throw mode: Throws on any call (original behavior for unimplemented providers).
 *
 * Used by e2e tests and for demo dry-runs.
 */

import type {
  ModelProvider,
  ChatMessage,
  ChatCompletionResponse,
  ToolDefinition,
} from '../types/provider.js';

let callCounter = 0;

/**
 * Pre-scripted tool call sequences.
 * Each call to chat() returns the next step in the script.
 */
function getScriptedResponse(step: number): ChatCompletionResponse {
  switch (step) {
    case 0:
      // Step 1: List directory + parse package.json
      return toolResponse('Investigating the project structure and stack.', [
        { name: 'list_directory', args: { path: '.', depth: 2 } },
        { name: 'parse_package_json', args: {} },
      ]);

    case 1:
      // Step 2: Read key files
      return toolResponse('Reading key configuration files.', [
        { name: 'read_file', args: { path: 'package.json' } },
      ]);

    case 2:
      // Step 3: Check env and gitignore
      return toolResponse('Checking security and environment configuration.', [
        { name: 'check_gitignore', args: { patterns: ['.env', '.env.local', 'node_modules'] } },
        { name: 'analyze_env_usage', args: { repoPath: '.' } },
      ]);

    case 3:
      // Step 4: Analyze components
      return toolResponse('Analyzing component architecture and routing.', [
        { name: 'analyze_component_directives', args: { path: 'src' } },
        { name: 'analyze_route_structure', args: { repoPath: '.' } },
      ]);

    case 4:
      return toolResponse('Recording findings for stack and CMS categories.', [
        { name: 'record_finding', args: { finding: { id: 'STACK-001', category: 'stack', severity: 'info', title: 'Next.js application with standard configuration', description: 'The project uses Next.js with standard App Router configuration.', evidence: [{ filePath: 'package.json', description: 'Next.js detected in dependencies' }], tags: ['nextjs', 'stack'] } } },
        { name: 'record_finding', args: { finding: { id: 'CMS-001', category: 'cms-integration', severity: 'info', title: 'CMS integration uses standard SDK patterns', description: 'CMS integration follows the recommended SDK approach.', evidence: [{ filePath: 'src/lib/client.ts', description: 'Standard CMS client setup' }], tags: ['cms'] } } },
      ]);

    case 5:
      return toolResponse('Recording findings for editing, security, and architecture.', [
        { name: 'record_finding', args: { finding: { id: 'EDIT-001', category: 'preview-editing', severity: 'info', title: 'Preview mode uses Draft Mode pattern', description: 'Preview/editing uses Next.js Draft Mode correctly.', evidence: [{ filePath: 'src/app/api/editing/route.ts', description: 'Draft Mode integration' }], tags: ['editing'] } } },
        { name: 'record_finding', args: { finding: { id: 'SEC-001', category: 'security', severity: 'medium', title: 'Environment variables not documented', description: 'No .env.example file found.', evidence: [{ filePath: '.gitignore', description: '.env gitignored but no example' }], tags: ['security', 'config'] } } },
        { name: 'record_finding', args: { finding: { id: 'ARCH-001', category: 'architecture', severity: 'info', title: 'App Router with catch-all route pattern', description: 'Uses App Router with a catch-all route for CMS-driven pages.', evidence: [{ filePath: 'src/app/[[...path]]/page.tsx', description: 'Catch-all route' }], tags: ['routing'] } } },
      ]);

    case 6:
      return toolResponse('Recording findings for dependencies, deployment, and config.', [
        { name: 'record_finding', args: { finding: { id: 'DEP-001', category: 'dependencies', severity: 'low', title: 'Dependencies are reasonably current', description: 'No critical version gaps detected.', evidence: [{ filePath: 'package.json', description: 'Version check' }], tags: ['dependencies'] } } },
        { name: 'record_finding', args: { finding: { id: 'DEPLOY-001', category: 'deployment', severity: 'info', title: 'Deployment target appears to be Vercel', description: 'Vercel-specific configuration detected.', evidence: [{ filePath: 'next.config.ts', description: 'Vercel hints' }], tags: ['deployment'] } } },
        { name: 'record_finding', args: { finding: { id: 'CONFIG-001', category: 'configuration', severity: 'info', title: 'TypeScript strict mode enabled', description: 'TypeScript strict mode is enabled.', evidence: [{ filePath: 'tsconfig.json', description: 'strict: true' }], tags: ['config'] } } },
      ]);

    case 7:
      // Assemble output
      return toolResponse('Assembling the onboarding brief.', [
        {
          name: 'assemble_output',
          args: {
            sections: {
              project_overview: 'This is a Next.js headless CMS application built on the App Router.',
              stack_and_architecture: 'Next.js 15 with TypeScript, using the CMS SDK for content delivery.',
              key_files_table: '| Path | Purpose | Why It Matters |\n|---|---|---|\n| package.json | Dependencies | Core stack definition |\n| src/app/[[...path]]/page.tsx | Catch-all route | Handles all CMS pages |\n| src/lib/client.ts | CMS client | Content fetching |\n| next.config.ts | Framework config | Build and runtime settings |\n| tsconfig.json | TypeScript config | Compiler settings |\n| .gitignore | Ignored files | Security boundary |\n| src/middleware.ts | Edge middleware | Request processing |\n| src/components/ | Component library | UI components |\n| src/app/api/ | API routes | Server endpoints |\n| .env.example | Env template | Required variables |',
              cms_integration: 'Content is fetched via the CMS SDK client, which queries the CMS API and returns structured layout data.',
              preview_editing: 'Uses Next.js Draft Mode for preview. The editing API route handles CMS editor requests.',
              environment_and_configuration: 'Required: CMS_URL, CMS_API_KEY, EDITING_SECRET. Values from CMS portal.',
              local_setup_steps: '1. Clone the repository\n2. Copy .env.example to .env.local\n3. npm install\n4. npm run dev\n5. Open http://localhost:3000',
              architecture_scorecard: 'Overall GREEN. All 7 categories assessed with findings.',
              top_5_risks: '1. Missing .env documentation (medium) — new developers may miss required variables',
              first_week_reading: '1. README.md (10 min)\n2. package.json — understand the dependency tree\n3. src/app/[[...path]]/page.tsx — the main rendering path',
              questions_for_client: '1. What is the production deployment target?\n2. Are there additional CMS content types planned?\n3. Is preview/editing integration tested?',
              suggested_next_actions: '1. Create .env.example with all required variables\n2. Add integration tests for the editing route\n3. Review dependency update strategy',
            },
          },
        },
      ]);

    default:
      return {
        content: 'Investigation complete.',
        toolCalls: [],
        usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110 },
        model: 'stub-model',
        finishReason: 'stop',
      };
  }
}

function toolResponse(
  reasoning: string,
  calls: { name: string; args: Record<string, unknown> }[],
): ChatCompletionResponse {
  return {
    content: reasoning,
    toolCalls: calls.map((c) => ({
      id: `stub_call_${callCounter++}`,
      type: 'function' as const,
      function: {
        name: c.name,
        arguments: JSON.stringify(c.args),
      },
    })),
    usage: { promptTokens: 500, completionTokens: 200, totalTokens: 700 },
    model: 'stub-model',
    finishReason: 'tool_calls',
  };
}

export class StubProvider implements ModelProvider {
  readonly name = 'stub';
  private step = 0;
  private readonly throwMode: boolean;

  constructor(options?: { throwMode?: boolean; providerName?: string }) {
    if (options?.throwMode) {
      this.throwMode = true;
      if (options.providerName) {
        (this as { name: string }).name = options.providerName;
      }
    } else {
      this.throwMode = false;
    }
  }

  async chat(
    _messages: ChatMessage[],
    _options?: {
      tools?: ToolDefinition[];
      model?: string;
      temperature?: number;
      maxTokens?: number;
    },
  ): Promise<ChatCompletionResponse> {
    if (this.throwMode) {
      throw new Error(`Provider not implemented: ${this.name}. See docs for setup.`);
    }

    const response = getScriptedResponse(this.step);
    this.step++;
    return response;
  }

  /** Reset the script to the beginning. */
  reset(): void {
    this.step = 0;
    callCounter = 0;
  }
}
