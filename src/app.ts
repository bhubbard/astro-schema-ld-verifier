/**
 * Astro Dev Toolbar App for Schema.org JSON-LD Verification
 */

import { defineToolbarApp } from 'astro/toolbar';
import { verifySchemaLd, isChromeAiAvailable } from './verifier.js';
import type { VerificationReport, AuditFinding, ExtractedJsonLdSchema } from './types.js';

export default defineToolbarApp({
  init(canvas, app, server) {
    let currentReport: VerificationReport | null = null;
    let activeTab: 'findings' | 'tree' | 'ai' | 'raw' = 'findings';
    let filterSeverity: string = 'all';

    // Create container
    const container = document.createElement('div');
    container.className = 'ldv-root';
    canvas.appendChild(container);

    // Apply scoped Dev Toolbar styles
    const style = document.createElement('style');
    style.textContent = getStyles();
    canvas.appendChild(style);

    // Initial run
    runVerification();

    async function runVerification() {
      renderLoading();

      try {
        const report = await verifySchemaLd(document);
        currentReport = report;

        // Update toolbar app notification indicator
        const totalIssues = report.stats.errorsCount + report.stats.warningsCount + report.stats.syntaxErrorsCount;
        if (totalIssues > 0) {
          app.toggleNotification({
            state: true,
            level: report.stats.errorsCount > 0 ? 'error' : 'warning',
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

    function renderError(message: string) {
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
      container.querySelector('#ldv-retry-btn')?.addEventListener('click', () => runVerification());
    }

    function renderMain() {
      if (!currentReport) return;

      const r = currentReport;
      const totalIssues = r.stats.errorsCount + r.stats.warningsCount;
      const statusClass = r.status === 'passed' ? 'status-pass' : r.status === 'error' ? 'status-error' : 'status-warn';
      const statusLabel = r.status === 'passed' ? 'PASSED' : r.status === 'error' ? 'MISMATCHES DETECTED' : 'WARNINGS';

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
          <div class="ldv-stat-item ${r.stats.errorsCount > 0 ? 'text-error' : ''}">
            <span class="ldv-stat-num">${r.stats.errorsCount}</span>
            <span class="ldv-stat-label">Errors</span>
          </div>
          <div class="ldv-stat-item ${r.stats.warningsCount > 0 ? 'text-warn' : ''}">
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
          <button class="ldv-tab ${activeTab === 'findings' ? 'active' : ''}" data-tab="findings">
            Audit Findings (${r.findings.length})
          </button>
          <button class="ldv-tab ${activeTab === 'tree' ? 'active' : ''}" data-tab="tree">
            Schema Tree (${r.schemasFound.length})
          </button>
          <button class="ldv-tab ${activeTab === 'ai' ? 'active' : ''}" data-tab="ai">
            AI Reasoning
          </button>
          <button class="ldv-tab ${activeTab === 'raw' ? 'active' : ''}" data-tab="raw">
            Raw JSON-LD
          </button>
        </div>

        <!-- Tab Content Container -->
        <div class="ldv-content" id="ldv-tab-content">
          ${renderTabContent(r)}
        </div>
      `;

      // Event handlers
      container.querySelector('#ldv-reverify-btn')?.addEventListener('click', () => runVerification());

      container.querySelectorAll('.ldv-tab').forEach((tabEl) => {
        tabEl.addEventListener('click', () => {
          activeTab = (tabEl.getAttribute('data-tab') as any) || 'findings';
          renderMain();
        });
      });

      container.querySelectorAll('.ldv-filter-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          filterSeverity = btn.getAttribute('data-filter') || 'all';
          renderMain();
        });
      });

      const copyBtn = container.querySelector('#ldv-copy-raw');
      if (copyBtn) {
        copyBtn.addEventListener('click', () => {
          const raw = r.schemasFound.map((s) => JSON.stringify(s.raw, null, 2)).join('\n\n');
          navigator.clipboard.writeText(raw).then(() => {
            copyBtn.textContent = 'Copied!';
            setTimeout(() => (copyBtn.textContent = 'Copy JSON-LD'), 2000);
          });
        });
      }
    }

    function renderTabContent(r: VerificationReport): string {
      switch (activeTab) {
        case 'findings':
          return renderFindingsTab(r);
        case 'tree':
          return renderTreeTab(r);
        case 'ai':
          return renderAiTab(r);
        case 'raw':
          return renderRawTab(r);
      }
    }

    function renderFindingsTab(r: VerificationReport): string {
      const filtered = r.findings.filter((f) => {
        if (filterSeverity === 'all') return true;
        if (filterSeverity === 'issues') return f.severity === 'error' || f.severity === 'warning';
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
          <button class="ldv-filter-btn ${filterSeverity === 'all' ? 'active' : ''}" data-filter="all">All (${r.findings.length})</button>
          <button class="ldv-filter-btn ${filterSeverity === 'issues' ? 'active' : ''}" data-filter="issues">Issues (${r.stats.errorsCount + r.stats.warningsCount})</button>
          <button class="ldv-filter-btn ${filterSeverity === 'error' ? 'active' : ''}" data-filter="error">Errors (${r.stats.errorsCount})</button>
          <button class="ldv-filter-btn ${filterSeverity === 'warning' ? 'active' : ''}" data-filter="warning">Warnings (${r.stats.warningsCount})</button>
          <button class="ldv-filter-btn ${filterSeverity === 'success' ? 'active' : ''}" data-filter="success">Verified (${r.stats.validMatchesCount})</button>
        </div>

        <div class="ldv-findings-list">
          ${filtered
            .map(
              (f) => `
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
                  <code class="ldv-diff-val">${escapeHtml(typeof f.expectedInSchema === 'object' ? JSON.stringify(f.expectedInSchema) : String(f.expectedInSchema || 'None'))}</code>
                </div>
                <div class="ldv-diff-row">
                  <span class="ldv-diff-label">Actual DOM:</span>
                  <code class="ldv-diff-val ${f.foundInDom ? '' : 'text-muted'}">${escapeHtml(f.foundInDom ? String(f.foundInDom) : 'Not found in visible text')}</code>
                </div>
              </div>

              ${f.reasoning ? `<div class="ldv-finding-reasoning">💡 <strong>AI Deduction:</strong> ${escapeHtml(f.reasoning)}</div>` : ''}
            </div>
          `
            )
            .join('')}
        </div>
      `;
    }

    function renderTreeTab(r: VerificationReport): string {
      if (r.schemasFound.length === 0) {
        return `<div class="ldv-empty-state"><p>No JSON-LD schemas parsed.</p></div>`;
      }

      return `
        <div class="ldv-tree-view">
          ${r.schemasFound
            .map(
              (s, idx) => `
            <div class="ldv-tree-node">
              <div class="ldv-tree-node-title">
                <span class="ldv-tree-icon">📄</span>
                <strong>${escapeHtml(s.type)}</strong>
                <span class="ldv-tree-id">${escapeHtml(s.id)}</span>
              </div>
              <div class="ldv-tree-props">
                <pre><code>${escapeHtml(JSON.stringify(s.properties, null, 2))}</code></pre>
              </div>
            </div>
          `
            )
            .join('')}
        </div>
      `;
    }

    function renderAiTab(r: VerificationReport): string {
      return `
        <div class="ldv-ai-panel">
          <div class="ldv-card">
            <h4>🤖 Gemini Nano Audit Assessment</h4>
            <p class="ldv-reasoning-text">${escapeHtml(r.aiReasoning || 'Semantic analysis complete.')}</p>
          </div>

          <div class="ldv-card">
            <h4>⚡ Engine & Performance Specs</h4>
            <div class="ldv-grid-two">
              <div><strong>Model:</strong> ${escapeHtml(r.modelUsed)}</div>
              <div><strong>Latency:</strong> ${r.executionTimeMs} ms</div>
              <div><strong>Tokens Counted:</strong> ${r.tokensUsed ? r.tokensUsed : 'N/A'}</div>
              <div><strong>Audited At:</strong> ${new Date(r.timestamp).toLocaleTimeString()}</div>
            </div>
          </div>
        </div>
      `;
    }

    function renderRawTab(r: VerificationReport): string {
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

    function formatFindingType(type: string): string {
      switch (type) {
        case 'mismatched_author':
          return '👤 Author Mismatch';
        case 'ghost_step':
          return '👻 Ghost Step';
        case 'unstated_claim':
          return '⚠️ Unstated Claim';
        case 'missing_entity':
          return '🔍 Missing Entity';
        case 'hallucinated_property':
          return '🚫 Hallucinated Property';
        case 'syntax_error':
          return '❌ Syntax Error';
        case 'valid_match':
          return '✅ Verified Match';
        default:
          return type;
      }
    }

    function escapeHtml(str: string): string {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }
  },
});

function getStyles(): string {
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
