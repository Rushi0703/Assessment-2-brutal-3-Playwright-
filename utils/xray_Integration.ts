import dotenv from 'dotenv';
import { JiraIntegration, CreateIssueResult, TestFailureContext, jiraRequest } from './jira_Integration';

dotenv.config();

const xrayBaseUrl       = (process.env.XRAY_BASE_URL || process.env.JIRA_BASE_URL || process.env.JIRA_HOST || '').replace(/\/$/, '');
const xrayClientId      = process.env.XRAY_CLIENT_ID      || '';
const xrayClientSecret  = process.env.XRAY_CLIENT_SECRET  || '';
const xrayProjectKey    = process.env.XRAY_PROJECT_KEY    || process.env.JIRA_PROJECT_KEY || '';
const xrayIssueTypeName = process.env.XRAY_TEST_EXECUTION_ISSUE_TYPE || 'Test Execution';

// ─── Env Helpers ──────────────────────────────────────────────────────────────

function requiredEnv(name: string, value: string): string {
  if (!value) throw new Error(`Missing required Xray environment variable: ${name}`);
  return value;
}
function getBaseUrl():    string { return requiredEnv('XRAY_BASE_URL or JIRA_BASE_URL or JIRA_HOST', xrayBaseUrl); }
function getProjectKey(): string { return requiredEnv('XRAY_PROJECT_KEY or JIRA_PROJECT_KEY', xrayProjectKey); }

// ─── HTTP Client ──────────────────────────────────────────────────────────────

async function xrayRequest<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${getBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept:         'application/json',
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    },
  });
  const text = await response.text();
  let json: unknown;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = text; }
  if (!response.ok) throw new Error(`Xray API ${response.status} ${response.statusText}: ${text}`);
  return json as T;
}

// ─── XrayIntegration class ────────────────────────────────────────────────────

export class XrayIntegration {
  private readonly projectKey:    string;
  private readonly issueTypeName: string;
  private token?: string;

  constructor(projectKey?: string, issueTypeName?: string) {
    this.projectKey    = projectKey    || getProjectKey();
    this.issueTypeName = issueTypeName || xrayIssueTypeName;
  }

  private hasCloudCredentials(): boolean {
    return Boolean(xrayClientId && xrayClientSecret);
  }

  private async authenticate(): Promise<string> {
    if (this.token) return this.token;
    const response = await xrayRequest<{ access_token: string }>('/api/v2/authenticate', {
      method: 'POST',
      body: JSON.stringify({
        client_id:     requiredEnv('XRAY_CLIENT_ID', xrayClientId),
        client_secret: requiredEnv('XRAY_CLIENT_SECRET', xrayClientSecret),
      }),
    });
    if (!response?.access_token) throw new Error('Xray auth response missing access_token');
    this.token = response.access_token;
    return this.token;
  }

  private async createCloudExecution(summary: string, description: string): Promise<string> {
    const token = await this.authenticate();
    const response = await xrayRequest<{
      issueKey?: string; testExecIssueKey?: string; testExecutionKey?: string;
    }>('/api/v2/import/execution', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        testExecution: {
          projectKey:    this.projectKey,
          summary,
          description,
          issueTypeName: this.issueTypeName,
        },
        tests: [],
      }),
    });
    return response.issueKey || response.testExecIssueKey || response.testExecutionKey || '';
  }

  /**
   * Creates a Test Execution issue (or returns an existing one).
   *
   * Uses the same AI-generated summary from the bug report so that
   * the Xray execution and the Jira bug are clearly linked by name.
   */
  async createTestExecutionIfNotExists(
    ctx:         TestFailureContext,
    aiBugSummary: string           // pass the AI-generated summary from jiraIntegration
  ): Promise<CreateIssueResult> {
    const jira = new JiraIntegration(this.projectKey);
    const candidates = await jira.fetchRecentOpenIssues(this.issueTypeName);

    // Simple summary-based check for executions (no AI needed here — execution titles are stable)
    const existing = candidates.find((c) =>
      c.fields.summary.toLowerCase().includes(aiBugSummary.toLowerCase().slice(0, 50))
    );
    if (existing) {
      return { key: existing.key, wasExisting: true };
    }

    const executionSummary     = `[Execution] ${aiBugSummary}`;
    const executionDescription = `Automated test execution for: ${ctx.testTitle}\nFile: ${ctx.testFile}`;

    let key: string;
    if (this.hasCloudCredentials()) {
      key = await this.createCloudExecution(executionSummary, executionDescription);
    } else {
      key = await jira.createIssue
        ? (await jiraRequest<{ key: string }>(`${getBaseUrl()}/rest/api/3/issue`, { 
            method: 'POST',
            body: JSON.stringify({
              fields: {
                project:   { key: this.projectKey },
                summary:   executionSummary,
                issuetype: { name: this.issueTypeName },
                labels:    ['xray', 'automated'],
              },
            }),
          })).key
        : '';
    }

    return { key, wasExisting: false };
  }
}

// ─── Convenience export ───────────────────────────────────────────────────────

export async function createXrayTestExecutionIfNotExists(
  ctx:          TestFailureContext,
  aiBugSummary: string
): Promise<CreateIssueResult> {
  return new XrayIntegration().createTestExecutionIfNotExists(ctx, aiBugSummary);
}