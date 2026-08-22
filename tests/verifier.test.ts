import { describe, it, expect } from 'bun:test';
import {
  buildVerificationPrompt,
  parseVerificationResponse,
  verifyWithHeuristics,
  verifySchemaLd,
} from '../src/verifier.js';
import type { ExtractedDomContent, ExtractedJsonLdSchema } from '../src/types.js';

describe('verifier: buildVerificationPrompt', () => {
  it('constructs a prompt containing DOM excerpt and structured schemas', () => {
    const dom: ExtractedDomContent = {
      title: 'Guide to Astro',
      metaDescription: 'All about Astro',
      headings: [{ level: 1, text: 'Guide to Astro' }],
      bodyText: 'Astro is a modern web framework.',
      authorText: 'Jane Doe',
      structuredLists: [['Step 1', 'Step 2']],
    };

    const schemas: ExtractedJsonLdSchema[] = [
      {
        id: '1',
        type: 'Article',
        scriptIndex: 0,
        raw: { '@type': 'Article', headline: 'Guide to Astro', author: 'Jane Doe' },
        properties: {},
      },
    ];

    const prompt = buildVerificationPrompt(dom, schemas);
    expect(prompt).toContain('Validate JSON-LD schema against DOM text content');
    expect(prompt).toContain('Guide to Astro');
    expect(prompt).toContain('Jane Doe');
    expect(prompt).toContain('"@type": "Article"');
  });
});

describe('verifier: parseVerificationResponse', () => {
  it('parses valid markdown code-fenced JSON responses', () => {
    const jsonStr = '```json\n{\n  "findings": [\n    {\n      "type": "mismatched_author",\n      "severity": "error",\n      "schemaType": "Article",\n      "property": "author.name",\n      "expectedInSchema": "Unknown Person",\n      "foundInDom": "Jane Doe",\n      "message": "Author does not match",\n      "reasoning": "DOM mentions Jane Doe while schema says Unknown Person"\n    }\n  ],\n  "reasoning": "Detected 1 mismatch."\n}\n```';

    const res = parseVerificationResponse(jsonStr);
    expect(res.findings.length).toBe(1);
    expect(res.findings[0].type).toBe('mismatched_author');
    expect(res.findings[0].severity).toBe('error');
    expect(res.reasoning).toBe('Detected 1 mismatch.');
  });

  it('handles raw JSON strings without code fences', () => {
    const rawJson = JSON.stringify({
      findings: [
        {
          type: 'valid_match',
          severity: 'success',
          schemaType: 'HowTo',
          property: 'step[0]',
          expectedInSchema: 'Preheat oven',
          foundInDom: 'Preheat oven',
          message: 'Step matches DOM',
          reasoning: 'Verified',
        },
      ],
      reasoning: 'All steps valid.',
    });

    const res = parseVerificationResponse(rawJson);
    expect(res.findings.length).toBe(1);
    expect(res.findings[0].type).toBe('valid_match');
  });

  it('gracefully handles malformed model output', () => {
    const malformed = 'I cannot output JSON today because of something.';
    const res = parseVerificationResponse(malformed);
    expect(res.findings.length).toBe(1);
    expect(res.findings[0].severity).toBe('warning');
    expect(res.reasoning).toContain('I cannot output JSON');
  });
});

describe('verifier: verifyWithHeuristics', () => {
  it('detects mismatched author when author name is missing from DOM', () => {
    const dom: ExtractedDomContent = {
      title: 'Understanding SolidJS',
      metaDescription: 'Learn SolidJS',
      headings: [{ level: 1, text: 'Understanding SolidJS' }],
      bodyText: 'Article written by Ryan Carniato about reactive primitives.',
      authorText: 'Ryan Carniato',
      structuredLists: [],
    };

    const schemas: ExtractedJsonLdSchema[] = [
      {
        id: '1',
        type: 'Article',
        scriptIndex: 0,
        raw: {
          '@type': 'Article',
          headline: 'Understanding SolidJS',
          author: { '@type': 'Person', name: 'Alice Hallucinated' },
        },
        properties: {},
      },
    ];

    const res = verifyWithHeuristics(dom, schemas);
    const authorFinding = res.findings.find((f) => f.type === 'mismatched_author');
    expect(authorFinding).toBeDefined();
    expect(authorFinding?.severity).toBe('error');
    expect(authorFinding?.expectedInSchema).toBe('Alice Hallucinated');
  });

  it('detects ghost steps in HowTo schema not found in DOM instructions', () => {
    const dom: ExtractedDomContent = {
      title: 'How to make Coffee',
      metaDescription: 'Brewing coffee',
      headings: [{ level: 1, text: 'How to make Coffee' }],
      bodyText: 'Step 1: Grind beans. Step 2: Pour boiling water over filter.',
      structuredLists: [['Grind beans.', 'Pour boiling water over filter.']],
    };

    const schemas: ExtractedJsonLdSchema[] = [
      {
        id: '1',
        type: 'HowTo',
        scriptIndex: 0,
        raw: {
          '@type': 'HowTo',
          name: 'How to make Coffee',
          step: [
            { '@type': 'HowToStep', text: 'Grind beans.' },
            { '@type': 'HowToStep', text: 'Pour boiling water over filter.' },
            { '@type': 'HowToStep', text: 'Ghost Step: Add secret mystical elixir.' },
          ],
        },
        properties: {},
      },
    ];

    const res = verifyWithHeuristics(dom, schemas);
    const ghost = res.findings.find((f) => f.type === 'ghost_step');
    expect(ghost).toBeDefined();
    expect(ghost?.expectedInSchema).toContain('Ghost Step');

    const validMatches = res.findings.filter((f) => f.type === 'valid_match');
    expect(validMatches.length).toBeGreaterThanOrEqual(2);
  });

  it('detects unstated FAQ questions not present in DOM', () => {
    const dom: ExtractedDomContent = {
      title: 'Frequently Asked Questions',
      metaDescription: 'FAQ',
      headings: [{ level: 1, text: 'Frequently Asked Questions' }],
      bodyText: 'Question: What is your return policy? You can return within 30 days.',
      structuredLists: [],
    };

    const schemas: ExtractedJsonLdSchema[] = [
      {
        id: '1',
        type: 'FAQPage',
        scriptIndex: 0,
        raw: {
          '@type': 'FAQPage',
          mainEntity: [
            {
              '@type': 'Question',
              name: 'What is your return policy?',
              acceptedAnswer: { '@type': 'Answer', text: 'Within 30 days.' },
            },
            {
              '@type': 'Question',
              name: 'Do you offer free international spaceship shipping?',
              acceptedAnswer: { '@type': 'Answer', text: 'Yes.' },
            },
          ],
        },
        properties: {},
      },
    ];

    const res = verifyWithHeuristics(dom, schemas);
    const unstatedFaq = res.findings.find(
      (f) => f.type === 'unstated_claim' && f.schemaType === 'FAQPage'
    );
    expect(unstatedFaq).toBeDefined();
    expect(unstatedFaq?.expectedInSchema).toContain('spaceship');
  });

  it('detects unstated product price in offers', () => {
    const dom: ExtractedDomContent = {
      title: 'Super Widget',
      metaDescription: 'Buy Super Widget',
      headings: [{ level: 1, text: 'Super Widget' }],
      bodyText: 'The Super Widget is now on sale for only $49.00 today.',
      structuredLists: [],
    };

    const schemas: ExtractedJsonLdSchema[] = [
      {
        id: '1',
        type: 'Product',
        scriptIndex: 0,
        raw: {
          '@type': 'Product',
          name: 'Super Widget',
          offers: {
            '@type': 'Offer',
            price: '999.00',
            priceCurrency: 'USD',
          },
        },
        properties: {},
      },
    ];

    const res = verifyWithHeuristics(dom, schemas);
    const priceFinding = res.findings.find((f) => f.property === 'offers[0].price');
    expect(priceFinding).toBeDefined();
    expect(priceFinding?.expectedInSchema).toBe('999.00');
  });
});

describe('verifier: verifySchemaLd integration', () => {
  it('runs complete audit on HTML document string', async () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Building Fast Astro Integrations</title>
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "Article",
              "headline": "Building Fast Astro Integrations",
              "author": {
                "@type": "Person",
                "name": "Alex Rivers"
              }
            }
          </script>
        </head>
        <body>
          <h1>Building Fast Astro Integrations</h1>
          <p class="author">By Alex Rivers</p>
          <p>Learn how to build blazing fast dev tools with Astro Dev Toolbar and Chrome AI.</p>
        </body>
      </html>
    `;

    const report = await verifySchemaLd(html);
    expect(report.status).toBe('passed');
    expect(report.stats.totalSchemas).toBe(1);
    expect(report.stats.errorsCount).toBe(0);
    expect(report.findings.some((f) => f.type === 'valid_match')).toBe(true);
    expect(report.executionTimeMs).toBeGreaterThanOrEqual(0);
  });
});
