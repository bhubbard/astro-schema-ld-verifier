/**
 * Core type definitions for astro-schema-ld-verifier
 */
export type FindingSeverity = 'error' | 'warning' | 'info' | 'success';
export type AuditFindingType = 'mismatched_author' | 'ghost_step' | 'unstated_claim' | 'missing_entity' | 'hallucinated_property' | 'syntax_error' | 'valid_match';
export interface AuditFinding {
    id: string;
    type: AuditFindingType;
    severity: FindingSeverity;
    schemaType: string;
    property: string;
    expectedInSchema: unknown;
    foundInDom: unknown;
    message: string;
    reasoning: string;
}
export interface JsonLdRawScript {
    id: string;
    rawText: string;
    parsed?: Record<string, unknown> | Array<Record<string, unknown>>;
    error?: string;
    index: number;
}
export interface ExtractedJsonLdSchema {
    id: string;
    type: string;
    raw: Record<string, unknown>;
    scriptIndex: number;
    properties: Record<string, unknown>;
}
export interface ParsedJsonLdResult {
    scripts: JsonLdRawScript[];
    schemas: ExtractedJsonLdSchema[];
    syntaxErrors: AuditFinding[];
    totalScripts: number;
    totalSchemas: number;
}
export interface ExtractedDomContent {
    title: string;
    metaDescription: string;
    headings: Array<{
        level: number;
        text: string;
    }>;
    bodyText: string;
    authorText?: string;
    structuredLists: string[][];
}
export type VerificationStatus = 'passed' | 'warning' | 'error' | 'unavailable';
export interface VerificationReport {
    status: VerificationStatus;
    schemasFound: ExtractedJsonLdSchema[];
    findings: AuditFinding[];
    stats: {
        totalSchemas: number;
        errorsCount: number;
        warningsCount: number;
        validMatchesCount: number;
        syntaxErrorsCount: number;
    };
    aiReasoning: string;
    tokensUsed?: number;
    executionTimeMs: number;
    modelUsed: string;
    timestamp: string;
}
export interface VerifierOptions {
    /** Maximum body text characters to feed to Gemini Nano prompt (default: 6000) */
    maxBodyLength?: number;
    /** Temperature for Gemini Nano model (default: 0.1 for high precision) */
    temperature?: number;
    /** Fallback to regex and heuristic verification if Chrome AI is unavailable (default: true) */
    fallbackToHeuristics?: boolean;
}
export interface SchemaLdVerifierOptions extends VerifierOptions {
    /** Enable or disable the dev toolbar integration (default: true) */
    enabled?: boolean;
    /** Log verification results to the browser dev console (default: true) */
    logToConsole?: boolean;
    /** Automatically run verification when the page loads (default: true) */
    autoVerify?: boolean;
}
//# sourceMappingURL=types.d.ts.map