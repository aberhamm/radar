import type { Finding } from './runTransform';

// ─── AI Fix prompt ──────────────────────────────────────────────

export function buildAiFixPrompt(finding: Finding): string {
  const lines: string[] = [
    `## Fix: ${finding.title}`,
    '',
    `**Severity:** ${finding.severity}`,
    `**Category:** ${finding.category}`,
    '',
  ];

  if (finding.note) {
    lines.push('### Problem', '', finding.note, '');
  }

  if (finding.evidence.length > 0) {
    lines.push('### Affected Files', '');
    for (const e of finding.evidence) {
      lines.push(`- \`${e.filePath}${e.lineNumber ? `:${e.lineNumber}` : ''}\``);
      if (e.snippet) {
        lines.push('```', e.snippet, '```');
      }
    }
    lines.push('');
  } else if (finding.evidenceFiles.length > 0) {
    lines.push('### Affected Files', '');
    for (const f of finding.evidenceFiles) {
      lines.push(`- \`${f}\``);
    }
    lines.push('');
  }

  lines.push(
    '### Instructions',
    '',
    `Fix this ${finding.severity} ${finding.category} issue. The problem is: ${finding.title}.`,
    '',
    'Please provide the corrected code with an explanation of what changed and why.',
  );

  return lines.join('\n');
}

export function buildBulkAiFixPrompt(findings: Finding[]): string {
  const sections = findings.map((f, i) => {
    const lines: string[] = [`## ${i + 1}. ${f.title}`, '', `**Severity:** ${f.severity} | **Category:** ${f.category}`, ''];
    if (f.note) lines.push(f.note, '');
    if (f.evidence.length > 0) {
      for (const e of f.evidence) {
        lines.push(`- \`${e.filePath}${e.lineNumber ? `:${e.lineNumber}` : ''}\``);
        if (e.snippet) lines.push('```', e.snippet, '```');
      }
    } else if (f.evidenceFiles.length > 0) {
      for (const file of f.evidenceFiles) lines.push(`- \`${file}\``);
    }
    return lines.join('\n');
  });

  return [
    `# Fix ${findings.length} Finding${findings.length !== 1 ? 's' : ''}`,
    '',
    'Fix each of the following issues. Provide corrected code with explanations.',
    '',
    ...sections,
  ].join('\n');
}

// ─── Jira payload ───────────────────────────────────────────────

interface JiraIssuePayload {
  fields: {
    project: { key: string };
    issuetype: { name: string };
    summary: string;
    description: string;
    priority: { name: string };
    labels: string[];
  };
}

const JIRA_PRIORITY: Record<string, string> = {
  critical: 'Highest',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  info: 'Lowest',
};

function buildJiraDescription(f: Finding): string {
  const lines: string[] = [];
  if (f.note) lines.push(f.note, '');
  if (f.evidence.length > 0) {
    lines.push('h3. Evidence', '');
    for (const e of f.evidence) {
      lines.push(`* {{${e.filePath}${e.lineNumber ? `:${e.lineNumber}` : ''}}}`);
      if (e.snippet) lines.push('{code}', e.snippet, '{code}');
    }
  } else if (f.evidenceFiles.length > 0) {
    lines.push('h3. Affected Files', '');
    for (const file of f.evidenceFiles) lines.push(`* {{${file}}}`);
  }
  if (f.tags.length > 0) lines.push('', `Tags: ${f.tags.join(', ')}`);
  return lines.join('\n');
}

export function buildJiraPayload(finding: Finding, projectKey = 'RADAR'): JiraIssuePayload {
  return {
    fields: {
      project: { key: projectKey },
      issuetype: { name: 'Bug' },
      summary: `[${finding.severity.toUpperCase()}] ${finding.title}`,
      description: buildJiraDescription(finding),
      priority: { name: JIRA_PRIORITY[finding.severity] ?? 'Medium' },
      labels: ['radar', `severity-${finding.severity}`, finding.category],
    },
  };
}

export function buildBulkJiraPayload(findings: Finding[], projectKey = 'RADAR'): { issueUpdates: JiraIssuePayload[] } {
  return {
    issueUpdates: findings.map(f => buildJiraPayload(f, projectKey)),
  };
}

// ─── Azure DevOps payload ───────────────────────────────────────

interface AdoWorkItemPayload {
  op: 'add';
  path: string;
  value: string;
}

const ADO_SEVERITY: Record<string, string> = {
  critical: '1 - Critical',
  high: '2 - High',
  medium: '3 - Medium',
  low: '4 - Low',
  info: '4 - Low',
};

function buildAdoDescription(f: Finding): string {
  const lines: string[] = [];
  if (f.note) lines.push(`<p>${f.note}</p>`);
  if (f.evidence.length > 0) {
    lines.push('<h3>Evidence</h3><ul>');
    for (const e of f.evidence) {
      lines.push(`<li><code>${e.filePath}${e.lineNumber ? `:${e.lineNumber}` : ''}</code></li>`);
      if (e.snippet) lines.push(`<pre>${e.snippet}</pre>`);
    }
    lines.push('</ul>');
  } else if (f.evidenceFiles.length > 0) {
    lines.push('<h3>Affected Files</h3><ul>');
    for (const file of f.evidenceFiles) lines.push(`<li><code>${file}</code></li>`);
    lines.push('</ul>');
  }
  if (f.tags.length > 0) lines.push(`<p>Tags: ${f.tags.join(', ')}</p>`);
  return lines.join('\n');
}

export function buildAdoPayload(finding: Finding): AdoWorkItemPayload[] {
  return [
    { op: 'add', path: '/fields/System.Title', value: `[${finding.severity.toUpperCase()}] ${finding.title}` },
    { op: 'add', path: '/fields/System.Description', value: buildAdoDescription(finding) },
    { op: 'add', path: '/fields/Microsoft.VSTS.Common.Severity', value: ADO_SEVERITY[finding.severity] ?? '3 - Medium' },
    { op: 'add', path: '/fields/System.Tags', value: ['radar', `severity-${finding.severity}`, finding.category].join('; ') },
  ];
}

export function buildBulkAdoPayload(findings: Finding[]): AdoWorkItemPayload[][] {
  return findings.map(f => buildAdoPayload(f));
}
