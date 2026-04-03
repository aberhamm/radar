import { describe, it, expect } from 'vitest';
import { VALIDATORS } from '../../src/tools/validators.js';

describe('VALIDATORS', () => {
  describe('grep_pattern', () => {
    const v = VALIDATORS.grep_pattern!;

    it('accepts valid input', () => {
      expect(v({ pattern: 'import' })).toBeNull();
      expect(v({ pattern: 'foo', maxResults: 100, offset: 0 })).toBeNull();
    });

    it('rejects empty pattern', () => {
      expect(v({ pattern: '' })).toContain('pattern');
      expect(v({})).toContain('pattern');
    });

    it('rejects maxResults out of range', () => {
      expect(v({ pattern: 'x', maxResults: 0 })).toContain('maxResults');
      expect(v({ pattern: 'x', maxResults: 501 })).toContain('maxResults');
    });

    it('rejects negative offset', () => {
      expect(v({ pattern: 'x', offset: -1 })).toContain('offset');
    });
  });

  describe('read_file', () => {
    const v = VALIDATORS.read_file!;

    it('accepts valid input', () => {
      expect(v({ path: 'src/index.ts' })).toBeNull();
      expect(v({ path: 'a.ts', startLine: 10, maxLines: 50 })).toBeNull();
    });

    it('rejects empty path', () => {
      expect(v({ path: '' })).toContain('path');
      expect(v({})).toContain('path');
    });

    it('rejects maxLines out of range', () => {
      expect(v({ path: 'a.ts', maxLines: 0 })).toContain('maxLines');
    });
  });

  describe('read_files_batch', () => {
    const v = VALIDATORS.read_files_batch!;

    it('accepts valid input', () => {
      expect(v({ paths: ['a.ts', 'b.ts'] })).toBeNull();
    });

    it('rejects empty array', () => {
      expect(v({ paths: [] })).toContain('paths');
    });

    it('rejects more than 20 paths', () => {
      const paths = Array.from({ length: 21 }, (_, i) => `file${i}.ts`);
      expect(v({ paths })).toContain('20');
    });
  });

  describe('fetch_url', () => {
    const v = VALIDATORS.fetch_url!;

    it('accepts valid HTTP URLs', () => {
      expect(v({ url: 'https://nextjs.org/docs' })).toBeNull();
      expect(v({ url: 'http://example.com' })).toBeNull();
    });

    it('rejects missing url', () => {
      expect(v({})).toContain('url');
    });

    it('rejects non-http protocols', () => {
      expect(v({ url: 'ftp://files.com/data' })).toContain('http');
    });

    it('rejects invalid URLs', () => {
      expect(v({ url: 'not-a-url' })).toContain('valid URL');
    });
  });

  describe('record_finding', () => {
    const v = VALIDATORS.record_finding!;

    it('accepts valid finding input', () => {
      expect(v({
        finding: {
          category: 'security',
          severity: 'high',
          title: 'Missing CSP headers',
          description: 'No Content-Security-Policy header configured.',
        },
      })).toBeNull();
    });

    it('rejects invalid category', () => {
      expect(v({
        finding: {
          category: 'invalid',
          severity: 'high',
          title: 'x',
          description: 'x',
        },
      })).toContain('category');
    });

    it('rejects invalid severity', () => {
      expect(v({
        finding: {
          category: 'security',
          severity: 'urgent',
          title: 'x',
          description: 'x',
        },
      })).toContain('severity');
    });

    it('rejects missing title', () => {
      expect(v({
        finding: {
          category: 'security',
          severity: 'high',
          title: '',
          description: 'x',
        },
      })).toContain('title');
    });

    it('rejects missing finding object', () => {
      expect(v({ category: 'security' })).toContain('finding');
    });
  });

  describe('list_directory', () => {
    const v = VALIDATORS.list_directory!;

    it('accepts valid path', () => {
      expect(v({ path: 'src' })).toBeNull();
    });

    it('rejects empty path', () => {
      expect(v({ path: '' })).toContain('path');
    });
  });

  describe('find_files', () => {
    const v = VALIDATORS.find_files!;

    it('accepts valid pattern', () => {
      expect(v({ pattern: '*.tsx' })).toBeNull();
    });

    it('rejects empty pattern', () => {
      expect(v({})).toContain('pattern');
    });
  });

  describe('web_search', () => {
    const v = VALIDATORS.web_search!;

    it('accepts valid query', () => {
      expect(v({ query: 'sitecore jss next.js' })).toBeNull();
    });

    it('rejects empty query', () => {
      expect(v({ query: '' })).toContain('query');
    });
  });

  describe('assemble_output', () => {
    const v = VALIDATORS.assemble_output!;

    it('accepts valid sections', () => {
      expect(v({ sections: { overview: 'test' } })).toBeNull();
    });

    it('rejects missing sections', () => {
      expect(v({})).toContain('sections');
    });
  });

  describe('tool_search', () => {
    const v = VALIDATORS.tool_search!;

    it('accepts valid query', () => {
      expect(v({ query: 'web fetch' })).toBeNull();
    });

    it('rejects empty query', () => {
      expect(v({ query: '' })).toContain('query');
    });
  });

  describe('tools with no constraints', () => {
    const noConstraintTools = [
      'parse_package_json', 'parse_next_config', 'parse_tsconfig',
      'analyze_route_structure', 'analyze_env_usage', 'analyze_middleware',
      'detect_app_roots', 'switch_to_fast_model',
    ];

    for (const name of noConstraintTools) {
      it(`${name} accepts empty params`, () => {
        expect(VALIDATORS[name]!({})).toBeNull();
      });
    }
  });

  describe('parse_env_file', () => {
    it('requires path', () => {
      expect(VALIDATORS.parse_env_file!({})).toContain('path');
      expect(VALIDATORS.parse_env_file!({ path: '.env' })).toBeNull();
    });
  });

  describe('check_gitignore', () => {
    it('requires patterns array', () => {
      expect(VALIDATORS.check_gitignore!({})).toContain('patterns');
      expect(VALIDATORS.check_gitignore!({ patterns: ['node_modules'] })).toBeNull();
    });
  });

  describe('query_npm_versions', () => {
    it('requires packages array', () => {
      expect(VALIDATORS.query_npm_versions!({})).toContain('packages');
      expect(VALIDATORS.query_npm_versions!({ packages: ['react'] })).toBeNull();
    });
  });

  describe('compare_versions', () => {
    it('requires installed array and latest object', () => {
      expect(VALIDATORS.compare_versions!({})).toContain('installed');
      expect(VALIDATORS.compare_versions!({ installed: [{ name: 'x', version: '1.0.0', isDev: false }], latest: {} })).toBeNull();
    });

    it('rejects non-object latest', () => {
      expect(VALIDATORS.compare_versions!({ installed: [{ name: 'x' }], latest: null })).toContain('latest');
    });
  });

  describe('analyze_component_directives', () => {
    it('requires path', () => {
      expect(VALIDATORS.analyze_component_directives!({})).toContain('path');
      expect(VALIDATORS.analyze_component_directives!({ path: 'src' })).toBeNull();
    });
  });
});
