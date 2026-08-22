/**
 * Astro Integration: astro-schema-ld-verifier
 * Dev-time validation Astro Dev Toolbar plugin powered by Chrome Built-in AI (Gemini Nano)
 */
import type { AstroIntegration } from 'astro';
import type { SchemaLdVerifierOptions } from './types.js';
export * from './types.js';
export { extractJsonLdScripts, extractDomContent, normalizeText, summarizeSchemaForPrompt, } from './parser.js';
export { verifySchemaLd, verifyWithHeuristics, buildVerificationPrompt, parseVerificationResponse, isChromeAiAvailable, } from './verifier.js';
export default function schemaLdVerifier(options?: SchemaLdVerifierOptions): AstroIntegration;
//# sourceMappingURL=index.d.ts.map