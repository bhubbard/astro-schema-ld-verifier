/**
 * JSON-LD script extractor and DOM content parser
 */

import type {
  ExtractedDomContent,
  ExtractedJsonLdSchema,
  JsonLdRawScript,
  ParsedJsonLdResult,
  AuditFinding,
} from './types.js';

/**
 * Normalizes text by trimming, collapsing spaces, and stripping control chars
 */
export function normalizeText(text: string): string {
  if (!text) return '';
  return text
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Parses JSON-LD script tags from a Document, HTMLElement, or HTML string
 */
export function extractJsonLdScripts(
  source?: Document | HTMLElement | string
): ParsedJsonLdResult {
  const scripts: JsonLdRawScript[] = [];
  const schemas: ExtractedJsonLdSchema[] = [];
  const syntaxErrors: AuditFinding[] = [];

  let scriptContents: string[] = [];

  if (typeof source === 'string') {
    // Regex extract for string HTML (SSR / Unit test environments without DOM)
    const regex = /<script\b[^>]*\btype=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(source)) !== null) {
      scriptContents.push(match[1]);
    }
  } else {
    // Browser DOM or DOM-like environment
    const root =
      source ||
      (typeof document !== 'undefined' ? document : null);

    if (root && typeof root.querySelectorAll === 'function') {
      const elements = root.querySelectorAll('script[type="application/ld+json"]');
      elements.forEach((el) => {
        scriptContents.push(el.textContent || '');
      });
    }
  }

  scriptContents.forEach((rawText, index) => {
    const trimmed = rawText.trim();
    if (!trimmed) return;

    const scriptRecord: JsonLdRawScript = {
      id: `script-${index}`,
      rawText: trimmed,
      index,
    };

    try {
      const parsed = JSON.parse(trimmed);
      scriptRecord.parsed = parsed;
      scripts.push(scriptRecord);

      // Extract schemas from parsed structure
      extractSchemasFromObject(parsed, index, schemas);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      scriptRecord.error = errorMsg;
      scripts.push(scriptRecord);

      syntaxErrors.push({
        id: `syntax-error-${index}`,
        type: 'syntax_error',
        severity: 'error',
        schemaType: 'Unknown',
        property: 'JSON.parse',
        expectedInSchema: 'Valid JSON-LD',
        foundInDom: trimmed.slice(0, 100) + (trimmed.length > 100 ? '...' : ''),
        message: `Malformed JSON-LD in <script type="application/ld+json">: ${errorMsg}`,
        reasoning: 'The script tag contains invalid JSON syntax and cannot be parsed by search engines or AI.',
      });
    }
  });

  return {
    scripts,
    schemas,
    syntaxErrors,
    totalScripts: scripts.length,
    totalSchemas: schemas.length,
  };
}

/**
 * Recursively flattens JSON-LD objects, arrays, and @graph nodes
 */
function extractSchemasFromObject(
  obj: unknown,
  scriptIndex: number,
  output: ExtractedJsonLdSchema[]
): void {
  if (!obj || typeof obj !== 'object') return;

  if (Array.isArray(obj)) {
    obj.forEach((item) => extractSchemasFromObject(item, scriptIndex, output));
    return;
  }

  const record = obj as Record<string, unknown>;

  // Check for @graph wrapper
  if (Array.isArray(record['@graph'])) {
    record['@graph'].forEach((item) => extractSchemasFromObject(item, scriptIndex, output));
    return;
  }

  // Check if this object represents a Schema.org entity
  const rawType = record['@type'] || record.type;
  if (rawType) {
    const typeStr = Array.isArray(rawType) ? rawType.join(', ') : String(rawType);
    const id = (record['@id'] ? String(record['@id']) : `schema-${output.length + 1}`);

    output.push({
      id,
      type: typeStr,
      raw: record,
      scriptIndex,
      properties: { ...record },
    });
  }
}

/**
 * Extracts visible body text and key metadata from DOM or HTML string
 */
export function extractDomContent(
  source?: Document | HTMLElement | string
): ExtractedDomContent {
  if (typeof source === 'string') {
    return extractDomContentFromString(source);
  }

  const root =
    source ||
    (typeof document !== 'undefined' ? document : null);

  if (!root) {
    return {
      title: '',
      metaDescription: '',
      headings: [],
      bodyText: '',
      structuredLists: [],
    };
  }

  const doc = 'body' in root ? (root as Document) : root.ownerDocument || document;

  // Title
  const titleEl = doc.querySelector('title');
  const title = titleEl ? titleEl.textContent || '' : '';

  // Meta description
  const metaDescEl = doc.querySelector('meta[name="description"]');
  const metaDescription = metaDescEl ? metaDescEl.getAttribute('content') || '' : '';

  // Headings
  const headings: Array<{ level: number; text: string }> = [];
  const headingEls = root.querySelectorAll('h1, h2, h3, h4, h5, h6');
  headingEls.forEach((h) => {
    const level = parseInt(h.tagName.substring(1), 10);
    const text = normalizeText(h.textContent || '');
    if (text) headings.push({ level, text });
  });

  // Author byline hints
  const authorSelectors = [
    '[rel="author"]',
    '[itemprop="author"]',
    '.author',
    '.byline',
    '.post-author',
    '.article-author',
  ];
  let authorText: string | undefined;
  for (const selector of authorSelectors) {
    const el = root.querySelector(selector);
    if (el && el.textContent) {
      authorText = normalizeText(el.textContent);
      break;
    }
  }

  // Structured Lists (for HowTo / Step audits)
  const structuredLists: string[][] = [];
  const listEls = root.querySelectorAll('ol, ul');
  listEls.forEach((list) => {
    // Avoid astro toolbar or nav/footer lists
    if (list.closest('astro-dev-toolbar, nav, footer, header')) return;
    const items: string[] = [];
    list.querySelectorAll(':scope > li').forEach((li) => {
      const text = normalizeText(li.textContent || '');
      if (text) items.push(text);
    });
    if (items.length > 0) structuredLists.push(items);
  });

  // Extract clean visible body text
  let bodyText = '';
  const bodyEl = 'body' in root ? (root as Document).body : (root as HTMLElement);
  if (bodyEl) {
    const clone = bodyEl.cloneNode(true) as HTMLElement;
    // Remove unwanted script, style, dev toolbar, svg, and hidden tags
    const toRemove = clone.querySelectorAll(
      'script, style, noscript, svg, astro-dev-toolbar, [aria-hidden="true"], [hidden]'
    );
    toRemove.forEach((el) => el.remove());
    bodyText = normalizeText(clone.textContent || '');
  }

  return {
    title: normalizeText(title),
    metaDescription: normalizeText(metaDescription),
    headings,
    bodyText,
    authorText,
    structuredLists,
  };
}

/**
 * Fallback parser for string HTML in non-browser environments
 */
function extractDomContentFromString(html: string): ExtractedDomContent {
  // Title
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? normalizeText(titleMatch[1]) : '';

  // Meta description
  const metaMatch = /<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i.exec(html) ||
    /<meta\b[^>]*content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i.exec(html);
  const metaDescription = metaMatch ? normalizeText(metaMatch[1]) : '';

  // Headings
  const headings: Array<{ level: number; text: string }> = [];
  const headingRegex = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let hMatch: RegExpExecArray | null;
  while ((hMatch = headingRegex.exec(html)) !== null) {
    const text = normalizeText(hMatch[2].replace(/<[^>]*>/g, ''));
    if (text) headings.push({ level: parseInt(hMatch[1], 10), text });
  }

  // Lists
  const structuredLists: string[][] = [];
  const listRegex = /<(ol|ul)[^>]*>([\s\S]*?)<\/\1>/gi;
  let lMatch: RegExpExecArray | null;
  while ((lMatch = listRegex.exec(html)) !== null) {
    const listInner = lMatch[2];
    const items: string[] = [];
    const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
    let liMatch: RegExpExecArray | null;
    while ((liMatch = liRegex.exec(listInner)) !== null) {
      const itemText = normalizeText(liMatch[1].replace(/<[^>]*>/g, ''));
      if (itemText) items.push(itemText);
    }
    if (items.length > 0) structuredLists.push(items);
  }

  // Clean body text by stripping scripts, styles, tags
  let cleaned = html
    .replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, '')
    .replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, '')
    .replace(/<noscript\b[^>]*>([\s\S]*?)<\/noscript>/gi, '')
    .replace(/<svg\b[^>]*>([\s\S]*?)<\/svg>/gi, '')
    .replace(/<[^>]+>/g, ' ');

  return {
    title,
    metaDescription,
    headings,
    bodyText: normalizeText(cleaned),
    structuredLists,
  };
}

/**
 * Prepares a clean, compact schema summary for prompt context
 */
export function summarizeSchemaForPrompt(schema: ExtractedJsonLdSchema): Record<string, unknown> {
  const result: Record<string, unknown> = {
    '@type': schema.type,
  };

  const raw = schema.raw;
  for (const [key, val] of Object.entries(raw)) {
    if (key === '@context') continue; // strip context to save token space
    result[key] = val;
  }

  return result;
}
