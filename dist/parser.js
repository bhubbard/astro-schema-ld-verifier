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
export {
  summarizeSchemaForPrompt,
  normalizeText,
  extractJsonLdScripts,
  extractDomContent
};
