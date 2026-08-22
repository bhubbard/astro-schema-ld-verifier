import { describe, it, expect } from 'bun:test';
import {
  extractJsonLdScripts,
  extractDomContent,
  normalizeText,
  summarizeSchemaForPrompt,
} from '../src/parser.js';

describe('parser: normalizeText', () => {
  it('collapses multiple whitespace characters and newlines', () => {
    const raw = '  Hello \n\n  world\t\tfrom   Astro!  ';
    expect(normalizeText(raw)).toBe('Hello world from Astro!');
  });

  it('handles empty or null-like inputs gracefully', () => {
    expect(normalizeText('')).toBe('');
  });
});

describe('parser: extractJsonLdScripts', () => {
  it('extracts and parses a single JSON-LD script tag from HTML', () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "Article",
              "headline": "Astro 5 Architecture Deep Dive",
              "author": {
                "@type": "Person",
                "name": "Sarah Connor"
              }
            }
          </script>
        </head>
        <body>
          <h1>Astro 5 Architecture Deep Dive</h1>
        </body>
      </html>
    `;

    const res = extractJsonLdScripts(html);
    expect(res.totalScripts).toBe(1);
    expect(res.totalSchemas).toBe(1);
    expect(res.schemas[0].type).toBe('Article');
    expect((res.schemas[0].raw.author as any).name).toBe('Sarah Connor');
    expect(res.syntaxErrors.length).toBe(0);
  });

  it('extracts multiple JSON-LD script tags and array schemas', () => {
    const html = `
      <div>
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "WebSite",
            "name": "My Blog"
          }
        </script>
        <script type="application/ld+json">
          [
            {
              "@context": "https://schema.org",
              "@type": "BreadcrumbList",
              "itemListElement": []
            },
            {
              "@context": "https://schema.org",
              "@type": "Organization",
              "name": "Acme Corp"
            }
          ]
        </script>
      </div>
    `;

    const res = extractJsonLdScripts(html);
    expect(res.totalScripts).toBe(2);
    expect(res.totalSchemas).toBe(3);
    const types = res.schemas.map((s) => s.type);
    expect(types).toContain('WebSite');
    expect(types).toContain('BreadcrumbList');
    expect(types).toContain('Organization');
  });

  it('flattens @graph node lists properly', () => {
    const html = `
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "Article",
              "headline": "Graph Article"
            },
            {
              "@type": "Person",
              "name": "John Doe"
            }
          ]
        }
      </script>
    `;

    const res = extractJsonLdScripts(html);
    expect(res.totalSchemas).toBe(2);
    expect(res.schemas[0].type).toBe('Article');
    expect(res.schemas[1].type).toBe('Person');
  });

  it('catches and records JSON syntax errors without throwing', () => {
    const html = `
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Article",
          "headline": "Broken JSON missing closing quote
        }
      </script>
    `;

    const res = extractJsonLdScripts(html);
    expect(res.totalScripts).toBe(1);
    expect(res.totalSchemas).toBe(0);
    expect(res.syntaxErrors.length).toBe(1);
    expect(res.syntaxErrors[0].type).toBe('syntax_error');
    expect(res.syntaxErrors[0].severity).toBe('error');
  });
});

describe('parser: extractDomContent', () => {
  it('extracts title, meta description, headings, body text, and lists', () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>How to Bake Sourdough Bread</title>
          <meta name="description" content="A comprehensive step by step sourdough guide">
        </head>
        <body>
          <h1>How to Bake Sourdough Bread</h1>
          <h2>Ingredients</h2>
          <p>You need flour, water, salt, and active starter.</p>
          <h2>Instructions</h2>
          <ol>
            <li>Feed your starter 4 hours before mixing.</li>
            <li>Mix flour and water and autolyse for 30 minutes.</li>
            <li>Fold the dough every 30 minutes for 2 hours.</li>
          </ol>
          <script>console.log("ignore me");</script>
          <style>.hide { display: none; }</style>
        </body>
      </html>
    `;

    const dom = extractDomContent(html);
    expect(dom.title).toBe('How to Bake Sourdough Bread');
    expect(dom.metaDescription).toBe('A comprehensive step by step sourdough guide');
    expect(dom.headings.length).toBe(3);
    expect(dom.headings[0].text).toBe('How to Bake Sourdough Bread');
    expect(dom.bodyText).toContain('Feed your starter');
    expect(dom.bodyText).not.toContain('console.log');
    expect(dom.structuredLists.length).toBe(1);
    expect(dom.structuredLists[0].length).toBe(3);
    expect(dom.structuredLists[0][0]).toBe('Feed your starter 4 hours before mixing.');
  });
});

describe('parser: summarizeSchemaForPrompt', () => {
  it('strips @context and retains semantic properties', () => {
    const summary = summarizeSchemaForPrompt({
      id: 'test-1',
      type: 'Product',
      scriptIndex: 0,
      raw: {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: 'Wireless Mechanical Keyboard',
        price: '149.99',
      },
      properties: {},
    });

    expect(summary['@type']).toBe('Product');
    expect(summary.name).toBe('Wireless Mechanical Keyboard');
    expect(summary['@context']).toBeUndefined();
  });
});
