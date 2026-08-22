/**
 * Chrome Built-in AI (Gemini Nano) and Heuristic Verifier for Schema.org JSON-LD
 */
import type { AuditFinding, ExtractedDomContent, ExtractedJsonLdSchema, VerificationReport, VerifierOptions } from './types.js';
/**
 * Builds the verification prompt for Gemini Nano
 */
export declare function buildVerificationPrompt(dom: ExtractedDomContent, schemas: ExtractedJsonLdSchema[], maxBodyLength?: number): string;
/**
 * Robustly parses AI JSON output
 */
export declare function parseVerificationResponse(responseText: string): {
    findings: AuditFinding[];
    reasoning: string;
};
/**
 * Checks if Chrome Built-in AI (Prompt API) is available in current environment
 */
export declare function isChromeAiAvailable(): Promise<boolean>;
/**
 * Heuristic semantic verification (used as fallback or in non-Chrome environments)
 */
export declare function verifyWithHeuristics(dom: ExtractedDomContent, schemas: ExtractedJsonLdSchema[]): {
    findings: AuditFinding[];
    reasoning: string;
};
/**
 * Verifies JSON-LD schemas against DOM content using Gemini Nano with heuristic fallback
 */
export declare function verifySchemaLd(source?: Document | HTMLElement | string, options?: VerifierOptions): Promise<VerificationReport>;
//# sourceMappingURL=verifier.d.ts.map