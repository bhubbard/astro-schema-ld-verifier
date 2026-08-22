// src/parser.ts
function normalizeText(text) {
  if (!text)
    return "";
  return text.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
}
function extractJsonLdScripts(source) {
  const scripts = [];
  const schemas = [];
  const syntaxErrors = [];
  let scriptContents = [];
  if (typeof source === "string") {
    const regex = /<script\b[^>]*\btype=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = regex.exec(source)) !== null) {
      scriptContents.push(match[1]);
    }
  } else {
    const root = source || (typeof document !== "undefined" ? document : null);
    if (root && typeof root.querySelectorAll === "function") {
      const elements = root.querySelectorAll('script[type="application/ld+json"]');
      elements.forEach((el) => {
        scriptContents.push(el.textContent || "");
      });
    }
  }
  scriptContents.forEach((rawText, index) => {
    const trimmed = rawText.trim();
    if (!trimmed)
      return;
    const scriptRecord = {
      id: `script-${index}`,
      rawText: trimmed,
      index
    };
    try {
      const parsed = JSON.parse(trimmed);
      scriptRecord.parsed = parsed;
      scripts.push(scriptRecord);
      extractSchemasFromObject(parsed, index, schemas);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      scriptRecord.error = errorMsg;
      scripts.push(scriptRecord);
      syntaxErrors.push({
        id: `syntax-error-${index}`,
        type: "syntax_error",
        severity: "error",
        schemaType: "Unknown",
        property: "JSON.parse",
        expectedInSchema: "Valid JSON-LD",
        foundInDom: trimmed.slice(0, 100) + (trimmed.length > 100 ? "..." : ""),
        message: `Malformed JSON-LD in <script type="application/ld+json">: ${errorMsg}`,
        reasoning: "The script tag contains invalid JSON syntax and cannot be parsed by search engines or AI."
      });
    }
  });
  return {
    scripts,
    schemas,
    syntaxErrors,
    totalScripts: scripts.length,
    totalSchemas: schemas.length
  };
}
function extractSchemasFromObject(obj, scriptIndex, output) {
  if (!obj || typeof obj !== "object")
    return;
  if (Array.isArray(obj)) {
    obj.forEach((item) => extractSchemasFromObject(item, scriptIndex, output));
    return;
  }
  const record = obj;
  if (Array.isArray(record["@graph"])) {
    record["@graph"].forEach((item) => extractSchemasFromObject(item, scriptIndex, output));
    return;
  }
  const rawType = record["@type"] || record.type;
  if (rawType) {
    const typeStr = Array.isArray(rawType) ? rawType.join(", ") : String(rawType);
    const id = record["@id"] ? String(record["@id"]) : `schema-${output.length + 1}`;
    output.push({
      id,
      type: typeStr,
      raw: record,
      scriptIndex,
      properties: { ...record }
    });
  }
}
function extractDomContent(source) {
  if (typeof source === "string") {
    return extractDomContentFromString(source);
  }
  const root = source || (typeof document !== "undefined" ? document : null);
  if (!root) {
    return {
      title: "",
      metaDescription: "",
      headings: [],
      bodyText: "",
      structuredLists: []
    };
  }
  const doc = "body" in root ? root : root.ownerDocument || document;
  const titleEl = doc.querySelector("title");
  const title = titleEl ? titleEl.textContent || "" : "";
  const metaDescEl = doc.querySelector('meta[name="description"]');
  const metaDescription = metaDescEl ? metaDescEl.getAttribute("content") || "" : "";
  const headings = [];
  const headingEls = root.querySelectorAll("h1, h2, h3, h4, h5, h6");
  headingEls.forEach((h) => {
    const level = parseInt(h.tagName.substring(1), 10);
    const text = normalizeText(h.textContent || "");
    if (text)
      headings.push({ level, text });
  });
  const authorSelectors = [
    '[rel="author"]',
    '[itemprop="author"]',
    ".author",
    ".byline",
    ".post-author",
    ".article-author"
  ];
  let authorText;
  for (const selector of authorSelectors) {
    const el = root.querySelector(selector);
    if (el && el.textContent) {
      authorText = normalizeText(el.textContent);
      break;
    }
  }
  const structuredLists = [];
  const listEls = root.querySelectorAll("ol, ul");
  listEls.forEach((list) => {
    if (list.closest("astro-dev-toolbar, nav, footer, header"))
      return;
    const items = [];
    list.querySelectorAll(":scope > li").forEach((li) => {
      const text = normalizeText(li.textContent || "");
      if (text)
        items.push(text);
    });
    if (items.length > 0)
      structuredLists.push(items);
  });
  let bodyText = "";
  const bodyEl = "body" in root ? root.body : root;
  if (bodyEl) {
    const clone = bodyEl.cloneNode(true);
    const toRemove = clone.querySelectorAll('script, style, noscript, svg, astro-dev-toolbar, [aria-hidden="true"], [hidden]');
    toRemove.forEach((el) => el.remove());
    bodyText = normalizeText(clone.textContent || "");
  }
  return {
    title: normalizeText(title),
    metaDescription: normalizeText(metaDescription),
    headings,
    bodyText,
    authorText,
    structuredLists
  };
}
function extractDomContentFromString(html) {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? normalizeText(titleMatch[1]) : "";
  const metaMatch = /<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i.exec(html) || /<meta\b[^>]*content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i.exec(html);
  const metaDescription = metaMatch ? normalizeText(metaMatch[1]) : "";
  const headings = [];
  const headingRegex = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let hMatch;
  while ((hMatch = headingRegex.exec(html)) !== null) {
    const text = normalizeText(hMatch[2].replace(/<[^>]*>/g, ""));
    if (text)
      headings.push({ level: parseInt(hMatch[1], 10), text });
  }
  const structuredLists = [];
  const listRegex = /<(ol|ul)[^>]*>([\s\S]*?)<\/\1>/gi;
  let lMatch;
  while ((lMatch = listRegex.exec(html)) !== null) {
    const listInner = lMatch[2];
    const items = [];
    const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
    let liMatch;
    while ((liMatch = liRegex.exec(listInner)) !== null) {
      const itemText = normalizeText(liMatch[1].replace(/<[^>]*>/g, ""));
      if (itemText)
        items.push(itemText);
    }
    if (items.length > 0)
      structuredLists.push(items);
  }
  let cleaned = html.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, "").replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, "").replace(/<noscript\b[^>]*>([\s\S]*?)<\/noscript>/gi, "").replace(/<svg\b[^>]*>([\s\S]*?)<\/svg>/gi, "").replace(/<[^>]+>/g, " ");
  return {
    title,
    metaDescription,
    headings,
    bodyText: normalizeText(cleaned),
    structuredLists
  };
}
function summarizeSchemaForPrompt(schema) {
  const result = {
    "@type": schema.type
  };
  const raw = schema.raw;
  for (const [key, val] of Object.entries(raw)) {
    if (key === "@context")
      continue;
    result[key] = val;
  }
  return result;
}

// src/verifier.ts
var SYSTEM_PROMPT = `You are a precision Schema.org and JSON-LD semantic validator.
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
function buildVerificationPrompt(dom, schemas, maxBodyLength = 6000) {
  const truncatedBody = dom.bodyText.length > maxBodyLength ? dom.bodyText.slice(0, maxBodyLength) + "... [truncated]" : dom.bodyText;
  const schemaSummaries = schemas.map((s) => summarizeSchemaForPrompt(s));
  const promptObj = {
    task: "Validate JSON-LD schema against DOM text content",
    domContent: {
      pageTitle: dom.title,
      metaDescription: dom.metaDescription,
      headings: dom.headings.map((h) => `H${h.level}: ${h.text}`),
      authorHint: dom.authorText || "None detected in DOM",
      bodyTextExcerpt: truncatedBody,
      structuredLists: dom.structuredLists
    },
    jsonLdSchemas: schemaSummaries
  };
  return `Compare the following JSON-LD schemas with the page DOM content:

${JSON.stringify(promptObj, null, 2)}

Respond with valid JSON containing the findings array and overall reasoning.`;
}
function parseVerificationResponse(responseText) {
  let cleanText = responseText.trim();
  if (cleanText.startsWith("```")) {
    cleanText = cleanText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  }
  try {
    const parsed = JSON.parse(cleanText);
    const rawFindings = Array.isArray(parsed.findings) ? parsed.findings : [];
    const reasoning = typeof parsed.reasoning === "string" ? parsed.reasoning : "Verification completed.";
    const findings = rawFindings.map((f, idx) => {
      const id = `finding-ai-${idx + 1}-${Date.now()}`;
      return {
        id,
        type: f.type || "unstated_claim",
        severity: f.severity || "warning",
        schemaType: String(f.schemaType || "Unknown"),
        property: String(f.property || "schema"),
        expectedInSchema: f.expectedInSchema ?? "",
        foundInDom: f.foundInDom ?? "",
        message: String(f.message || "Semantic mismatch detected"),
        reasoning: String(f.reasoning || "")
      };
    });
    return { findings, reasoning };
  } catch {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const fallbackParsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(fallbackParsed.findings)) {
          return {
            findings: fallbackParsed.findings.map((f, idx) => ({
              id: `finding-fallback-${idx + 1}`,
              type: f.type || "unstated_claim",
              severity: f.severity || "warning",
              schemaType: String(f.schemaType || "Unknown"),
              property: String(f.property || "schema"),
              expectedInSchema: f.expectedInSchema ?? "",
              foundInDom: f.foundInDom ?? "",
              message: String(f.message || "Semantic mismatch detected"),
              reasoning: String(f.reasoning || "")
            })),
            reasoning: fallbackParsed.reasoning || "Verification completed with fallback extraction."
          };
        }
      } catch {}
    }
    return {
      findings: [
        {
          id: `finding-parse-err-${Date.now()}`,
          type: "unstated_claim",
          severity: "warning",
          schemaType: "AI Model",
          property: "response",
          expectedInSchema: "JSON formatted result",
          foundInDom: responseText.slice(0, 150),
          message: "AI response could not be fully parsed into structured findings.",
          reasoning: responseText
        }
      ],
      reasoning: responseText
    };
  }
}
async function isChromeAiAvailable() {
  try {
    const aiApi = typeof window !== "undefined" ? window.ai : typeof ai !== "undefined" ? ai : undefined;
    if (!aiApi || !aiApi.languageModel)
      return false;
    const capabilities = await aiApi.languageModel.capabilities();
    return capabilities.available === "readily" || capabilities.available === "after-download";
  } catch {
    return false;
  }
}
function verifyWithHeuristics(dom, schemas) {
  const findings = [];
  const bodyLower = dom.bodyText.toLowerCase();
  const titleLower = dom.title.toLowerCase();
  schemas.forEach((schema, sIdx) => {
    const type = schema.type;
    const raw = schema.raw;
    if (raw.author) {
      let authorNames = [];
      if (typeof raw.author === "string") {
        authorNames = [raw.author];
      } else if (typeof raw.author === "object" && raw.author !== null) {
        if (Array.isArray(raw.author)) {
          authorNames = raw.author.map((a) => typeof a === "object" && a !== null ? String(a.name || "") : String(a)).filter(Boolean);
        } else {
          const name = raw.author.name;
          if (name)
            authorNames = [String(name)];
        }
      }
      authorNames.forEach((authorName) => {
        const nameLower = authorName.toLowerCase();
        const foundInBody = bodyLower.includes(nameLower);
        const foundInAuthorHint = dom.authorText && dom.authorText.toLowerCase().includes(nameLower);
        if (!foundInBody && !foundInAuthorHint) {
          findings.push({
            id: `heur-author-${sIdx}-${Date.now()}`,
            type: "mismatched_author",
            severity: "error",
            schemaType: type,
            property: "author.name",
            expectedInSchema: authorName,
            foundInDom: dom.authorText || "None found in DOM",
            message: `Author "${authorName}" in JSON-LD was not found anywhere in the page body or byline.`,
            reasoning: `Search engines may flag this schema if the stated author cannot be found in the visible DOM.`
          });
        } else {
          findings.push({
            id: `heur-author-match-${sIdx}`,
            type: "valid_match",
            severity: "success",
            schemaType: type,
            property: "author.name",
            expectedInSchema: authorName,
            foundInDom: dom.authorText || authorName,
            message: `Author "${authorName}" matches visible page content.`,
            reasoning: "Author verified in DOM."
          });
        }
      });
    }
    if (type.includes("HowTo") || type.includes("Recipe")) {
      const steps = raw.step || raw.recipeInstructions || [];
      const stepArray = Array.isArray(steps) ? steps : [steps];
      stepArray.forEach((step, stepIdx) => {
        let stepText = "";
        if (typeof step === "string") {
          stepText = step;
        } else if (typeof step === "object" && step !== null) {
          stepText = String(step.text || step.name || "");
        }
        if (stepText) {
          const stepSnippet = stepText.slice(0, 40).toLowerCase();
          const inBody = bodyLower.includes(stepSnippet);
          const inLists = dom.structuredLists.some((list) => list.some((item) => item.toLowerCase().includes(stepSnippet)));
          if (!inBody && !inLists) {
            findings.push({
              id: `heur-step-${sIdx}-${stepIdx}`,
              type: "ghost_step",
              severity: "error",
              schemaType: type,
              property: `step[${stepIdx}]`,
              expectedInSchema: stepText,
              foundInDom: null,
              message: `Ghost Step: Step "${stepText.slice(0, 50)}..." in JSON-LD is not present in the visible page instructions.`,
              reasoning: `Schema contains instructional steps that visitors cannot read on the rendered page.`
            });
          } else {
            findings.push({
              id: `heur-step-match-${sIdx}-${stepIdx}`,
              type: "valid_match",
              severity: "success",
              schemaType: type,
              property: `step[${stepIdx}]`,
              expectedInSchema: stepText.slice(0, 50),
              foundInDom: "Visible in DOM",
              message: `Step ${stepIdx + 1} confirmed present on page.`,
              reasoning: "Step text found in body or list items."
            });
          }
        }
      });
    }
    if (type.includes("FAQPage")) {
      const mainEntities = raw.mainEntity;
      const questions = Array.isArray(mainEntities) ? mainEntities : mainEntities ? [mainEntities] : [];
      questions.forEach((q, qIdx) => {
        if (typeof q === "object" && q !== null) {
          const qName = String(q.name || "");
          if (qName) {
            const qSnippet = qName.slice(0, 30).toLowerCase();
            const inBody = bodyLower.includes(qSnippet);
            if (!inBody) {
              findings.push({
                id: `heur-faq-q-${sIdx}-${qIdx}`,
                type: "unstated_claim",
                severity: "warning",
                schemaType: "FAQPage",
                property: `mainEntity[${qIdx}].name`,
                expectedInSchema: qName,
                foundInDom: null,
                message: `FAQ Question "${qName}" in JSON-LD does not appear in page text.`,
                reasoning: `Google guidelines require all FAQ schema questions and answers to be visible to users.`
              });
            } else {
              findings.push({
                id: `heur-faq-match-${sIdx}-${qIdx}`,
                type: "valid_match",
                severity: "success",
                schemaType: "FAQPage",
                property: `mainEntity[${qIdx}].name`,
                expectedInSchema: qName,
                foundInDom: "Visible in DOM",
                message: `FAQ Question verified in DOM.`,
                reasoning: "Question text matches page content."
              });
            }
          }
        }
      });
    }
    if (type.includes("Product")) {
      const offers = raw.offers;
      const offerArray = Array.isArray(offers) ? offers : offers ? [offers] : [];
      offerArray.forEach((offer, oIdx) => {
        if (typeof offer === "object" && offer !== null && offer.price !== undefined) {
          const priceStr = String(offer.price);
          const inBody = bodyLower.includes(priceStr);
          if (!inBody) {
            findings.push({
              id: `heur-price-${sIdx}-${oIdx}`,
              type: "unstated_claim",
              severity: "warning",
              schemaType: "Product",
              property: `offers[${oIdx}].price`,
              expectedInSchema: priceStr,
              foundInDom: null,
              message: `Product price "${priceStr}" in JSON-LD does not match any visible price in the DOM text.`,
              reasoning: "Unstated prices in schema risk search penalty for misleading structured data."
            });
          }
        }
      });
    }
    if (raw.headline || raw.name) {
      const titleProp = String(raw.headline || raw.name);
      const titleSnippet = titleProp.slice(0, 25).toLowerCase();
      const inTitle = titleLower.includes(titleSnippet);
      const inHeadings = dom.headings.some((h) => h.text.toLowerCase().includes(titleSnippet));
      const inBody = bodyLower.includes(titleSnippet);
      if (!inTitle && !inHeadings && !inBody) {
        findings.push({
          id: `heur-headline-${sIdx}`,
          type: "unstated_claim",
          severity: "warning",
          schemaType: type,
          property: raw.headline ? "headline" : "name",
          expectedInSchema: titleProp,
          foundInDom: dom.title || "Different title",
          message: `Schema title/headline "${titleProp}" differs substantially from DOM title and headings.`,
          reasoning: "Primary entity name should match visible document heading."
        });
      } else {
        findings.push({
          id: `heur-headline-match-${sIdx}`,
          type: "valid_match",
          severity: "success",
          schemaType: type,
          property: raw.headline ? "headline" : "name",
          expectedInSchema: titleProp,
          foundInDom: dom.title || titleProp,
          message: `Headline matches page title or heading.`,
          reasoning: "Verified matching headline."
        });
      }
    }
  });
  return {
    findings,
    reasoning: `Heuristic semantic verification analyzed ${schemas.length} schema(s) against DOM content. Verified author, steps, headlines, FAQs, and pricing strings.`
  };
}
async function verifySchemaLd(source, options = {}) {
  const startTime = performance.now();
  const parsedResult = extractJsonLdScripts(source);
  const domContent = extractDomContent(source);
  const findings = [...parsedResult.syntaxErrors];
  let aiReasoning = "";
  let modelUsed = "Heuristic Engine (Fallback)";
  let tokensUsed;
  const hasSchemas = parsedResult.schemas.length > 0;
  if (hasSchemas) {
    const aiAvailable = await isChromeAiAvailable();
    if (aiAvailable) {
      try {
        const aiApi = typeof window !== "undefined" ? window.ai : typeof ai !== "undefined" ? ai : undefined;
        if (aiApi?.languageModel) {
          const session = await aiApi.languageModel.create({
            systemPrompt: SYSTEM_PROMPT,
            temperature: options.temperature ?? 0.1
          });
          const promptText = buildVerificationPrompt(domContent, parsedResult.schemas, options.maxBodyLength);
          if (typeof session.countPromptTokens === "function") {
            try {
              tokensUsed = await session.countPromptTokens(promptText);
            } catch {}
          }
          const response = await session.prompt(promptText);
          session.destroy();
          const aiParsed = parseVerificationResponse(response);
          findings.push(...aiParsed.findings);
          aiReasoning = aiParsed.reasoning;
          modelUsed = "Gemini Nano (Chrome Built-in AI)";
        }
      } catch (err) {
        if (options.fallbackToHeuristics !== false) {
          const heuristicResult = verifyWithHeuristics(domContent, parsedResult.schemas);
          findings.push(...heuristicResult.findings);
          aiReasoning = `AI session error (${err instanceof Error ? err.message : String(err)}). Reverted to heuristics.`;
          modelUsed = "Heuristic Engine (Fallback after AI error)";
        }
      }
    } else if (options.fallbackToHeuristics !== false) {
      const heuristicResult = verifyWithHeuristics(domContent, parsedResult.schemas);
      findings.push(...heuristicResult.findings);
      aiReasoning = heuristicResult.reasoning;
      modelUsed = "Heuristic Engine (Fallback)";
    }
  } else if (parsedResult.syntaxErrors.length === 0) {
    findings.push({
      id: "no-schemas-found",
      type: "missing_entity",
      severity: "info",
      schemaType: "None",
      property: 'script[type="application/ld+json"]',
      expectedInSchema: "Structured data (e.g. Article, WebSite, Organization)",
      foundInDom: "No JSON-LD scripts found",
      message: "No JSON-LD structured data scripts were found on this page.",
      reasoning: "Consider adding Schema.org structured data to enhance search engine snippet rendering."
    });
    aiReasoning = "No JSON-LD scripts detected on page.";
  }
  const executionTimeMs = Math.round(performance.now() - startTime);
  const errorsCount = findings.filter((f) => f.severity === "error").length;
  const warningsCount = findings.filter((f) => f.severity === "warning").length;
  const validMatchesCount = findings.filter((f) => f.severity === "success").length;
  const syntaxErrorsCount = parsedResult.syntaxErrors.length;
  let status = "passed";
  if (errorsCount > 0) {
    status = "error";
  } else if (warningsCount > 0) {
    status = "warning";
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
      syntaxErrorsCount
    },
    aiReasoning,
    tokensUsed,
    executionTimeMs,
    modelUsed,
    timestamp: new Date().toISOString()
  };
}
export {
  verifyWithHeuristics,
  verifySchemaLd,
  parseVerificationResponse,
  isChromeAiAvailable,
  buildVerificationPrompt
};
