type AxeNode = {
  id: string;
  impact?: string | null;
  description: string;
  help?: string;
  helpUrl?: string;
  nodes: {
    html: string;
    target: string[];
    failureSummary?: string;
  }[];
};

type AccessibilityInput = {
  url: string;
  results: {
    timestamp: string;
    violations: AxeNode[];
    title: string;
  };
};

export function generateAggregateA11yHtmlReport(
  input: AccessibilityInput[],
): string {
  function renderRows(items: AxeNode[] = [], type: string) {
    if (!items.length) {
      return `<tr><td colspan="4" class="empty">No ${type.toLowerCase()} found.</td></tr>`;
    }
    return items
      .map((item) => {
        const safeId = item.id;
        const helpText = item.help ?? 'N/A';
        const helpLink = item.helpUrl
          ? `<a href="${item.helpUrl}" target="_blank" rel="noopener" class="help-link">Help</a>`
          : 'N/A';

        const nodeDetails = item.nodes
          .map(
            (node) => `
            <div class="node-detail">
              <div><strong>Target:</strong> ${node.target.join(', ')}</div>
              <div><strong>HTML:</strong> <code>${node.html.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></div>
              ${node.failureSummary
                ? `<div><strong>Fix:</strong> ${node.failureSummary.split('\n').slice(2).join('\n').replace(/\n/g, '<br>')}</div>`
                : ''
              }
            </div>
          `
          )
          .join('');

        return `
        <tr>
          <td>
            <span class="rule-id">${safeId}</span>
            ${item.impact ? `<span class="impact ${item.impact}">${item.impact}</span>` : ''}
          </td>
          <td>
            ${item.description.replace(/</g, '&lt;').replace(/>/g, '&gt;')}
            ${nodeDetails}
          </td>
          <td>${helpText.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</td>
          <td>${helpLink}</td>
        </tr>
      `;
      })
      .join('');
  }

  function renderReport(entry: AccessibilityInput, index: number) {
    const { url, results } = entry;
    const { violations, timestamp, title } = results;

    return `
    <section class="report-section">
      <div class="meta">
        <div><span class="label">Timestamp:</span> <strong>${new Date(timestamp).toLocaleString()}</strong></div>
        <div><span class="label">URL:</span> <a href="${url}" target="_blank" rel="noopener">${url}</a></div>
        <div><span class="label">Title:</span> <strong>${title}</strong></div>
      </div>
      <div class="section-title">Violations</div>
      <table class="a11y-table">
        <thead>
          <tr>
            <th>ID / Impact</th>
            <th>Description & Node Details</th>
            <th>Help</th>
            <th>More Info</th>
          </tr>
        </thead>
        <tbody>
          ${renderRows(violations, 'Violation')}
        </tbody>
      </table>
    </section>
    `;
  }

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Accessibility Report (Aggregate)</title>
  <style>
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      padding: 20px;
      background: #f2f4f8;
      margin: 0;
      color: #333;
    }

    .container {
      max-width: 1200px;
      margin: auto;
      background: #fff;
      padding: 30px;
      border-radius: 10px;
      box-shadow: 0 4px 8px rgba(0,0,0,0.05);
    }

    h1 {
      text-align: center;
      color: #2c3e50;
      margin-bottom: 40px;
    }

    .report-section {
      margin-bottom: 50px;
      padding: 20px;
      border: 1px solid #dcdcdc;
      border-radius: 8px;
      background: #fafafa;
    }

    .section-title {
      font-size: 1.4em;
      margin-top: 20px;
      margin-bottom: 10px;
      color: #1a73e8;
      border-bottom: 2px solid #1a73e8;
      padding-bottom: 5px;
    }

    .meta {
      font-size: 0.95em;
      line-height: 1.6;
      margin-bottom: 20px;
    }

    .label {
      font-weight: bold;
      color: #555;
    }

    .a11y-table {
      width: 100%;
      border-collapse: collapse;
    }

    .a11y-table th, .a11y-table td {
      border: 1px solid #ccc;
      padding: 10px 12px;
      text-align: left;
      vertical-align: top;
    }

    .a11y-table th {
      background-color: #e8eef7;
      color: #222;
      font-weight: 600;
    }

    .a11y-table tr:nth-child(even) {
      background-color: #f9f9f9;
    }

    .empty {
      text-align: center;
      font-style: italic;
      color: #888;
    }

    .impact {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.85em;
      margin-left: 8px;
    }

    .impact.minor { background: #e0f2e9; color: #2e7d32; }
    .impact.moderate { background: #fff3e0; color: #ef6c00; }
    .impact.serious { background: #fdecea; color: #d84315; }
    .impact.critical { background: #ffebee; color: #b71c1c; }

    .rule-id {
      font-weight: bold;
    }

    .help-link {
      color: #1a0dab;
      text-decoration: underline;
    }

    a {
      color: #1a0dab;
    }

    .node-detail {
      margin-top: 8px;
      font-size: 0.9em;
      background: #fff;
      padding: 10px;
      border: 1px dashed #ccc;
      border-radius: 5px;
      margin-bottom: 8px;
    }

    code {
      background-color: #f4f4f4;
      padding: 2px 4px;
      font-family: monospace;
      border-radius: 4px;
    }
      .a11y-table td:nth-child(2) {
     width: 750px; 
    }

    .footer {
      margin-top: 50px;
      padding-top: 20px;
      font-size: 0.9em;
      color: #555;
      text-align: center;
      border-top: 1px solid #ccc;
    }

    .footer-content {
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    .footer-logo {
      max-height: 60px;
      margin-bottom: 10px;
    }

    .footer-text a {
      color: #1a0dab;
      text-decoration: none;
    }

    .footer-text a:hover {
      text-decoration: underline;
    }

  </style>
</head>
<body>
  <div class="container">
    <h1>WCAG Accessibility Test Report</h1>
    ${input.map((entry, idx) => renderReport(entry, idx)).join('')}
  </div>
  <footer class="footer">
    <hr />
    <div class="footer-content">
      <div class="footer-text">
        <p><strong>Brownbox Consulting Pvt. Ltd.</strong></p>
        <p>Engineering Future Digital Landscape!</p>
        <p><a href="https://www.brownboxconsulting.com" target="_blank">www.brownboxconsulting.com</a></p>
        <p><a href="mailto:connect@brownboxconsulting.com">connect@brownboxconsulting.com</a></p>
        <hr/>
      <p style="margin-top: 15px;">© ${new Date().getFullYear()} Brownbox Consulting Pvt. Ltd. All rights reserved.</p>
      </div>
    </div>
  </footer>
</body>
  
</html>
  `;
}
