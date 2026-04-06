/**
 * E2e test: Run the full Pi Agent loop with faux provider for the accessibility goal.
 *
 * Uses Pi's built-in registerFauxProvider + fauxAssistantMessage/fauxToolCall
 * to script deterministic responses without hitting an LLM.
 *
 * Asserts:
 * - Termination reason is 'completed'
 * - 8+ findings recorded with required fields
 * - Every accessibility scorecard category has a score
 * - Brief markdown is substantive
 * - Output files written to disk
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  registerFauxProvider,
  fauxAssistantMessage,
  fauxToolCall,
  fauxText,
} from '@mariozechner/pi-ai';
import { runAgent, type RunResult } from '../../src/agent/runner.js';
import fs from 'node:fs';
import path from 'node:path';

const FIXTURE_PATH = path.resolve(__dirname, '../fixtures/sitecore-minimal');
const OUTPUT_DIR = path.resolve(__dirname, '../__e2e_a11y_output__');

function buildFauxResponses() {
  return [
    // Step 1: List directory + parse package.json
    fauxAssistantMessage([
      fauxText('Investigating the project structure for accessibility audit.'),
      fauxToolCall('list_directory', { path: '.', depth: 2 }),
      fauxToolCall('parse_package_json', {}),
    ], { stopReason: 'toolUse' }),

    // Step 2: Read component files
    fauxAssistantMessage([
      fauxText('Reading components to assess accessibility patterns.'),
      fauxToolCall('read_files_batch', { paths: ['src/components/ClientWidget.tsx', 'src/components/ServerCard.tsx'] }),
      fauxToolCall('read_file', { path: 'src/app/[site]/[locale]/[[...path]]/page.tsx' }),
    ], { stopReason: 'toolUse' }),

    // Step 3: Search for a11y patterns
    fauxAssistantMessage([
      fauxText('Searching for accessibility patterns in the codebase.'),
      fauxToolCall('grep_pattern', { pattern: '<img', path: 'src' }),
      fauxToolCall('grep_pattern', { pattern: 'aria-', path: 'src' }),
      fauxToolCall('grep_pattern', { pattern: 'onClick', path: 'src' }),
    ], { stopReason: 'toolUse' }),

    // Step 4: Record findings — images & media, semantic structure, keyboard & focus
    fauxAssistantMessage([
      fauxText('Recording findings for images, semantic structure, and keyboard patterns.'),
      fauxToolCall('record_finding', {
        finding: { id: 'A11Y-IMG-001', category: 'accessibility', severity: 'info', title: 'No img elements found in components', description: 'No <img> or <Image> elements detected in component source files. If images are rendered via CMS content, verify alt text is provided at the content level.', evidence: [{ filePath: 'src/components/ServerCard.tsx', lineNumber: 1, snippet: 'export default function ServerCard', description: 'No image elements in server component' }], tags: ['wcag-1.1.1', 'images'] },
      }),
      fauxToolCall('record_finding', {
        finding: { id: 'A11Y-SEM-001', category: 'architecture', severity: 'medium', title: 'No landmark regions in page template', description: 'Page template lacks semantic landmark regions (nav, main, aside, footer). Screen reader users cannot navigate by landmarks. Violates WCAG 1.3.1.', evidence: [{ filePath: 'src/app/[site]/[locale]/[[...path]]/page.tsx', lineNumber: 1, snippet: 'export default function Page', description: 'Page component without landmark regions' }], tags: ['wcag-1.3.1', 'semantics'] },
      }),
      fauxToolCall('record_finding', {
        finding: { id: 'A11Y-KB-001', category: 'accessibility', severity: 'high', title: 'Button onClick without keyboard handler', description: 'ClientWidget uses onClick on a <button> element. While native buttons are keyboard-accessible, the component lacks visible focus indicators in its styles. WCAG 2.4.7 requires visible focus.', evidence: [{ filePath: 'src/components/ClientWidget.tsx', lineNumber: 8, snippet: "<button onClick={() => setCount(count + 1)}>", description: 'Button with onClick, no focus styles' }], tags: ['wcag-2.4.7', 'keyboard'] },
      }),
    ], { stopReason: 'toolUse' }),

    // Step 5: Record findings — forms, color/contrast, dynamic content, aria
    fauxAssistantMessage([
      fauxText('Recording findings for forms, color, dynamic content, and ARIA.'),
      fauxToolCall('record_finding', {
        finding: { id: 'A11Y-FORM-001', category: 'forms', severity: 'info', title: 'No form elements detected', description: 'No <form>, <input>, or <select> elements found in component source. If forms are rendered via CMS, verify label associations at integration level.', evidence: [{ filePath: 'src/components/ClientWidget.tsx', lineNumber: 1, snippet: "'use client';", description: 'Client component — no form elements' }], tags: ['wcag-1.3.1', 'forms'] },
      }),
      fauxToolCall('record_finding', {
        finding: { id: 'A11Y-COLOR-001', category: 'accessibility', severity: 'low', title: 'No color/contrast configuration found', description: 'No CSS files or theme configuration detected in the component source. Unable to verify color contrast compliance (WCAG 1.4.3). Recommend adding a design token system.', evidence: [{ filePath: 'src/components/ClientWidget.tsx', lineNumber: 8, snippet: "<button onClick={() => setCount(count + 1)}>", description: 'Inline button with no style definitions' }], tags: ['wcag-1.4.3', 'contrast'] },
      }),
      fauxToolCall('record_finding', {
        finding: { id: 'A11Y-DYN-001', category: 'aria', severity: 'medium', title: 'Counter update not announced to assistive technology', description: 'ClientWidget updates a counter on click but does not use aria-live to announce the change. Screen reader users will not hear the updated count. Violates WCAG 4.1.3.', evidence: [{ filePath: 'src/components/ClientWidget.tsx', lineNumber: 9, snippet: 'Count: {count}', description: 'Dynamic text without aria-live region' }], tags: ['wcag-4.1.3', 'aria-live'] },
      }),
      fauxToolCall('record_finding', {
        finding: { id: 'A11Y-ARIA-001', category: 'aria', severity: 'info', title: 'No ARIA attributes in use', description: 'No aria-* attributes found in the component source. For a minimal project this is acceptable, but as the UI grows, ARIA landmarks and live regions should be added.', evidence: [{ filePath: 'src/components/ServerCard.tsx', lineNumber: 1, snippet: 'export default function ServerCard', description: 'No aria attributes in component' }], tags: ['aria'] },
      }),
      fauxToolCall('record_finding', {
        finding: { id: 'A11Y-NAV-001', category: 'accessibility', severity: 'high', title: 'No skip navigation link', description: 'No skip-to-content link found. Keyboard users must tab through all navigation to reach main content. Violates WCAG 2.4.1.', evidence: [{ filePath: 'src/app/[site]/[locale]/[[...path]]/page.tsx', lineNumber: 1, snippet: 'export default function Page', description: 'Page template without skip link' }], tags: ['wcag-2.4.1', 'keyboard'] },
      }),
    ], { stopReason: 'toolUse' }),

    // Step 6: Assemble output
    fauxAssistantMessage([
      fauxText('Assembling the accessibility audit brief.'),
      fauxToolCall('assemble_output', {
        sections: {
          executive_summary: 'This project has several WCAG 2.1 AA compliance gaps. Key issues: missing landmark regions, no skip navigation, and dynamic content not announced to screen readers.',
          critical_violations: 'No critical (P1) violations that completely block access. However, two high-severity issues require attention: missing skip navigation and lack of visible focus indicators.',
          component_audit: 'ClientWidget: button is semantically correct but lacks focus styles and aria-live for counter updates. ServerCard: server-rendered, no accessibility issues detected.',
          form_accessibility: 'No form elements detected in the current component set. Monitor as the UI grows.',
          keyboard_navigation: 'Native button elements are keyboard-accessible. Missing skip-to-content link forces keyboard users to tab through all elements.',
          aria_patterns: 'No ARIA attributes currently in use. Counter updates need aria-live regions. Page needs landmark roles.',
          recommendations: '1. Add skip-to-content link\n2. Add landmark regions (nav, main)\n3. Add aria-live to counter\n4. Add visible focus indicators\n5. Establish accessibility testing process',
          architecture_scorecard: 'Overall YELLOW. Semantic structure and dynamic content patterns need work.',
        },
      }),
    ], { stopReason: 'toolUse' }),
  ];
}

describe('E2e: Pi Agent accessibility goal', () => {
  let result: RunResult;
  let unregister: () => void;

  beforeAll(async () => {
    if (fs.existsSync(OUTPUT_DIR)) {
      fs.rmSync(OUTPUT_DIR, { recursive: true });
    }

    const faux = registerFauxProvider();
    faux.setResponses(buildFauxResponses());
    unregister = faux.unregister;

    result = await runAgent({
      repoPath: FIXTURE_PATH,
      repoName: 'sitecore-minimal',
      repoSource: 'local',
      goal: 'accessibility',
      toolCallBudget: 50,
      outputDir: OUTPUT_DIR,
      model: faux.getModel(),
    });
  }, 30_000);

  afterAll(() => {
    unregister();
    if (fs.existsSync(OUTPUT_DIR)) {
      fs.rmSync(OUTPUT_DIR, { recursive: true });
    }
  });

  it('terminates with completed status', () => {
    expect(result.terminationReason).toBe('completed');
    expect(result.errorDetail).toBeUndefined();
  });

  it('produces a scorecard with overall score', () => {
    expect(result.scorecard).toBeDefined();
    expect(['red', 'yellow', 'green']).toContain(result.scorecard.overallScore);
  });

  it('scorecard has all 6 accessibility display categories', () => {
    expect(result.scorecard.categories.length).toBe(6);
  });

  it('records 8+ findings', () => {
    expect(result.state.findings.length).toBeGreaterThanOrEqual(8);
  });

  it('every finding has required fields', () => {
    for (const finding of result.state.findings) {
      expect(finding.id).toBeTruthy();
      expect(finding.category).toBeTruthy();
      expect(finding.severity).toBeTruthy();
      expect(finding.title).toBeTruthy();
      expect(finding.description).toBeTruthy();
      expect(Array.isArray(finding.evidence)).toBe(true);
      expect(finding.evidence.length).toBeGreaterThan(0);
    }
  });

  it('findings include WCAG-tagged categories', () => {
    const categories = new Set(result.state.findings.map(f => f.category));
    expect(categories.has('accessibility')).toBe(true);
  });

  it('brief markdown is non-empty', () => {
    expect(result.briefMarkdown.length).toBeGreaterThan(200);
  });

  it('writes output files to disk', () => {
    expect(result.outputPaths.length).toBeGreaterThanOrEqual(4);
    for (const p of result.outputPaths) {
      expect(fs.existsSync(p)).toBe(true);
    }
  });

  it('goal type is accessibility in scorecard', () => {
    expect(result.scorecard.goalType).toBe('accessibility');
  });
});
