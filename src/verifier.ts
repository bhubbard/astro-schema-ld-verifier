/**
 * Chrome Built-in AI (Gemini Nano) and Heuristic Verifier for Schema.org JSON-LD
 */

import {
  extractDomContent,
  extractJsonLdScripts,
  normalizeText,
  summarizeSchemaForPrompt,
} from './parser.js';
import type {
  AuditFinding,
  ExtractedDomContent,
  ExtractedJsonLdSchema,
  ParsedJsonLdResult,
  VerificationReport,
  VerificationStatus,
  VerifierOptions,
} from './types.js';

const SYSTEM_PROMPT = `You are a precision Schema.org and JSON-LD semantic validator.
Your role is to compare the structured JSON-LD data against the actual rendered DOM content of a web page.
Detect:
1. "mismatched_author": Schema author does not match byline/DOM author.
2. "ghost_step": HowTo or recipe steps listed in JSON-LD that DO NOT exist in the page text.
3. "unstated_claim": Ratings, prices, claims, or FAQ answers claimed in JSON-LD but not stated in the page.
4. "hallucinated_property": Fabricated attributes or specifications in schema not supported by DOM.
5. "missing_entity": Critical visible content on page that has no representation in schema.
6. "valid_match": Verified schema attributes that accurately reflect the page text.

Always output ONLY valid JSON matching this schema:
{
  "findings": [
    {
      "type": "mismatched_author" | "ghost_step" | "unstated_claim" | "missing_entity" | "hallucinated_property" | "valid_match",
      "severity": "error" | "warning" | "info" | "success",
      "schemaType": "string",
      "property": "string",
      "expectedInSchema": "string or object",
      "foundInDom": "string or null",
      "message": "Clear explanation of the issue or confirmation",
      "reasoning": "Logical deduction based on DOM vs schema"
    }
  ],
  "reasoning": "Overall summary of the semantic alignment"
}`;

/**
 * Builds the verification prompt for Gemini Nano
 */
export function buildVerificationPrompt(
  dom: ExtractedDomContent,
  schemas: ExtractedJsonLdSchema[],
  maxBodyLength = 6000
): string {
  const truncatedBody = dom.bodyText.length > maxBodyLength
    ? dom.bodyText.slice(0, maxBodyLength) + '... [truncated]'
    : dom.bodyText;

  const schemaSummaries = schemas.map((s) => summarizeSchemaForPrompt(s));

  const promptObj = {
    task: 'Validate JSON-LD schema against DOM text content',
    domContent: {
      pageTitle: dom.title,
      metaDescription: dom.metaDescription,
      headings: dom.headings.map((h) => `H${h.level}: ${h.text}`),
      authorHint: dom.authorText || 'None detected in DOM',
      bodyTextExcerpt: truncatedBody,
      structuredLists: dom.structuredLists,
    },
    jsonLdSchemas: schemaSummaries,
  };

  return `Compare the following JSON-LD schemas with the page DOM content:\n\n${JSON.stringify(
    promptObj,
    null,
    2
  )}\n\nRespond with valid JSON containing the findings array and overall reasoning.`;
}

/**
 * Robustly parses AI JSON output
 */
export function parseVerificationResponse(
  responseText: string
): { findings: AuditFinding[]; reasoning: string } {
  let cleanText = responseText.trim();

  // Strip markdown code fences if present
  if (cleanText.startsWith('```')) {
    cleanText = cleanText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
  }

  try {
    const parsed = JSON.parse(cleanText);
    const rawFindings = Array.isArray(parsed.findings) ? parsed.findings : [];
    const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning : 'Verification completed.';

    const findings: AuditFinding[] = rawFindings.map((f: Record<string, unknown>, idx: number) => {
      const id = `finding-ai-${idx + 1}-${Date.now()}`;
      return {
        id,
        type: (f.type as AuditFinding['type']) || 'unstated_claim',
        severity: (f.severity as AuditFinding['severity']) || 'warning',
        schemaType: String(f.schemaType || 'Unknown'),
        property: String(f.property || 'schema'),
        expectedInSchema: f.expectedInSchema ?? '',
        foundInDom: f.foundInDom ?? '',
        message: String(f.message || 'Semantic mismatch detected'),
        reasoning: String(f.reasoning || ''),
      };
    });

    return { findings, reasoning };
  } catch {
    // If strict JSON parsing fails, extract potential JSON substring
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const fallbackParsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(fallbackParsed.findings)) {
          return {
            findings: fallbackParsed.findings.map((f: Record<string, unknown>, idx: number) => ({
              id: `finding-fallback-${idx + 1}`,
              type: (f.type as AuditFinding['type']) || 'unstated_claim',
              severity: (f.severity as AuditFinding['severity']) || 'warning',
              schemaType: String(f.schemaType || 'Unknown'),
              property: String(f.property || 'schema'),
              expectedInSchema: f.expectedInSchema ?? '',
              foundInDom: f.foundInDom ?? '',
              message: String(f.message || 'Semantic mismatch detected'),
              reasoning: String(f.reasoning || ''),
            })),
            reasoning: fallbackParsed.reasoning || 'Verification completed with fallback extraction.',
          };
        }
      } catch {
        // Ignore fallback error and return raw response finding
      }
    }

    return {
      findings: [
        {
          id: `finding-parse-err-${Date.now()}`,
          type: 'unstated_claim',
          severity: 'warning',
          schemaType: 'AI Model',
          property: 'response',
          expectedInSchema: 'JSON formatted result',
          foundInDom: responseText.slice(0, 150),
          message: 'AI response could not be fully parsed into structured findings.',
          reasoning: responseText,
        },
      ],
      reasoning: responseText,
    };
  }
}

/**
 * Checks if Chrome Built-in AI (Prompt API) is available in current environment
 */
export async function isChromeAiAvailable(): Promise<boolean> {
  try {
    const aiApi = typeof window !== 'undefined' ? window.ai : typeof ai !== 'undefined' ? ai : undefined;
    if (!aiApi || !aiApi.languageModel) return false;

    const capabilities = await aiApi.languageModel.capabilities();
    return capabilities.available === 'readily' || capabilities.available === 'after-download';
  } catch {
    return false;
  }
}

/**
 * Heuristic semantic verification (used as fallback or in non-Chrome environments)
 */
export function verifyWithHeuristics(
  dom: ExtractedDomContent,
  schemas: ExtractedJsonLdSchema[]
): { findings: AuditFinding[]; reasoning: string } {
  const findings: AuditFinding[] = [];
  const bodyLower = dom.bodyText.toLowerCase();
  const titleLower = dom.title.toLowerCase();

  schemas.forEach((schema, sIdx) => {
    const type = schema.type;
    const raw = schema.raw;

    // 1. Check Author Consistency (Article, NewsArticle, BlogPosting, Review)
    if (raw.author) {
      let authorNames: string[] = [];
      if (typeof raw.author === 'string') {
        authorNames = [raw.author];
      } else if (typeof raw.author === 'object' && raw.author !== null) {
        if (Array.isArray(raw.author)) {
          authorNames = raw.author.map((a) => (typeof a === 'object' && a !== null ? String(a.name || '') : String(a))).filter(Boolean);
        } else {
          const name = (raw.author as { name?: string }).name;
          if (name) authorNames = [String(name)];
        }
      }

      authorNames.forEach((authorName) => {
        const nameLower = authorName.toLowerCase();
        const foundInBody = bodyLower.includes(nameLower);
        const foundInAuthorHint = dom.authorText && dom.authorText.toLowerCase().includes(nameLower);

        if (!foundInBody && !foundInAuthorHint) {
          findings.push({
            id: `heur-author-${sIdx}-${Date.now()}`,
            type: 'mismatched_author',
            severity: 'error',
            schemaType: type,
            property: 'author.name',
            expectedInSchema: authorName,
            foundInDom: dom.authorText || 'None found in DOM',
            message: `Author "${authorName}" in JSON-LD was not found anywhere in the page body or byline.`,
            reasoning: `Search engines may flag this schema if the stated author cannot be found in the visible DOM.`,
          });
        } else {
          findings.push({
            id: `heur-author-match-${sIdx}`,
            type: 'valid_match',
            severity: 'success',
            schemaType: type,
            property: 'author.name',
            expectedInSchema: authorName,
            foundInDom: dom.authorText || authorName,
            message: `Author "${authorName}" matches visible page content.`,
            reasoning: 'Author verified in DOM.',
          });
        }
      });
    }

    // 2. Check HowTo & Recipe Steps (Ghost Steps)
    if (type.includes('HowTo') || type.includes('Recipe')) {
      const steps = raw.step || raw.recipeInstructions || [];
      const stepArray = Array.isArray(steps) ? steps : [steps];

      stepArray.forEach((step, stepIdx) => {
        let stepText = '';
        if (typeof step === 'string') {
          stepText = step;
        } else if (typeof step === 'object' && step !== null) {
          stepText = String(step.text || step.name || '');
        }

        if (stepText) {
          const stepSnippet = stepText.slice(0, 40).toLowerCase();
          const inBody = bodyLower.includes(stepSnippet);
          const inLists = dom.structuredLists.some((list) =>
            list.some((item) => item.toLowerCase().includes(stepSnippet))
          );

          if (!inBody && !inLists) {
            findings.push({
              id: `heur-step-${sIdx}-${stepIdx}`,
              type: 'ghost_step',
              severity: 'error',
              schemaType: type,
              property: `step[${stepIdx}]`,
              expectedInSchema: stepText,
              foundInDom: null,
              message: `Ghost Step: Step "${stepText.slice(0, 50)}..." in JSON-LD is not present in the visible page instructions.`,
              reasoning: `Schema contains instructional steps that visitors cannot read on the rendered page.`,
            });
          } else {
            findings.push({
              id: `heur-step-match-${sIdx}-${stepIdx}`,
              type: 'valid_match',
              severity: 'success',
              schemaType: type,
              property: `step[${stepIdx}]`,
              expectedInSchema: stepText.slice(0, 50),
              foundInDom: 'Visible in DOM',
              message: `Step ${stepIdx + 1} confirmed present on page.`,
              reasoning: 'Step text found in body or list items.',
            });
          }
        }
      });
    }

    // 3. Check FAQPage (Questions and Answers)
    if (type.includes('FAQPage')) {
      const mainEntities = raw.mainEntity;
      const questions = Array.isArray(mainEntities) ? mainEntities : mainEntities ? [mainEntities] : [];

      questions.forEach((q, qIdx) => {
        if (typeof q === 'object' && q !== null) {
          const qName = String(q.name || '');
          if (qName) {
            const qSnippet = qName.slice(0, 30).toLowerCase();
            const inBody = bodyLower.includes(qSnippet);

            if (!inBody) {
              findings.push({
                id: `heur-faq-q-${sIdx}-${qIdx}`,
                type: 'unstated_claim',
                severity: 'warning',
                schemaType: 'FAQPage',
                property: `mainEntity[${qIdx}].name`,
                expectedInSchema: qName,
                foundInDom: null,
                message: `FAQ Question "${qName}" in JSON-LD does not appear in page text.`,
                reasoning: `Google guidelines require all FAQ schema questions and answers to be visible to users.`,
              });
            } else {
              findings.push({
                id: `heur-faq-match-${sIdx}-${qIdx}`,
                type: 'valid_match',
                severity: 'success',
                schemaType: 'FAQPage',
                property: `mainEntity[${qIdx}].name`,
                expectedInSchema: qName,
                foundInDom: 'Visible in DOM',
                message: `FAQ Question verified in DOM.`,
                reasoning: 'Question text matches page content.',
              });
            }
          }
        }
      });
    }

    // 4. Check Product / Offer Prices
    if (type.includes('Product')) {
      const offers = raw.offers;
      const offerArray = Array.isArray(offers) ? offers : offers ? [offers] : [];

      offerArray.forEach((offer, oIdx) => {
        if (typeof offer === 'object' && offer !== null && offer.price !== undefined) {
          const priceStr = String(offer.price);
          const inBody = bodyLower.includes(priceStr);

          if (!inBody) {
            findings.push({
              id: `heur-price-${sIdx}-${oIdx}`,
              type: 'unstated_claim',
              severity: 'warning',
              schemaType: 'Product',
              property: `offers[${oIdx}].price`,
              expectedInSchema: priceStr,
              foundInDom: null,
              message: `Product price "${priceStr}" in JSON-LD does not match any visible price in the DOM text.`,
              reasoning: 'Unstated prices in schema risk search penalty for misleading structured data.',
            });
          }
        }
      });
    }

    // 5. Check Article / Page Headline / Name
    if (raw.headline || raw.name) {
      const titleProp = String(raw.headline || raw.name);
      const titleSnippet = titleProp.slice(0, 25).toLowerCase();
      const inTitle = titleLower.includes(titleSnippet);
      const inHeadings = dom.headings.some((h) => h.text.toLowerCase().includes(titleSnippet));
      const inBody = bodyLower.includes(titleSnippet);

      if (!inTitle && !inHeadings && !inBody) {
        findings.push({
          id: `heur-headline-${sIdx}`,
          type: 'unstated_claim',
          severity: 'warning',
          schemaType: type,
          property: raw.headline ? 'headline' : 'name',
          expectedInSchema: titleProp,
          foundInDom: dom.title || 'Different title',
          message: `Schema title/headline "${titleProp}" differs substantially from DOM title and headings.`,
          reasoning: 'Primary entity name should match visible document heading.',
        });
      } else {
        findings.push({
          id: `heur-headline-match-${sIdx}`,
          type: 'valid_match',
          severity: 'success',
          schemaType: type,
          property: raw.headline ? 'headline' : 'name',
          expectedInSchema: titleProp,
          foundInDom: dom.title || titleProp,
          message: `Headline matches page title or heading.`,
          reasoning: 'Verified matching headline.',
        });
      }
    }
  });

  return {
    findings,
    reasoning: `Heuristic semantic verification analyzed ${schemas.length} schema(s) against DOM content. Verified author, steps, headlines, FAQs, and pricing strings.`,
  };
}

/**
 * Verifies JSON-LD schemas against DOM content using Gemini Nano with heuristic fallback
 */
export async function verifySchemaLd(
  source?: Document | HTMLElement | string,
  options: VerifierOptions = {}
): Promise<VerificationReport> {
  const startTime = performance.now();

  const parsedResult: ParsedJsonLdResult = extractJsonLdScripts(source);
  const domContent: ExtractedDomContent = extractDomContent(source);

  const findings: AuditFinding[] = [...parsedResult.syntaxErrors];
  let aiReasoning = '';
  let modelUsed = 'Heuristic Engine (Fallback)';
  let tokensUsed: number | undefined;

  const hasSchemas = parsedResult.schemas.length > 0;

  if (hasSchemas) {
    const aiAvailable = await isChromeAiAvailable();

    if (aiAvailable) {
      try {
        const aiApi = typeof window !== 'undefined' ? window.ai : typeof ai !== 'undefined' ? ai : undefined;
        if (aiApi?.languageModel) {
          const session = await aiApi.languageModel.create({
            systemPrompt: SYSTEM_PROMPT,
            temperature: options.temperature ?? 0.1,
          });

          const promptText = buildVerificationPrompt(
            domContent,
            parsedResult.schemas,
            options.maxBodyLength
          );

          if (typeof session.countPromptTokens === 'function') {
            try {
              tokensUsed = await session.countPromptTokens(promptText);
            } catch {
              // Token count is optional
            }
          }

          const response = await session.prompt(promptText);
          session.destroy();

          const aiParsed = parseVerificationResponse(response);
          findings.push(...aiParsed.findings);
          aiReasoning = aiParsed.reasoning;
          modelUsed = 'Gemini Nano (Chrome Built-in AI)';
        }
      } catch (err) {
        // Fallback to heuristics if AI prompt failed
        if (options.fallbackToHeuristics !== false) {
          const heuristicResult = verifyWithHeuristics(domContent, parsedResult.schemas);
          findings.push(...heuristicResult.findings);
          aiReasoning = `AI session error (${err instanceof Error ? err.message : String(err)}). Reverted to heuristics.`;
          modelUsed = 'Heuristic Engine (Fallback after AI error)';
        }
      }
    } else if (options.fallbackToHeuristics !== false) {
      const heuristicResult = verifyWithHeuristics(domContent, parsedResult.schemas);
      findings.push(...heuristicResult.findings);
      aiReasoning = heuristicResult.reasoning;
      modelUsed = 'Heuristic Engine (Fallback)';
    }
  } else if (parsedResult.syntaxErrors.length === 0) {
    findings.push({
      id: 'no-schemas-found',
      type: 'missing_entity',
      severity: 'info',
      schemaType: 'None',
      property: 'script[type="application/ld+json"]',
      expectedInSchema: 'Structured data (e.g. Article, WebSite, Organization)',
      foundInDom: 'No JSON-LD scripts found',
      message: 'No JSON-LD structured data scripts were found on this page.',
      reasoning: 'Consider adding Schema.org structured data to enhance search engine snippet rendering.',
    });
    aiReasoning = 'No JSON-LD scripts detected on page.';
  }

  const executionTimeMs = Math.round(performance.now() - startTime);

  const errorsCount = findings.filter((f) => f.severity === 'error').length;
  const warningsCount = findings.filter((f) => f.severity === 'warning').length;
  const validMatchesCount = findings.filter((f) => f.severity === 'success').length;
  const syntaxErrorsCount = parsedResult.syntaxErrors.length;

  let status: VerificationStatus = 'passed';
  if (errorsCount > 0) {
    status = 'error';
  } else if (warningsCount > 0) {
    status = 'warning';
  }

  return {
    status,
    schemasFound: parsedResult.schemas,
    findings,
    stats: {
      totalSchemas: parsedResult.totalSchemas,
      errorsCount,
      warningsCount,
      validMatchesCount,
      syntaxErrorsCount,
    },
    aiReasoning,
    tokensUsed,
    executionTimeMs,
    modelUsed,
    timestamp: new Date().toISOString(),
  };
}
