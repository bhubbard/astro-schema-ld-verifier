/**
 * Astro Integration: astro-schema-ld-verifier
 * Dev-time validation Astro Dev Toolbar plugin powered by Chrome Built-in AI (Gemini Nano)
 */

import type { AstroIntegration } from 'astro';
import type { SchemaLdVerifierOptions } from './types.js';

export * from './types.js';
export {
  extractJsonLdScripts,
  extractDomContent,
  normalizeText,
  summarizeSchemaForPrompt,
} from './parser.js';
export {
  verifySchemaLd,
  verifyWithHeuristics,
  buildVerificationPrompt,
  parseVerificationResponse,
  isChromeAiAvailable,
} from './verifier.js';

const APP_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="m9 15 2 2 4-4"/></svg>`;

export default function schemaLdVerifier(
  options: SchemaLdVerifierOptions = {}
): AstroIntegration {
  return {
    name: 'astro-schema-ld-verifier',
    hooks: {
      'astro:config:setup': ({ addDevToolbarApp }) => {
        if (options.enabled === false) return;

        // Resolve entrypoint to toolbar app
        const appPath = new URL('./app.js', import.meta.url).pathname;

        addDevToolbarApp({
          id: 'astro-schema-ld-verifier',
          name: 'Schema.org LD Verifier',
          icon: APP_ICON,
          entrypoint: appPath,
        });
      },
    },
  };
}
