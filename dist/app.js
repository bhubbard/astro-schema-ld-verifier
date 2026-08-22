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

// src/app.ts
import { defineToolbarApp } from "astro/toolbar";
var app_default = defineToolbarApp({
  init(canvas, app, server) {
    let currentReport = null;
    let activeTab = "findings";
    let filterSeverity = "all";
    const container = document.createElement("div");
    container.className = "ldv-root";
    canvas.appendChild(container);
    const style = document.createElement("style");
    style.textContent = getStyles();
    canvas.appendChild(style);
    runVerification();
    async function runVerification() {
      renderLoading();
      try {
        const report = await verifySchemaLd(document);
        currentReport = report;
        const totalIssues = report.stats.errorsCount + report.stats.warningsCount + report.stats.syntaxErrorsCount;
        if (totalIssues > 0) {
          app.toggleNotification({
            state: true,
            level: report.stats.errorsCount > 0 ? "error" : "warning"
          });
        } else {
          app.toggleNotification({ state: false });
        }
        renderMain();
      } catch (err) {
        renderError(err instanceof Error ? err.message : String(err));
      }
    }
    function renderLoading() {
      container.innerHTML = `
        <div class="ldv-header">
          <div class="ldv-title">
            <span class="ldv-logo">⚡</span>
            <h3>Schema.org LD Verifier</h3>
          </div>
        </div>
        <div class="ldv-loading">
          <div class="ldv-spinner"></div>
          <p>Auditing JSON-LD semantic alignment with Gemini Nano...</p>
        </div>
      `;
    }
    function renderError(message) {
      container.innerHTML = `
        <div class="ldv-header">
          <div class="ldv-title">
            <span class="ldv-logo">⚠️</span>
            <h3>Schema.org LD Verifier</h3>
          </div>
          <button class="ldv-btn ldv-btn-sm" id="ldv-retry-btn">Retry</button>
        </div>
        <div class="ldv-card ldv-error-card">
          <h4>Verification Failed</h4>
          <p>${escapeHtml(message)}</p>
        </div>
      `;
      container.querySelector("#ldv-retry-btn")?.addEventListener("click", () => runVerification());
    }
    function renderMain() {
      if (!currentReport)
        return;
      const r = currentReport;
      const totalIssues = r.stats.errorsCount + r.stats.warningsCount;
      const statusClass = r.status === "passed" ? "status-pass" : r.status === "error" ? "status-error" : "status-warn";
      const statusLabel = r.status === "passed" ? "PASSED" : r.status === "error" ? "MISMATCHES DETECTED" : "WARNINGS";
      container.innerHTML = `
        <div class="ldv-header">
          <div class="ldv-title-group">
            <span class="ldv-logo">⚡</span>
            <div>
              <h3>Schema.org LD Verifier</h3>
              <div class="ldv-meta-row">
                <span class="ldv-badge ${statusClass}">${statusLabel}</span>
                <span class="ldv-model-badge">${escapeHtml(r.modelUsed)}</span>
                <span class="ldv-time">${r.executionTimeMs}ms</span>
              </div>
            </div>
          </div>
          <button class="ldv-btn ldv-btn-primary" id="ldv-reverify-btn" title="Re-run semantic verification">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
            </svg>
            Re-verify
          </button>
        </div>

        <!-- Stats Bar -->
        <div class="ldv-stats-bar">
          <div class="ldv-stat-item">
            <span class="ldv-stat-num">${r.stats.totalSchemas}</span>
            <span class="ldv-stat-label">Schemas</span>
          </div>
          <div class="ldv-stat-item ${r.stats.errorsCount > 0 ? "text-error" : ""}">
            <span class="ldv-stat-num">${r.stats.errorsCount}</span>
            <span class="ldv-stat-label">Errors</span>
          </div>
          <div class="ldv-stat-item ${r.stats.warningsCount > 0 ? "text-warn" : ""}">
            <span class="ldv-stat-num">${r.stats.warningsCount}</span>
            <span class="ldv-stat-label">Warnings</span>
          </div>
          <div class="ldv-stat-item text-success">
            <span class="ldv-stat-num">${r.stats.validMatchesCount}</span>
            <span class="ldv-stat-label">Verified</span>
          </div>
        </div>

        <!-- Navigation Tabs -->
        <div class="ldv-tabs">
          <button class="ldv-tab ${activeTab === "findings" ? "active" : ""}" data-tab="findings">
            Audit Findings (${r.findings.length})
          </button>
          <button class="ldv-tab ${activeTab === "tree" ? "active" : ""}" data-tab="tree">
            Schema Tree (${r.schemasFound.length})
          </button>
          <button class="ldv-tab ${activeTab === "ai" ? "active" : ""}" data-tab="ai">
            AI Reasoning
          </button>
          <button class="ldv-tab ${activeTab === "raw" ? "active" : ""}" data-tab="raw">
            Raw JSON-LD
          </button>
        </div>

        <!-- Tab Content Container -->
        <div class="ldv-content" id="ldv-tab-content">
          ${renderTabContent(r)}
        </div>
      `;
      container.querySelector("#ldv-reverify-btn")?.addEventListener("click", () => runVerification());
      container.querySelectorAll(".ldv-tab").forEach((tabEl) => {
        tabEl.addEventListener("click", () => {
          activeTab = tabEl.getAttribute("data-tab") || "findings";
          renderMain();
        });
      });
      container.querySelectorAll(".ldv-filter-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          filterSeverity = btn.getAttribute("data-filter") || "all";
          renderMain();
        });
      });
      const copyBtn = container.querySelector("#ldv-copy-raw");
      if (copyBtn) {
        copyBtn.addEventListener("click", () => {
          const raw = r.schemasFound.map((s) => JSON.stringify(s.raw, null, 2)).join(`

`);
          navigator.clipboard.writeText(raw).then(() => {
            copyBtn.textContent = "Copied!";
            setTimeout(() => copyBtn.textContent = "Copy JSON-LD", 2000);
          });
        });
      }
    }
    function renderTabContent(r) {
      switch (activeTab) {
        case "findings":
          return renderFindingsTab(r);
        case "tree":
          return renderTreeTab(r);
        case "ai":
          return renderAiTab(r);
        case "raw":
          return renderRawTab(r);
      }
    }
    function renderFindingsTab(r) {
      const filtered = r.findings.filter((f) => {
        if (filterSeverity === "all")
          return true;
        if (filterSeverity === "issues")
          return f.severity === "error" || f.severity === "warning";
        return f.severity === filterSeverity;
      });
      if (r.findings.length === 0) {
        return `
          <div class="ldv-empty-state">
            <span class="ldv-empty-icon">✅</span>
            <h4>All Semantics Verified</h4>
            <p>Rendered JSON-LD completely mirrors page DOM content without discrepancies.</p>
          </div>
        `;
      }
      return `
        <div class="ldv-filter-bar">
          <button class="ldv-filter-btn ${filterSeverity === "all" ? "active" : ""}" data-filter="all">All (${r.findings.length})</button>
          <button class="ldv-filter-btn ${filterSeverity === "issues" ? "active" : ""}" data-filter="issues">Issues (${r.stats.errorsCount + r.stats.warningsCount})</button>
          <button class="ldv-filter-btn ${filterSeverity === "error" ? "active" : ""}" data-filter="error">Errors (${r.stats.errorsCount})</button>
          <button class="ldv-filter-btn ${filterSeverity === "warning" ? "active" : ""}" data-filter="warning">Warnings (${r.stats.warningsCount})</button>
          <button class="ldv-filter-btn ${filterSeverity === "success" ? "active" : ""}" data-filter="success">Verified (${r.stats.validMatchesCount})</button>
        </div>

        <div class="ldv-findings-list">
          ${filtered.map((f) => `
            <div class="ldv-finding-item ldv-finding-${f.severity}">
              <div class="ldv-finding-header">
                <span class="ldv-severity-tag tag-${f.severity}">${f.severity.toUpperCase()}</span>
                <span class="ldv-finding-type">${formatFindingType(f.type)}</span>
                <span class="ldv-finding-schema">${escapeHtml(f.schemaType)} &bull; ${escapeHtml(f.property)}</span>
              </div>
              <div class="ldv-finding-msg">${escapeHtml(f.message)}</div>
              
              <div class="ldv-diff-box">
                <div class="ldv-diff-row">
                  <span class="ldv-diff-label">JSON-LD Claim:</span>
                  <code class="ldv-diff-val">${escapeHtml(typeof f.expectedInSchema === "object" ? JSON.stringify(f.expectedInSchema) : String(f.expectedInSchema || "None"))}</code>
                </div>
                <div class="ldv-diff-row">
                  <span class="ldv-diff-label">Actual DOM:</span>
                  <code class="ldv-diff-val ${f.foundInDom ? "" : "text-muted"}">${escapeHtml(f.foundInDom ? String(f.foundInDom) : "Not found in visible text")}</code>
                </div>
              </div>

              ${f.reasoning ? `<div class="ldv-finding-reasoning">\uD83D\uDCA1 <strong>AI Deduction:</strong> ${escapeHtml(f.reasoning)}</div>` : ""}
            </div>
          `).join("")}
        </div>
      `;
    }
    function renderTreeTab(r) {
      if (r.schemasFound.length === 0) {
        return `<div class="ldv-empty-state"><p>No JSON-LD schemas parsed.</p></div>`;
      }
      return `
        <div class="ldv-tree-view">
          ${r.schemasFound.map((s, idx) => `
            <div class="ldv-tree-node">
              <div class="ldv-tree-node-title">
                <span class="ldv-tree-icon">\uD83D\uDCC4</span>
                <strong>${escapeHtml(s.type)}</strong>
                <span class="ldv-tree-id">${escapeHtml(s.id)}</span>
              </div>
              <div class="ldv-tree-props">
                <pre><code>${escapeHtml(JSON.stringify(s.properties, null, 2))}</code></pre>
              </div>
            </div>
          `).join("")}
        </div>
      `;
    }
    function renderAiTab(r) {
      return `
        <div class="ldv-ai-panel">
          <div class="ldv-card">
            <h4>\uD83E\uDD16 Gemini Nano Audit Assessment</h4>
            <p class="ldv-reasoning-text">${escapeHtml(r.aiReasoning || "Semantic analysis complete.")}</p>
          </div>

          <div class="ldv-card">
            <h4>⚡ Engine & Performance Specs</h4>
            <div class="ldv-grid-two">
              <div><strong>Model:</strong> ${escapeHtml(r.modelUsed)}</div>
              <div><strong>Latency:</strong> ${r.executionTimeMs} ms</div>
              <div><strong>Tokens Counted:</strong> ${r.tokensUsed ? r.tokensUsed : "N/A"}</div>
              <div><strong>Audited At:</strong> ${new Date(r.timestamp).toLocaleTimeString()}</div>
            </div>
          </div>
        </div>
      `;
    }
    function renderRawTab(r) {
      const fullJson = JSON.stringify(r.schemasFound.map((s) => s.raw), null, 2);
      return `
        <div class="ldv-raw-panel">
          <div class="ldv-raw-actions">
            <button class="ldv-btn ldv-btn-sm" id="ldv-copy-raw">Copy JSON-LD</button>
          </div>
          <pre class="ldv-code-block"><code>${escapeHtml(fullJson)}</code></pre>
        </div>
      `;
    }
    function formatFindingType(type) {
      switch (type) {
        case "mismatched_author":
          return "\uD83D\uDC64 Author Mismatch";
        case "ghost_step":
          return "\uD83D\uDC7B Ghost Step";
        case "unstated_claim":
          return "⚠️ Unstated Claim";
        case "missing_entity":
          return "\uD83D\uDD0D Missing Entity";
        case "hallucinated_property":
          return "\uD83D\uDEAB Hallucinated Property";
        case "syntax_error":
          return "❌ Syntax Error";
        case "valid_match":
          return "✅ Verified Match";
        default:
          return type;
      }
    }
    function escapeHtml(str) {
      return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }
  }
});
function getStyles() {
  return `
    :host {
      --ldv-bg: #12151c;
      --ldv-card-bg: #1a1e28;
      --ldv-border: #2a3142;
      --ldv-text: #f0f3f8;
      --ldv-text-muted: #8e9bb0;
      --ldv-primary: #7c3aed;
      --ldv-primary-hover: #6d28d9;
      --ldv-error: #ef4444;
      --ldv-error-bg: rgba(239, 68, 68, 0.12);
      --ldv-warn: #f59e0b;
      --ldv-warn-bg: rgba(245, 158, 11, 0.12);
      --ldv-success: #10b981;
      --ldv-success-bg: rgba(16, 185, 129, 0.12);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }

    .ldv-root {
      background: var(--ldv-bg);
      color: var(--ldv-text);
      width: 520px;
      max-width: 95vw;
      max-height: 80vh;
      border-radius: 12px;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5), 0 0 0 1px var(--ldv-border);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      font-size: 13px;
    }

    .ldv-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 16px;
      border-bottom: 1px solid var(--ldv-border);
      background: #161922;
    }

    .ldv-title-group {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .ldv-logo {
      font-size: 20px;
    }

    .ldv-title h3, .ldv-title-group h3 {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
      color: #fff;
    }

    .ldv-meta-row {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 3px;
    }

    .ldv-badge {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      padding: 2px 6px;
      border-radius: 4px;
    }
    .status-pass { background: var(--ldv-success-bg); color: var(--ldv-success); }
    .status-warn { background: var(--ldv-warn-bg); color: var(--ldv-warn); }
    .status-error { background: var(--ldv-error-bg); color: var(--ldv-error); }

    .ldv-model-badge {
      font-size: 10px;
      background: #252b3b;
      color: #94a3b8;
      padding: 2px 6px;
      border-radius: 4px;
    }

    .ldv-time {
      font-size: 10px;
      color: var(--ldv-text-muted);
    }

    .ldv-btn {
      background: #2a3142;
      color: #fff;
      border: none;
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: background 0.15s ease;
    }
    .ldv-btn:hover { background: #384259; }
    .ldv-btn-primary { background: var(--ldv-primary); }
    .ldv-btn-primary:hover { background: var(--ldv-primary-hover); }

    .ldv-stats-bar {
      display: flex;
      background: #181c26;
      border-bottom: 1px solid var(--ldv-border);
    }
    .ldv-stat-item {
      flex: 1;
      text-align: center;
      padding: 8px 4px;
      border-right: 1px solid var(--ldv-border);
    }
    .ldv-stat-item:last-child { border-right: none; }
    .ldv-stat-num { display: block; font-size: 16px; font-weight: 700; }
    .ldv-stat-label { font-size: 10px; color: var(--ldv-text-muted); text-transform: uppercase; }

    .text-error { color: var(--ldv-error); }
    .text-warn { color: var(--ldv-warn); }
    .text-success { color: var(--ldv-success); }
    .text-muted { color: var(--ldv-text-muted); }

    .ldv-tabs {
      display: flex;
      background: #141720;
      border-bottom: 1px solid var(--ldv-border);
      padding: 0 8px;
    }
    .ldv-tab {
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      color: var(--ldv-text-muted);
      padding: 8px 12px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
    }
    .ldv-tab.active {
      color: #fff;
      border-bottom-color: var(--ldv-primary);
    }

    .ldv-content {
      padding: 12px;
      overflow-y: auto;
      flex: 1;
      max-height: 480px;
    }

    .ldv-filter-bar {
      display: flex;
      gap: 6px;
      margin-bottom: 10px;
      flex-wrap: wrap;
    }
    .ldv-filter-btn {
      background: #1e2433;
      border: 1px solid var(--ldv-border);
      color: var(--ldv-text-muted);
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 11px;
      cursor: pointer;
    }
    .ldv-filter-btn.active {
      background: #2d374d;
      color: #fff;
      border-color: #4a597a;
    }

    .ldv-findings-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .ldv-finding-item {
      background: var(--ldv-card-bg);
      border: 1px solid var(--ldv-border);
      border-radius: 8px;
      padding: 10px 12px;
      border-left-width: 4px;
    }
    .ldv-finding-error { border-left-color: var(--ldv-error); }
    .ldv-finding-warning { border-left-color: var(--ldv-warn); }
    .ldv-finding-success { border-left-color: var(--ldv-success); }
    .ldv-finding-info { border-left-color: #3b82f6; }

    .ldv-finding-header {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 6px;
      font-size: 11px;
    }
    .ldv-severity-tag {
      font-size: 9px;
      font-weight: 700;
      padding: 1px 4px;
      border-radius: 3px;
    }
    .tag-error { background: var(--ldv-error-bg); color: var(--ldv-error); }
    .tag-warning { background: var(--ldv-warn-bg); color: var(--ldv-warn); }
    .tag-success { background: var(--ldv-success-bg); color: var(--ldv-success); }
    .tag-info { background: rgba(59, 130, 246, 0.12); color: #3b82f6; }

    .ldv-finding-type { font-weight: 600; color: #cbd5e1; }
    .ldv-finding-schema { color: var(--ldv-text-muted); margin-left: auto; font-family: monospace; font-size: 10px; }

    .ldv-finding-msg { font-size: 12px; line-height: 1.4; margin-bottom: 8px; }

    .ldv-diff-box {
      background: #11141c;
      border-radius: 6px;
      padding: 6px 8px;
      font-size: 11px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .ldv-diff-row { display: flex; gap: 8px; }
    .ldv-diff-label { color: var(--ldv-text-muted); width: 85px; flex-shrink: 0; font-size: 10px; }
    .ldv-diff-val { color: #38bdf8; word-break: break-all; }

    .ldv-finding-reasoning {
      margin-top: 6px;
      font-size: 11px;
      color: #94a3b8;
      line-height: 1.3;
    }

    .ldv-tree-view { display: flex; flex-direction: column; gap: 10px; }
    .ldv-tree-node {
      background: var(--ldv-card-bg);
      border: 1px solid var(--ldv-border);
      border-radius: 8px;
      padding: 10px;
    }
    .ldv-tree-node-title {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 8px;
    }
    .ldv-tree-id { color: var(--ldv-text-muted); font-size: 11px; font-family: monospace; margin-left: auto; }
    .ldv-tree-props pre { margin: 0; background: #11141c; padding: 8px; border-radius: 6px; overflow-x: auto; font-size: 11px; }

    .ldv-card {
      background: var(--ldv-card-bg);
      border: 1px solid var(--ldv-border);
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 10px;
    }
    .ldv-card h4 { margin: 0 0 8px 0; font-size: 13px; }
    .ldv-reasoning-text { line-height: 1.5; color: #cbd5e1; margin: 0; }

    .ldv-grid-two { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 12px; }

    .ldv-raw-actions { display: flex; justify-content: flex-end; margin-bottom: 8px; }
    .ldv-code-block {
      background: #11141c;
      padding: 10px;
      border-radius: 6px;
      font-family: monospace;
      font-size: 11px;
      overflow-x: auto;
      margin: 0;
    }

    .ldv-loading {
      padding: 40px 20px;
      text-align: center;
      color: var(--ldv-text-muted);
    }
    .ldv-spinner {
      width: 24px;
      height: 24px;
      border: 2px solid #384259;
      border-top-color: var(--ldv-primary);
      border-radius: 50%;
      animation: ldv-spin 0.8s linear infinite;
      margin: 0 auto 12px auto;
    }
    @keyframes ldv-spin { to { transform: rotate(360deg); } }

    .ldv-empty-state {
      padding: 30px;
      text-align: center;
    }
    .ldv-empty-icon { font-size: 32px; display: block; margin-bottom: 8px; }
  `;
}
export {
  app_default as default
};
