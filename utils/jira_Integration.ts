import dotenv from 'dotenv';
import { TestInfo } from '@playwright/test';

dotenv.config();

const jiraBaseUrl    = (process.env.JIRA_BASE_URL || process.env.JIRA_HOST || '').replace(/\/$/, '');
const jiraEmail      = process.env.JIRA_EMAIL      || '';
const jiraApiToken   = process.env.JIRA_API_TOKEN  || '';
const jiraProjectKey = process.env.JIRA_PROJECT_KEY || '';

// ─── Env Helpers ──────────────────────────────────────────────────────────────

function requiredEnv(name: string, value: string): string {
    if (!value) throw new Error(`Missing required Jira environment variable: ${name}`);
    return value;
}
function getBaseUrl(): string { return requiredEnv('JIRA_BASE_URL or JIRA_HOST', jiraBaseUrl); }
function getProjectKey(): string { return requiredEnv('JIRA_PROJECT_KEY', jiraProjectKey); }
function getAuthHeader(): string {
    const email    = requiredEnv('JIRA_EMAIL', jiraEmail);
    const apiToken = requiredEnv('JIRA_API_TOKEN', jiraApiToken);
    return `Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}`;
}

// ─── Anthropic helper ─────────────────────────────────────────────────────────

async function callClaude(prompt: string, maxTokens = 1000): Promise<string> {
    const apiKey = process.env.ANTHROPIC_API_KEY || '';
    if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY environment variable');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type':    'application/json',
            'x-api-key':       apiKey,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model:      'claude-sonnet-4-20250514',
            max_tokens: maxTokens,
            messages:   [{ role: 'user', content: prompt }],
        }),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Anthropic API ${response.status}: ${text}`);
    }

    const data = await response.json() as { content: Array<{ type: string; text: string }> };
    return data.content.find((b) => b.type === 'text')?.text ?? '';
}

function parseJson<T>(raw: string): T {
    return JSON.parse(raw.replace(/```json|```/g, '').trim()) as T;
}

// ─── Public Types ─────────────────────────────────────────────────────────────

export interface JiraIssue {
    key: string;
    fields: {
        summary:      string;
        description?: unknown;
        issuetype:    { name: string };
        status?:      { name: string };
        priority?:    { name: string };
        labels?:      string[];
    };
}

export interface CreateIssueResult {
    key:          string;
    wasExisting:  boolean;
    aiReasoning?: string;
}

export interface TestFailureContext {
    testTitle:    string;
    testFile:     string;
    testLine?:    number;
    errorMessage: string;
    errorStack?:  string;
    status?:      string;
    tcId?:        string;
}

// ─── Internal AI shapes ───────────────────────────────────────────────────────

interface AiDefectDetails {
    summary:          string;
    priority:         'Highest' | 'High' | 'Medium' | 'Low';
    labels:           string[];
    whatFailed:       string;
    stepsToReproduce: string[];
    errorSummary:     string;
    rootCauseHint:    string;
    suggestedOwner?:  string;
}

interface AiDuplicateResult {
    isDuplicate:     boolean;
    matchedKey:      string | null;
    confidence:      'high' | 'medium' | 'low';
    similarityScore: number;
    reasoning:       string;
}

interface AiAssertionCheckResult {
    isAssertionFailure: boolean;
    reasoning:          string;
}

// ─── AI Assertion Check ───────────────────────────────────────────────────────

/**
 * Uses AI to determine whether an error represents a genuine test assertion
 * failure (i.e. a product defect worth filing a Jira bug for), as opposed to
 * infrastructure noise, flaky environment issues, or test-code errors.
 */
export async function isAssertionFailure(
    errorMessage: string,
    errorStack?: string
): Promise<boolean> {
    const msg   = (errorMessage ?? '').replace(/\x1B\[[0-9;]*m/g, '').trim();
    const stack = (errorStack   ?? '').replace(/\x1B\[[0-9;]*m/g, '').trim();

    const prompt = `You are a senior QA engineer triaging automated Playwright test failures.

Your job is to decide whether the error below is a GENUINE ASSERTION FAILURE — meaning the product under test behaved incorrectly and a Jira bug should be filed — or whether it is noise that should be ignored (infrastructure error, environment issue, test-code bug, browser crash, flaky timing, etc.).

ERROR MESSAGE:
${msg}

STACK TRACE:
${stack || '(not available)'}

CLASSIFICATION RULES:
- isAssertionFailure = true  → The test made a clear assertion about product behaviour (e.g. expected HTTP status, response body, UI element state, text content, URL, screenshot) and that assertion FAILED because the product did not behave as expected.
- isAssertionFailure = false → The failure is caused by:
    * Network/infrastructure errors (ECONNREFUSED, ETIMEDOUT, ENOTFOUND, socket hang up, net::ERR_*)
    * Playwright runtime/browser crashes (page closed, execution context destroyed, frame detached)
    * Locator/element-not-found errors (locator did not resolve, strict mode violation, element not attached)
    * JavaScript code errors in the test itself (TypeError, ReferenceError, SyntaxError, RangeError, "is not a function", "is not defined", max call stack)
    * Missing environment variables or test configuration
    * Test timeouts not caused by an assertion

Respond ONLY with valid JSON (no markdown fences, no extra keys):
{
  "isAssertionFailure": boolean,
  "reasoning": "<one crisp sentence explaining the decision>"
}`;

    try {
        const raw    = await callClaude(prompt, 300);
        const result = parseJson<AiAssertionCheckResult>(raw);
        console.log(`[jiraIntegration] AI assertion check: ${result.isAssertionFailure} — ${result.reasoning}`);
        return result.isAssertionFailure;
    } catch (err) {
        // If AI is unavailable, conservatively skip filing to avoid noise.
        console.warn('[jiraIntegration] AI assertion check failed — skipping Jira report:', err);
        return false;
    }
}

// ─── AI Defect Generation ─────────────────────────────────────────────────────

export async function generateDefectDetails(ctx: TestFailureContext): Promise<AiDefectDetails> {
    const prompt = `You are a senior QA engineer writing a Jira bug report from a failed Playwright automated test.

RAW FAILURE DATA:
- Test title   : ${ctx.testTitle}
- File         : ${ctx.testFile}${ctx.testLine ? `:${ctx.testLine}` : ''}
- TC ID        : ${ctx.tcId ?? 'n/a'}
- Status       : ${ctx.status ?? 'failed'}
- Error message: ${ctx.errorMessage}
- Stack trace  :
${ctx.errorStack ?? '(not available)'}

YOUR TASK:
Produce a concise, developer-readable Jira bug report. Do NOT pad with filler text.

Field rules:
- summary          → ≤ 100 chars, starts with a verb, precisely describes the failure.
                     Good:  "Checkout button disabled after entering valid payment details"
                     Bad:   "Test failure in checkout"
- priority         → Highest | High | Medium | Low  (infer from user-facing impact)
- labels           → 2–5 lowercase kebab-case tags matching the failure area
- whatFailed       → 1–2 plain-English sentences: what was the test doing, what went wrong
- stepsToReproduce → 3–6 steps a human tester can follow to reproduce the failure manually
- errorSummary     → Essential error trimmed to ≤ 3 lines; strip node_modules frames and ANSI codes
- rootCauseHint    → Your best hypothesis
- suggestedOwner   → Optional: which team/area likely owns the fix

Respond ONLY with valid JSON matching this exact shape (no markdown fences, no extra keys):
{
  "summary": "...",
  "priority": "High",
  "labels": ["..."],
  "whatFailed": "...",
  "stepsToReproduce": ["1. ...", "2. ..."],
  "errorSummary": "...",
  "rootCauseHint": "...",
  "suggestedOwner": "..."
}`;

    try {
        const raw = await callClaude(prompt, 800);
        return parseJson<AiDefectDetails>(raw);
    } catch (err) {
        console.warn('[jiraIntegration] AI defect generation failed — using fallback:', err);
        return {
            summary:          `Test failure: ${ctx.testTitle}`.slice(0, 100),
            priority:         'High',
            labels:           ['automated', 'playwright'],
            whatFailed:       ctx.errorMessage,
            stepsToReproduce: [
                'Run the automated test suite',
                `Execute test: ${ctx.testTitle}`,
                'Observe the failure',
            ],
            errorSummary:  ctx.errorMessage.slice(0, 300),
            rootCauseHint: 'Unknown — AI analysis unavailable.',
        };
    }
}

// ─── AI Semantic Deduplication ────────────────────────────────────────────────

async function findDuplicateWithAI(
    details:    AiDefectDetails,
    candidates: JiraIssue[]
): Promise<AiDuplicateResult> {
    if (candidates.length === 0) {
        return {
            isDuplicate:     false,
            matchedKey:      null,
            confidence:      'high',
            similarityScore: 0,
            reasoning:       'No open issues to compare.',
        };
    }

    const candidateList = candidates
        .map((c) =>
            `KEY: ${c.key}\n` +
            `SUMMARY: ${c.fields.summary}\n` +
            `STATUS: ${c.fields.status?.name ?? '?'} | PRIORITY: ${c.fields.priority?.name ?? '?'}`
        )
        .join('\n---\n');

    const prompt = `You are a QA assistant deduplicating Jira bug reports from an automated Playwright API test suite.

NEW BUG BEING FILED:
Summary        : ${details.summary}
What failed    : ${details.whatFailed}
Error summary  : ${details.errorSummary}
Root cause hint: ${details.rootCauseHint}

EXISTING OPEN BUGS (same project, newest first):
${candidateList}

DEDUPLICATION RULES — read carefully:
1. Mark isDuplicate=true ONLY when ALL three are true:
   a. Same API endpoint or UI feature is involved.
   b. Same assertion type is failing (status-code check vs body-content check vs header check are DIFFERENT types).
   c. The underlying defect is clearly the same (e.g. same wrong status code, same missing field).
2. Do NOT mark as duplicate when:
   - The endpoint or page differs.
   - The assertion type differs even on the same endpoint.
   - The expected vs received values differ (e.g. "expected 200 got 404" ≠ "expected 200 got 500").
   - Only the feature area matches but failure details do not.
3. similarityScore (integer 0–100):
   90–100 → Near-identical failure (same endpoint, same assertion, same values).
   75–89  → Same endpoint + same assertion type, slightly different context.
   50–74  → Same feature area, different assertion or different error values.
   0–49   → Different failure entirely.
4. isDuplicate must be false when similarityScore < 75 OR confidence is "low".
5. When uncertain, prefer isDuplicate=false.

Respond ONLY with valid JSON (no markdown fences, no extra keys):
{
  "isDuplicate": boolean,
  "matchedKey": "<JIRA-KEY or null>",
  "confidence": "high" | "medium" | "low",
  "similarityScore": integer,
  "reasoning": "<one crisp sentence explaining the decision>"
}`;

    try {
        const raw    = await callClaude(prompt, 400);
        const result = parseJson<AiDuplicateResult>(raw);
        if (result.similarityScore < 75 || result.confidence === 'low') {
            return { ...result, isDuplicate: false, matchedKey: null };
        }
        return result;
    } catch (err) {
        console.warn('[jiraIntegration] AI deduplication failed — treating as no duplicate:', err);
        return {
            isDuplicate:     false,
            matchedKey:      null,
            confidence:      'low',
            similarityScore: 0,
            reasoning:       'AI dedup check failed — creating new issue to avoid losing the report.',
        };
    }
}

// ─── Rich ADF Builder ─────────────────────────────────────────────────────────

function buildADF(d: AiDefectDetails): object {
    const heading     = (text: string, level: 1 | 2 | 3) => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] });
    const paragraph   = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
    const orderedList = (items: string[]) => ({ type: 'orderedList', content: items.map((item) => ({ type: 'listItem', content: [paragraph(item)] })) });
    const bulletList  = (items: string[]) => ({ type: 'bulletList', content: items.map((item) => ({ type: 'listItem', content: [paragraph(item)] })) });
    const codeBlock   = (code: string) => ({ type: 'codeBlock', attrs: { language: 'text' }, content: [{ type: 'text', text: code }] });
    const rule        = () => ({ type: 'rule' });

    const content: object[] = [
        heading('🔍 What Failed', 2), paragraph(d.whatFailed), rule(),
        heading('🪜 Steps to Reproduce', 2), orderedList(d.stepsToReproduce), rule(),
        heading('❌ Error Summary', 2), codeBlock(d.errorSummary), rule(),
        heading('💡 Root Cause Hypothesis', 2), paragraph(d.rootCauseHint),
    ];

    if (d.suggestedOwner) {
        content.push(rule(), heading('👤 Suggested Owner', 2), paragraph(d.suggestedOwner));
    }

    content.push(
        rule(),
        heading('🏷️ Meta', 2),
        bulletList([
            `Priority : ${d.priority}`,
            `Labels   : ${d.labels.join(', ')}`,
            `Source   : Automated Playwright test`,
        ])
    );

    return { type: 'doc', version: 1, content };
}

// ─── Jira HTTP Client ─────────────────────────────────────────────────────────

export async function jiraRequest<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
    const url      = `${getBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
    const response = await fetch(url, {
        ...options,
        headers: {
            'Authorization': getAuthHeader(),
            'Accept':        'application/json',
            'Content-Type':  'application/json',
            ...(options.headers as Record<string, string>),
        },
    });

    const text = await response.text();
    let json: unknown;
    try { json = text ? JSON.parse(text) : undefined; } catch { json = text; }
    if (!response.ok) throw new Error(`Jira API ${response.status} ${response.statusText}: ${text}`);
    return json as T;
}

// ─── JiraIntegration class ────────────────────────────────────────────────────

export class JiraIntegration {
    private readonly projectKey: string;

    constructor(projectKey?: string) {
        this.projectKey = projectKey || getProjectKey();
    }

    async fetchRecentOpenIssues(issueType = 'Bug', maxResults = 500): Promise<JiraIssue[]> {
        const jql =
            `project = ${this.projectKey} AND ` +
            `issuetype = "${issueType}" AND ` +
            `statusCategory != Done ` +
            `ORDER BY created DESC`;

        const data = await jiraRequest<{ issues?: JiraIssue[] }>('/rest/api/3/search/jql', {
            method: 'POST',
            body:   JSON.stringify({ jql, maxResults, fields: ['summary', 'issuetype', 'status', 'priority', 'labels'] }),
        });

        return data.issues ?? [];
    }

    async createIssue(
        summary:       string,
        issueTypeName: string,
        details?:      Partial<AiDefectDetails>,
        extraLabels?:  string[]
    ): Promise<string> {
        const labels = Array.from(new Set([...(details?.labels ?? []), ...(extraLabels ?? [])]));
        const fields: Record<string, unknown> = {
            project:   { key: this.projectKey },
            summary,
            issuetype: { name: issueTypeName },
            labels,
        };
        if (details) {
            fields.description = buildADF(details as AiDefectDetails);
            if (details.priority) fields.priority = { name: details.priority };
        }
        const data = await jiraRequest<{ key: string }>('/rest/api/3/issue', {
            method: 'POST',
            body:   JSON.stringify({ fields }),
        });
        return data.key;
    }

    /**
     * Main entry point — fully AI-powered 2-stage pipeline:
     *
     *   STAGE 1 — AI defect generation
     *             Claude analyses the raw failure and produces a structured,
     *             developer-readable bug report (summary, priority, labels, etc.)
     *
     *   STAGE 2 — AI semantic deduplication
     *             Claude compares the new defect against all open bugs and decides
     *             whether it is a genuine duplicate, using full semantic understanding
     *             of endpoints, assertion types, and error values — not keyword matching.
     *
     *   STAGE 3 — Create new issue (only when AI finds no duplicate)
     */
    async createBugIfNotExists(
        ctx:         TestFailureContext,
        extraLabels: string[] = []
    ): Promise<CreateIssueResult> {
        // Stage 1: AI generates structured defect details
        const details    = await generateDefectDetails(ctx);
        const candidates = await this.fetchRecentOpenIssues('Bug');

        // Stage 2: AI semantic deduplication
        const aiDup = await findDuplicateWithAI(details, candidates);
        if (aiDup.isDuplicate && aiDup.matchedKey) {
            console.log(
                `[jiraIntegration] AI duplicate detected (${aiDup.confidence}, score=${aiDup.similarityScore}): ` +
                `${aiDup.matchedKey} — ${aiDup.reasoning}`
            );
            return { key: aiDup.matchedKey, wasExisting: true, aiReasoning: aiDup.reasoning };
        }

        // Stage 3: No duplicate found — create new issue
        const newKey = await this.createIssue(details.summary, 'Bug', details, extraLabels);
        const reason = aiDup.reasoning || 'No duplicate found — AI confirmed this is a new defect.';
        console.log(`[jiraIntegration] Created new issue ${newKey} — ${reason}`);
        return { key: newKey, wasExisting: false, aiReasoning: reason };
    }
}

// ─── Named convenience exports ────────────────────────────────────────────────

export async function createBugOnJira(
    ctx:         TestFailureContext,
    extraLabels: string[] = []
): Promise<CreateIssueResult> {
    return new JiraIntegration().createBugIfNotExists(ctx, extraLabels);
}

export async function createIssueOnJira(
    summary:       string,
    issueTypeName = 'Bug',
    extraLabels:   string[] = []
): Promise<string> {
    return new JiraIntegration().createIssue(summary, issueTypeName, undefined, extraLabels);
}

// ─── Utility helpers ──────────────────────────────────────────────────────────

export function buildFallbackDescription(ctx: TestFailureContext): string {
    const lines: string[] = [
        '== What Failed ==',
        `Test   : ${ctx.testTitle}`,
        `File   : ${ctx.testFile}${ctx.testLine ? `:${ctx.testLine}` : ''}`,
        `TC ID  : ${ctx.tcId ?? 'n/a'}`,
        `Status : ${ctx.status ?? 'failed'}`,
        '',
        '== Error ==',
        ctx.errorMessage.slice(0, 500),
    ];
    if (ctx.errorStack) {
        lines.push('', '== Stack ==', ctx.errorStack.slice(0, 800));
    }
    lines.push('', '== Source ==', 'Automated Playwright test');
    return lines.join('\n');
}

export async function reportFailureToJira(
    testInfo: TestInfo,
    error:    unknown
): Promise<void> {
    const errorMessage = (
        error instanceof Error ? error.message : String(error)
    ).replace(/\x1B\[[0-9;]*m/g, '').trim();
    const errorStack = error instanceof Error ? (error.stack ?? undefined) : undefined;

    // AI-powered assertion check — replaces all static regex pattern matching
    const shouldReport = await isAssertionFailure(errorMessage, errorStack);
    if (!shouldReport) {
        console.log(
            `[jiraIntegration] Skipping Jira report — AI determined this is not an assertion failure: ` +
            `"${errorMessage.slice(0, 120)}"`
        );
        return;
    }

    const ctx: TestFailureContext = {
        testTitle:    testInfo.title,
        testFile:     testInfo.file,
        testLine:     testInfo.line ?? undefined,
        errorMessage,
        errorStack,
        status:       testInfo.status ?? 'failed',
        tcId:         process.env.TC_ID ?? testInfo.title,
    };

    try {
        const result = await createBugOnJira(ctx, ['automated', 'playwright']);
        console.log(`[jiraIntegration] Jira ${result.wasExisting ? 'existing' : 'new'} bug: ${result.key}`);
        if (testInfo.attach) {
            await testInfo.attach('Jira Issue', {
                body:        `${result.key} (${result.wasExisting ? 'existing duplicate' : 'newly created'})`,
                contentType: 'text/plain',
            });
        }
    } catch (trackerError) {
        const msg = `Failed to report to Jira: ${trackerError instanceof Error ? trackerError.message : String(trackerError)}`;
        console.error(`[jiraIntegration] ${msg}`);
    }
}

export const reportFailureToIssueTrackers = reportFailureToJira;