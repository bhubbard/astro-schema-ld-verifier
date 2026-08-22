/**
 * JSON-LD script extractor and DOM content parser
 */
import type { ExtractedDomContent, ExtractedJsonLdSchema, ParsedJsonLdResult } from './types.js';
/**
 * Normalizes text by trimming, collapsing spaces, and stripping control chars
 */
export declare function normalizeText(text: string): string;
/**
 * Parses JSON-LD script tags from a Document, HTMLElement, or HTML string
 */
export declare function extractJsonLdScripts(source?: Document | HTMLElement | string): ParsedJsonLdResult;
/**
 * Extracts visible body text and key metadata from DOM or HTML string
 */
export declare function extractDomContent(source?: Document | HTMLElement | string): ExtractedDomContent;
/**
 * Prepares a clean, compact schema summary for prompt context
 */
export declare function summarizeSchemaForPrompt(schema: ExtractedJsonLdSchema): Record<string, unknown>;
//# sourceMappingURL=parser.d.ts.map