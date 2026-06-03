import {
  test as baseTest,
  expect as baseExpect,
  Page,
  Locator,
  FrameLocator,
  TestInfo,
  BrowserContext,
  APIRequestContext,
  APIResponse,
  request as playwrightRequest,
} from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { log } from './logger';
import dotenv from 'dotenv';

dotenv.config();

// ═══════════════════════════════════════════════════════════════════════════════
// ─── SHARED CONSTANTS & UTILITIES ────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

const SEPARATOR = '============================================================================';

function fmt(tcId: string | undefined, message: string): string {
  return tcId ? `TC_ID = ${tcId} | ${message}` : message;
}

function resolveTcId(testInfo?: TestInfo): string | undefined {
  if (!testInfo) return undefined;
  return process.env.TC_ID ?? testInfo.title;
}

function extractErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/\x1B\[[0-9;]*m/g, '').trim();
}

function extractUsefulStack(error: unknown): string {
  if (!(error instanceof Error) || !error.stack) return '';
  const lines = error.stack.split('\n');
  const useful = lines.find(
    (l) => l.includes('.spec.') || l.includes('.test.') || l.includes('src/')
  );
  return useful ? `\n  → ${useful.trim()}` : '';
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── SHARED STEP COUNTER ─────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

export class StepCounter {
  private _count = 0;
  next(): number { return ++this._count; }
  current(): number { return this._count; }
}

// Back-compat alias — API tests that import ApiStepCounter still compile
export { StepCounter as ApiStepCounter };

// ═══════════════════════════════════════════════════════════════════════════════
// ─── SCREENSHOT HELPER ───────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

async function captureScreenshot(
  page: Page,
  testInfo: TestInfo,
  label: string,
  tcId: string | undefined,
  stepNumber: number
): Promise<void> {
  const screenshotDir = testInfo.outputPath('screenshots');
  const sanitizedLabel = label.replace(/[^a-zA-Z0-9_-]/g, '_');
  const fileName = `Step_${stepNumber}_${sanitizedLabel}_${Date.now()}.png`;
  const filePath = path.join(screenshotDir, fileName);

  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  try {
    const screenshot = await page.screenshot({ path: filePath, fullPage: true });
    await testInfo.attach(`Step ${stepNumber} | ${label}`, {
      body: screenshot,
      contentType: 'image/png',
    });
  } catch {
    await log('WARN', fmt(tcId, `Could not capture screenshot for: ${label}`));
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── LOCATOR DESCRIPTION HELPERS ─────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

function serializeOptions(options: Record<string, unknown> | undefined): string {
  if (!options || Object.keys(options).length === 0) return '';
  const parts = Object.entries(options)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => {
      if (typeof v === 'string') return `${k}: '${v}'`;
      if (v instanceof RegExp) return `${k}: ${v.toString()}`;
      if (v !== null && typeof v === 'object' && typeof (v as any)._description === 'string') {
        return `${k}: [${(v as any)._description}]`;
      }
      if (v !== null && typeof v === 'object' && '_selector' in v) {
        return `${k}: [${(v as any)._selector ?? (v as any)._spec ?? 'Locator'}]`;
      }
      try { return `${k}: ${JSON.stringify(v)}`; }
      catch { return `${k}: [Object]`; }
    });
  return parts.length ? `{ ${parts.join(', ')} }` : '';
}

function buildLocatorDescription(method: string, args: unknown[]): string {
  if (args.length === 0) return `${method}()`;
  const [first, second] = args;

  if (typeof first === 'string' && second && typeof second === 'object' && !(second instanceof RegExp)) {
    const opts = serializeOptions(second as Record<string, unknown>);
    return opts ? `${method}('${first}', ${opts})` : `${method}('${first}')`;
  }
  if (typeof first === 'string') {
    if (second !== undefined && typeof second === 'object') {
      const opts = serializeOptions(second as Record<string, unknown>);
      return opts ? `${method}('${first}', ${opts})` : `${method}('${first}')`;
    }
    return `${method}('${first}')`;
  }
  if (first instanceof RegExp) {
    if (second !== undefined && typeof second === 'object') {
      const opts = serializeOptions(second as Record<string, unknown>);
      return opts ? `${method}(${first.toString()}, ${opts})` : `${method}(${first.toString()})`;
    }
    return `${method}(${first.toString()})`;
  }
  return `${method}(${args.map((a) => JSON.stringify(a)).join(', ')})`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── SOFT ASSERTION COLLECTOR ────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

export class SoftAssertionCollector {
  private _errors: Array<{ step: number; assertionName: string; description: string; message: string }> = [];

  record(step: number, assertionName: string, description: string, message: string): void {
    this._errors.push({ step, assertionName, description, message });
  }
  hasErrors(): boolean { return this._errors.length > 0; }
  getErrors(): ReadonlyArray<{ step: number; assertionName: string; description: string; message: string }> {
    return this._errors;
  }
  throwIfAny(): void {
    if (!this.hasErrors()) return;
    const lines = this._errors.map(
      (e) => `  Step ${e.step} | [${e.assertionName}] on ${e.description}: ${e.message}`
    );
    throw new Error(`Soft assertion(s) failed:\n${lines.join('\n')}`);
  }
  clear(): void { this._errors = []; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── UNIVERSAL ACTION RUNNER ──────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
//
// Used for every UI action AND every API HTTP call.
// page / description / screenshotOnFailure are UI-only (all optional).
// soft / collector are soft-assertion paths (both optional).
//
// Log format (success):
//   ====...
//   In Step - N - <actionLabel>
//   In Step - N - <completedLabel>
//   Execution of Step N completed in X ms | Status: true
//   ====...
//
// Log format (failure):
//   ====...
//   In Step - N - <actionLabel>
//   In Step - N - <actionLabel> ── FAILED
//     Locator : <description>   (UI only, when description is set)
//     Reason  : <error>
//     Duration: X ms | Status: false
//   ====...

async function runAction<T>(opts: {
  tcId: string | undefined;
  stepCounter: StepCounter;
  actionLabel: string;
  completedLabel: string;
  action: () => Promise<T>;
  // UI-only (optional)
  page?: Page;
  description?: string;
  screenshotOnFailure?: boolean;
  testInfo?: TestInfo;
  // API soft-assertion (optional)
  soft?: boolean;
}): Promise<T> {
  const {
    tcId, stepCounter, actionLabel, completedLabel, action,
    page, description, screenshotOnFailure = true, testInfo, soft,
  } = opts;

  const step = stepCounter.next();
  const start = Date.now();

  await log('INFO', SEPARATOR);
  await log('INFO', fmt(tcId, `In Step - ${step} - ${actionLabel}`));

  try {
    const result = await action();
    const duration = Date.now() - start;

    if (page && testInfo) {
      await captureScreenshot(page, testInfo, description ?? actionLabel, tcId, step);
    }

    await log('INFO', fmt(tcId, `In Step - ${step} - ${completedLabel}`));
    await log('INFO', fmt(tcId, `Execution of Step ${step} completed in ${duration} ms | Status: true`));
    await log('INFO', SEPARATOR);

    return result;

  } catch (error) {
    const duration = Date.now() - start;
    const errMsg = extractErrorMessage(error);
    const errLoc = extractUsefulStack(error);

    await log('ERROR', fmt(tcId, `In Step - ${step} - ${actionLabel} ── FAILED`));
    if (description) {
      await log('ERROR', fmt(tcId, `  Locator : ${description}`));
    }
    await log('ERROR', fmt(tcId, `  Reason  : ${errMsg}${errLoc}`));
    await log('ERROR', fmt(tcId, `  Duration: ${duration} ms | Status: false`));
    await log('INFO', SEPARATOR);

    if (screenshotOnFailure && page && testInfo) {
      await captureScreenshot(page, testInfo, `FAILED_${description ?? actionLabel}`, tcId, step);
    }

    // Soft path — record error on testInfo, do NOT rethrow
    if (soft && testInfo) {
      await log('WARN', fmt(tcId, `[SOFT] Step ${step} assertion failed (test continues): ${errMsg}`));
      (testInfo.errors as Error[]).push(error instanceof Error ? error : new Error(String(error)));
      return undefined as unknown as T;
    }

    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── UNIVERSAL ASSERTION RUNNER ───────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
//
// Used by EVERY assertion class: LocatorAssertions, PageAssertions,
// ApiResponseAssertions, and LoggedValueAssertions.
//
// Log format (success):
//   ====...
//   In Step - N - Asserting [<prefix><assertionName>] on <description>
//   In Step - N - Asserted  [<prefix><assertionName>] on <description>
//   Execution of Step N completed in X ms | Status: true
//   ====...
//
// Log format (hard failure):
//   ====...
//   In Step - N - Asserting [<prefix><assertionName>] on <description> ── FAILED
//     Locator : <description>   (omitted when description is 'page' or the value label)
//     Reason  : <error>
//     Duration: X ms | Status: false
//   ====...
//
// Log format (soft failure):
//   ====...
//   In Step - N - Soft Asserting [<prefix><assertionName>] on <description> ── FAILED (soft)
//     Locator : <description>
//     Reason  : <error>
//     Duration: X ms | Status: false
//   ====...

async function runAssertion(opts: {
  tcId: string | undefined;
  stepCounter: StepCounter;
  assertionName: string;
  description: string;
  fn: () => void | Promise<void>;
  page?: Page;
  testInfo?: TestInfo;
  // '' for normal, 'NOT ' for negated
  prefix?: string;
  // When provided → soft mode: record failure instead of throwing
  collector?: SoftAssertionCollector;
}): Promise<void> {
  const {
    tcId, stepCounter, assertionName, description, fn,
    page, testInfo, prefix = '', collector,
  } = opts;

  const soft = !!collector;
  const tag = soft ? 'Soft ' : '';
  const fullName = `${prefix}${assertionName}`;
  const startLine = `${tag}Asserting [${fullName}] on ${description}`;
  const doneLine = `${tag}Asserted  [${fullName}] on ${description}`;

  const step = stepCounter.next();
  const start = Date.now();

  await log('INFO', SEPARATOR);
  await log('INFO', fmt(tcId, `In Step - ${step} - ${startLine}`));

  try {
    await fn();
    const duration = Date.now() - start;

    if (page && testInfo) {
      await captureScreenshot(
        page, testInfo,
        `${soft ? 'SOFT_' : ''}ASSERT_${fullName}_${description}`,
        tcId, step
      );
    }

    await log('INFO', fmt(tcId, `In Step - ${step} - ${doneLine}`));
    await log('INFO', fmt(tcId, `Execution of Step ${step} completed in ${duration} ms | Status: true`));
    await log('INFO', SEPARATOR);

  } catch (error) {
    const duration = Date.now() - start;
    const errMsg = extractErrorMessage(error);
    const errLoc = extractUsefulStack(error);
    const level = soft ? 'WARN' : 'ERROR';
    const suffix = soft ? ' ── FAILED (soft)' : ' ── FAILED';

    await log(level, fmt(tcId, `In Step - ${step} - ${startLine}${suffix}`));
    // Show Locator line for everything except page-level and plain-value assertions
    if (description !== 'page' && !description.startsWith('value:')) {
      await log(level, fmt(tcId, `  Locator : ${description}`));
    }
    await log(level, fmt(tcId, `  Reason  : ${errMsg}${errLoc}`));
    await log(level, fmt(tcId, `  Duration: ${duration} ms | Status: false`));
    await log('INFO', SEPARATOR);

    if (soft) {
      collector!.record(step, fullName, description, errMsg);
      return; // do not rethrow
    }
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── API RESPONSE WRAPPER ────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

export class ApiResponseWrapper {
  private readonly _cachedStatus: number;
  private readonly _cachedStatusText: string;
  private readonly _cachedOk: boolean;
  private readonly _cachedHeaders: Record<string, string>;
  private readonly _cachedUrl: string;

  readonly __isApiResponseWrapper = true as const;

  constructor(
    private readonly _response: APIResponse,
    private readonly _tcId: string | undefined,
    private readonly _testInfo: TestInfo | undefined,
    private readonly _stepCounter: StepCounter
  ) {
    this._cachedStatus = _response.status();
    this._cachedStatusText = _response.statusText();
    this._cachedOk = _response.ok();
    this._cachedHeaders = _response.headers();
    this._cachedUrl = _response.url();

    return new Proxy(this, {
      get(target, prop, receiver) {
        if (prop in target) {
          const v = Reflect.get(target, prop, receiver);
          return typeof v === 'function' ? v.bind(target) : v;
        }
        const raw = target._response;
        const v = Reflect.get(raw, prop, raw);
        return typeof v === 'function' ? (v as Function).bind(raw) : v;
      },
    });
  }

  url(): string { return this._cachedUrl; }
  status(): number { return this._cachedStatus; }
  statusText(): string { return this._cachedStatusText; }
  ok(): boolean { return this._cachedOk; }
  headers(): Record<string, string> { return this._cachedHeaders; }
  headerValue(name: string): string | null { return this._cachedHeaders[name.toLowerCase()] ?? null; }

  async text(): Promise<string> {
    const text = await this._response.text();
    await log('INFO', fmt(this._tcId, `Response body (text) read from "${this._cachedUrl}"`));
    return text;
  }

  async json<T = unknown>(): Promise<T> {
    const data = (await this._response.json()) as T;
    await log('INFO', fmt(this._tcId, `Response body (json) read from "${this._cachedUrl}"`));
    return data;
  }

  /** Silently reads the body — never throws, used for failure attachments. */
  async safeBody(): Promise<string> {
    try { return await this._response.text(); } catch { return '<could not read body>'; }
  }

  async dispose(): Promise<void> {
    await this._response.dispose();
    await log('INFO', fmt(this._tcId, `Disposed response for "${this._cachedUrl}"`));
  }

  raw(): APIResponse { return this._response; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── API RESPONSE ASSERTIONS ─────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
//
// Uses runAssertion so logs are:
//   In Step - N - Asserting [toBeOK] on response "<url>"
//   In Step - N - Asserted  [toBeOK] on response "<url>"
//   Execution of Step N completed in X ms | Status: true
//
// Negated:
//   In Step - N - Asserting [NOT toBeOK] on response "<url>"
//
// Soft (via testInfo.errors):
//   In Step - N - Soft Asserting [toBeOK] on response "<url>" ── FAILED (soft)

export class ApiResponseAssertions {
  constructor(
    private readonly _response: ApiResponseWrapper,
    private readonly _tcId: string | undefined,
    private readonly _testInfo: TestInfo | undefined,
    private readonly _stepCounter: StepCounter,
    private readonly _soft = false,
    private readonly _negated = false
  ) { }

  private async run(assertionName: string, fn: () => void | Promise<void>): Promise<void> {
    const url = this._response.url();
    // Soft collector bridged through testInfo.errors (original API behaviour)
    const softCollector = this._soft ? new SoftAssertionCollector() : undefined;

    await runAssertion({
      tcId: this._tcId,
      stepCounter: this._stepCounter,
      assertionName,
      description: `response "${url}"`,
      fn,
      testInfo: this._testInfo,
      prefix: this._negated ? 'NOT ' : '',
      collector: softCollector,
    });

    // Bridge soft failures back to testInfo.errors (original behaviour)
    if (this._soft && softCollector?.hasErrors() && this._testInfo) {
      for (const e of softCollector.getErrors()) {
        (this._testInfo.errors as Error[]).push(new Error(e.message));
      }
    }
  }

  async toBeOK(): Promise<void> {
    await this.run('toBeOK', async () => {
      this._negated
        ? await baseExpect(this._response.raw()).not.toBeOK()
        : await baseExpect(this._response.raw()).toBeOK();
    });
  }

  get not(): ApiResponseAssertions {
    return new ApiResponseAssertions(
      this._response, this._tcId, this._testInfo, this._stepCounter, this._soft, true
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── API CONTEXT WRAPPER ─────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

export class ApiContextWrapper {
  readonly _context: APIRequestContext;
  readonly _stepCounter: StepCounter;
  readonly _testInfo?: TestInfo;

  constructor(context: APIRequestContext, testInfo?: TestInfo, stepCounter?: StepCounter) {
    this._context = context;
    this._testInfo = testInfo;
    this._stepCounter = stepCounter ?? new StepCounter();

    return new Proxy(this, {
      get(target, prop, receiver) {
        if (prop in target) {
          const v = Reflect.get(target, prop, receiver);
          return typeof v === 'function' ? v.bind(target) : v;
        }
        const raw = target._context;
        const v = Reflect.get(raw, prop, raw);
        return typeof v === 'function' ? (v as Function).bind(raw) : v;
      },
    });
  }

  private get _tcId(): string | undefined { return resolveTcId(this._testInfo); }

  private wrap(response: APIResponse): ApiResponseWrapper {
    return new ApiResponseWrapper(response, this._tcId, this._testInfo, this._stepCounter);
  }

  // Shared HTTP request helper — all verbs (GET/POST/PUT/PATCH/DELETE/HEAD) go through here.
  // Log format inside the separator block:
  //   In Step - N - <METHOD> <url>
  //   In Step - N - <METHOD> <url> → <status> <statusText>
  //   Execution of Step N completed in X ms | Status: true
  private async doRequest(
    method: string,
    url: string,
    options?: unknown
  ): Promise<ApiResponseWrapper> {
    return runAction({
      tcId: this._tcId,
      stepCounter: this._stepCounter,
      actionLabel: `${method} ${url}`,
      completedLabel: `${method} ${url} completed`,
      testInfo: this._testInfo,
      action: async () => {
        const raw = await (this._context as any)[method.toLowerCase()](url, options);
        const w = this.wrap(raw);
        // Log the status line INSIDE the same step block (before completedLabel)
        await log('INFO', fmt(this._tcId, `${method} ${url} → ${w.status()} ${w.statusText()}`));
        return w;
      },
    });
  }

  async get(url: string, options?: Parameters<APIRequestContext['get']>[1]) { return this.doRequest('GET', url, options); }
  async post(url: string, options?: Parameters<APIRequestContext['post']>[1]) { return this.doRequest('POST', url, options); }
  async put(url: string, options?: Parameters<APIRequestContext['put']>[1]) { return this.doRequest('PUT', url, options); }
  async patch(url: string, options?: Parameters<APIRequestContext['patch']>[1]) { return this.doRequest('PATCH', url, options); }
  async delete(url: string, options?: Parameters<APIRequestContext['delete']>[1]) { return this.doRequest('DELETE', url, options); }
  async head(url: string, options?: Parameters<APIRequestContext['head']>[1]) { return this.doRequest('HEAD', url, options); }

  async fetch(
    urlOrRequest: string | Parameters<APIRequestContext['fetch']>[0],
    options?: Parameters<APIRequestContext['fetch']>[1]
  ): Promise<ApiResponseWrapper> {
    const label = typeof urlOrRequest === 'string'
      ? urlOrRequest
      : (urlOrRequest as any).url?.() ?? String(urlOrRequest);

    return runAction({
      tcId: this._tcId,
      stepCounter: this._stepCounter,
      actionLabel: `FETCH ${label}`,
      completedLabel: `FETCH ${label} completed`,
      testInfo: this._testInfo,
      action: async () => {
        const raw = await this._context.fetch(urlOrRequest as string, options);
        const w = this.wrap(raw);
        await log('INFO', fmt(this._tcId, `FETCH ${label} → ${w.status()} ${w.statusText()}`));
        return w;
      },
    });
  }

  async storageState(options?: Parameters<APIRequestContext['storageState']>[0]) {
    return runAction({
      tcId: this._tcId,
      stepCounter: this._stepCounter,
      actionLabel: 'storageState()',
      completedLabel: 'storageState() fetched',
      testInfo: this._testInfo,
      action: () => this._context.storageState(options),
    });
  }

  async dispose(): Promise<void> {
    await runAction({
      tcId: this._tcId,
      stepCounter: this._stepCounter,
      actionLabel: 'Disposing API context',
      completedLabel: 'API context disposed',
      testInfo: this._testInfo,
      action: () => this._context.dispose(),
    });
  }

  raw(): APIRequestContext { return this._context; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── PER-TEST API CONTEXT REGISTRY ───────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

interface ApiTestContext {
  stepCounter: StepCounter;
  tcId: string | undefined;
  testInfo: TestInfo;
}

const _apiTestContextRegistry = new Map<string, ApiTestContext>();

function getApiTestContext(testInfo: TestInfo): ApiTestContext {
  const key = testInfo.testId;
  let ctx = _apiTestContextRegistry.get(key);
  if (!ctx) {
    ctx = { stepCounter: new StepCounter(), tcId: resolveTcId(testInfo), testInfo };
    _apiTestContextRegistry.set(key, ctx);
  }
  return ctx;
}

function deleteApiTestContext(testInfo: TestInfo): void {
  _apiTestContextRegistry.delete(testInfo.testId);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── LOGGED VALUE ASSERTIONS ─────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
//
// Used by expect(plainValue) in both UI and API tests.
//
// Log format:
//   In Step - N - Asserting [toBe] on value: <actual>
//   In Step - N - Asserted  [toBe] on value: <actual>

export class LoggedValueAssertions {
  constructor(
    private readonly _actual: unknown,
    private readonly _tcId: string | undefined,
    private readonly _stepCounter: StepCounter,
    private readonly _negated = false,
    private readonly _soft = false
  ) { }

  private e() { return this._negated ? baseExpect(this._actual).not : baseExpect(this._actual); }

  // Renders the actual value safely (truncated to 120 chars to keep logs readable)
  private get _valueLabel(): string {
    let str: string;
    try { str = JSON.stringify(this._actual) ?? String(this._actual); }
    catch { str = String(this._actual); }
    return `value: ${str.length > 120 ? str.slice(0, 117) + '...' : str}`;
  }

  private async run(matcherName: string, fn: () => void | Promise<void>): Promise<void> {
    await runAssertion({
      tcId: this._tcId,
      stepCounter: this._stepCounter,
      assertionName: matcherName,
      description: this._valueLabel,
      fn,
      prefix: this._negated ? 'NOT ' : '',
    });
  }

  async toBe(expected: unknown) { await this.run('toBe', () => this.e().toBe(expected)); }
  async toEqual(expected: unknown) { await this.run('toEqual', () => this.e().toEqual(expected)); }
  async toStrictEqual(expected: unknown) { await this.run('toStrictEqual', () => this.e().toStrictEqual(expected)); }
  async toBeTruthy() { await this.run('toBeTruthy', () => this.e().toBeTruthy()); }
  async toBeFalsy() { await this.run('toBeFalsy', () => this.e().toBeFalsy()); }
  async toBeNull() { await this.run('toBeNull', () => this.e().toBeNull()); }
  async toBeUndefined() { await this.run('toBeUndefined', () => this.e().toBeUndefined()); }
  async toBeDefined() { await this.run('toBeDefined', () => this.e().toBeDefined()); }
  // @ts-ignore
  async toBeNaN() { await this.run('toBeNaN', () => this.e().toBeNaN()); }
  // @ts-ignore
  async toBeInstanceOf(expected: Function) { await this.run('toBeInstanceOf', () => this.e().toBeInstanceOf(expected)); }
  // @ts-ignore
  async toBeGreaterThan(n: number | bigint) { await this.run('toBeGreaterThan', () => this.e().toBeGreaterThan(n)); }
  // @ts-ignore
  async toBeGreaterThanOrEqual(n: number | bigint) { await this.run('toBeGreaterThanOrEqual', () => this.e().toBeGreaterThanOrEqual(n)); }
  // @ts-ignore
  async toBeLessThan(n: number | bigint) { await this.run('toBeLessThan', () => this.e().toBeLessThan(n)); }
  // @ts-ignore
  async toBeLessThanOrEqual(n: number | bigint) { await this.run('toBeLessThanOrEqual', () => this.e().toBeLessThanOrEqual(n)); }
  async toBeCloseTo(expected: number, numDigits?: number): Promise<void> {
    const label = numDigits !== undefined
      ? `toBeCloseTo(${expected}, ${numDigits})`
      : `toBeCloseTo(${expected})`;
    // @ts-ignore
    await this.run(label, () =>
      numDigits !== undefined
        ? this.e().toBeCloseTo(expected, numDigits)
        : this.e().toBeCloseTo(expected)
    );
  }
  // @ts-ignore
  async toContain(expected: unknown) { await this.run('toContain', () => this.e().toContain(expected)); }
  // @ts-ignore
  async toContainEqual(expected: unknown) { await this.run('toContainEqual', () => this.e().toContainEqual(expected)); }
  // @ts-ignore
  async toMatch(expected: string | RegExp) { await this.run('toMatch', () => this.e().toMatch(expected)); }
  // @ts-ignore
  async toHaveLength(expected: number) { await this.run('toHaveLength', () => this.e().toHaveLength(expected)); }
  async toMatchObject(expected: Record<string, unknown> | Array<unknown>) {
    await this.run('toMatchObject', () => this.e().toMatchObject(expected as any));
  }
  async toHaveProperty(keyPath: string | Array<string | number>, value?: unknown): Promise<void> {
    // @ts-ignore
    await this.run('toHaveProperty', () =>
      value !== undefined
        ? this.e().toHaveProperty(keyPath as string, value)
        : this.e().toHaveProperty(keyPath as string)
    );
  }
  async toThrow(expected?: string | RegExp | Error | Function): Promise<void> {
    // @ts-ignore
    await this.run('toThrow', () =>
      expected !== undefined ? this.e().toThrow(expected) : this.e().toThrow()
    );
  }

  get not(): LoggedValueAssertions {
    return new LoggedValueAssertions(this._actual, this._tcId, this._stepCounter, true, this._soft);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── LOCATOR ASSERTIONS ───────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
//
// One abstract base class holds every assertion method once.
// Four concrete subclasses differ only in _negated / _soft / _collector.
//
// Log format (normal):
//   In Step - N - Asserting [toBeVisible] on getByRole('button', { name: 'Submit' })
//   In Step - N - Asserted  [toBeVisible] on getByRole('button', { name: 'Submit' })
//
// Log format (negated):
//   In Step - N - Asserting [NOT toBeVisible] on ...
//
// Log format (soft):
//   In Step - N - Soft Asserting [toBeVisible] on ... ── FAILED (soft)

function unwrapLocator(locator: Locator): Locator {
  return locator instanceof LocatorWrapper ? locator.raw() : locator;
}

abstract class BaseLocatorAssertions {
  protected abstract get _negated(): boolean;
  protected abstract get _soft(): boolean;
  protected abstract get _collector(): SoftAssertionCollector | undefined;

  constructor(
    protected readonly _rawLocator: Locator,
    protected readonly _page: Page,
    protected readonly _description: string,
    protected readonly _tcId: string | undefined,
    protected readonly _testInfo: TestInfo | undefined,
    protected readonly _stepCounter: StepCounter
  ) { }

  protected e() {
    return this._negated ? baseExpect(this._rawLocator).not : baseExpect(this._rawLocator);
  }

  protected async run(assertionName: string, fn: () => void | Promise<void>): Promise<void> {
    await runAssertion({
      tcId: this._tcId,
      stepCounter: this._stepCounter,
      assertionName,
      description: this._description,
      fn,
      page: this._page,
      testInfo: this._testInfo,
      prefix: this._negated ? 'NOT ' : '',
      collector: this._collector,
    });
  }

  // ── Visibility / Presence ──────────────────────────────────────────────────
  async toBeVisible(options?: { timeout?: number }) { await this.run('toBeVisible', () => this.e().toBeVisible(options)); }
  async toBeHidden(options?: { timeout?: number }) { await this.run('toBeHidden', () => this.e().toBeHidden(options)); }
  async toBeAttached(options?: { attached?: boolean; timeout?: number }) { await this.run('toBeAttached', () => this.e().toBeAttached(options)); }
  // ── Enabled / Disabled ────────────────────────────────────────────────────
  async toBeEnabled(options?: { timeout?: number }) { await this.run('toBeEnabled', () => this.e().toBeEnabled(options)); }
  async toBeDisabled(options?: { timeout?: number }) { await this.run('toBeDisabled', () => this.e().toBeDisabled(options)); }
  // ── Checked ───────────────────────────────────────────────────────────────
  async toBeChecked(options?: { checked?: boolean; timeout?: number }) { await this.run('toBeChecked', () => this.e().toBeChecked(options)); }
  // ── Editable / Focus ──────────────────────────────────────────────────────
  async toBeEditable(options?: { editable?: boolean; timeout?: number }) { await this.run('toBeEditable', () => this.e().toBeEditable(options)); }
  async toBeFocused(options?: { timeout?: number }) { await this.run('toBeFocused', () => this.e().toBeFocused(options)); }
  // ── Text ──────────────────────────────────────────────────────────────────
  async toHaveText(
    expected: string | RegExp | Array<string | RegExp>,
    options?: { ignoreCase?: boolean; normalizeWhitespace?: boolean; timeout?: number; useInnerText?: boolean }
  ) { await this.run('toHaveText', () => this.e().toHaveText(expected as string, options)); }

  async toContainText(
    expected: string | RegExp | Array<string | RegExp>,
    options?: { ignoreCase?: boolean; normalizeWhitespace?: boolean; timeout?: number; useInnerText?: boolean }
  ) { await this.run('toContainText', () => this.e().toContainText(expected as string, options)); }

  async toHaveInnerText(
    expected: string | RegExp,
    options?: { ignoreCase?: boolean; normalizeWhitespace?: boolean; timeout?: number }
  ) { await this.run('toHaveInnerText', () => this.e().toHaveText(expected, options)); }
  // ── Value ─────────────────────────────────────────────────────────────────
  async toHaveValue(expected: string | RegExp, options?: { timeout?: number }) { await this.run('toHaveValue', () => this.e().toHaveValue(expected, options)); }
  async toHaveValues(expected: Array<string | RegExp>, options?: { timeout?: number }) { await this.run('toHaveValues', () => this.e().toHaveValues(expected, options)); }
  // ── Attributes & CSS ──────────────────────────────────────────────────────
  async toHaveAttribute(name: string, value?: string | RegExp, options?: { ignoreCase?: boolean; timeout?: number }) {
    await this.run(`toHaveAttribute(${name})`, () => this.e().toHaveAttribute(name, value!, options));
  }
  async toHaveClass(expected: string | RegExp | Array<string | RegExp>, options?: { timeout?: number }) {
    await this.run('toHaveClass', () => this.e().toHaveClass(expected as string, options));
  }
  async toHaveCSS(
    name: string,
    value: string | RegExp,
    options?: { pseudo?: '::before' | '::after'; timeout?: number }
  ) {
    await this.run(`toHaveCSS(${name})`, () => this.e().toHaveCSS(name, value));
  }
  // ── Count / ID / Role ─────────────────────────────────────────────────────
  async toHaveCount(count: number, options?: { timeout?: number }) { await this.run(`toHaveCount(${count})`, () => this.e().toHaveCount(count, options)); }
  async toHaveId(id: string | RegExp, options?: { timeout?: number }) { await this.run('toHaveId', () => this.e().toHaveId(id, options)); }
  async toHaveRole(role: string, options?: { timeout?: number }) {
    // @ts-ignore — toHaveRole added in Playwright 1.44
    await this.run(`toHaveRole(${role})`, () => this.e().toHaveRole(role, options));
  }
  // ── Accessibility ─────────────────────────────────────────────────────────
  async toHaveAccessibleName(name: string | RegExp, options?: { ignoreCase?: boolean; timeout?: number }) {
    await this.run('toHaveAccessibleName', () => this.e().toHaveAccessibleName(name, options));
  }
  async toHaveAccessibleDescription(desc: string | RegExp, options?: { ignoreCase?: boolean; timeout?: number }) {
    await this.run('toHaveAccessibleDescription', () => this.e().toHaveAccessibleDescription(desc, options));
  }
  async toHaveAccessibleErrorMessage(msg: string | RegExp, options?: { ignoreCase?: boolean; timeout?: number }) {
    // @ts-ignore — added in Playwright 1.50
    await this.run('toHaveAccessibleErrorMessage', () => this.e().toHaveAccessibleErrorMessage(msg, options));
  }
  // ── Viewport ──────────────────────────────────────────────────────────────
  async toBeInViewport(options?: { ratio?: number; timeout?: number }) { await this.run('toBeInViewport', () => this.e().toBeInViewport(options)); }
  // ── Screenshot ────────────────────────────────────────────────────────────
  async toHaveScreenshot(name?: string | string[], options?: any): Promise<void> {
    const assertionName = name
      ? `toHaveScreenshot(${Array.isArray(name) ? name.join('/') : name})`
      : 'toHaveScreenshot';
    await this.run(assertionName, () =>
      name
        ? (this.e() as any).toHaveScreenshot(name, options)
        : (this.e() as any).toHaveScreenshot(options)
    );
  }

  // ── Aria Snapshot ─────────────────────────────────────────────────────────
  async toMatchAriaSnapshot(
    expectedOrOptions?: string | { name?: string; timeout?: number },
    options?: { timeout?: number }
  ): Promise<void> {
    // Overload 1: toMatchAriaSnapshot(expected: string, options?)
    // Overload 2: toMatchAriaSnapshot(options?)  ← file-based snapshot
    const isInline = typeof expectedOrOptions === 'string';
    const assertionName = isInline
      ? 'toMatchAriaSnapshot'
      : expectedOrOptions?.name
        ? `toMatchAriaSnapshot({ name: '${expectedOrOptions.name}' })`
        : 'toMatchAriaSnapshot';

    await this.run(assertionName, () => {
      if (isInline) {
        // @ts-ignore — added in Playwright 1.49
        return (this.e() as any).toMatchAriaSnapshot(expectedOrOptions, options);
      }
      // @ts-ignore — added in Playwright 1.50 (options-only overload)
      return (this.e() as any).toMatchAriaSnapshot(expectedOrOptions);
    });
  }
}


// ─── Concrete locator assertion variants ─────────────────────────────────────

export class LocatorAssertions extends BaseLocatorAssertions {
  protected get _negated() { return false; }
  protected get _soft() { return false; }
  protected get _collector() { return undefined as SoftAssertionCollector | undefined; }

  constructor(locator: Locator, page: Page, description: string, tcId: string | undefined, testInfo: TestInfo | undefined, stepCounter: StepCounter) {
    super(unwrapLocator(locator), page, description, tcId, testInfo, stepCounter);
  }
  get not(): NegatedLocatorAssertions {
    return new NegatedLocatorAssertions(this._rawLocator, this._page, this._description, this._tcId, this._testInfo, this._stepCounter);
  }
}

export class NegatedLocatorAssertions extends BaseLocatorAssertions {
  protected get _negated() { return true; }
  protected get _soft() { return false; }
  protected get _collector() { return undefined as SoftAssertionCollector | undefined; }

  constructor(locator: Locator, page: Page, description: string, tcId: string | undefined, testInfo: TestInfo | undefined, stepCounter: StepCounter) {
    super(unwrapLocator(locator), page, description, tcId, testInfo, stepCounter);
  }
}

export class SoftLocatorAssertions extends BaseLocatorAssertions {
  protected get _negated() { return false; }
  protected get _soft() { return true; }
  protected get _collector() { return this.__collector; }

  constructor(
    locator: Locator, page: Page, description: string,
    tcId: string | undefined, testInfo: TestInfo | undefined,
    stepCounter: StepCounter,
    private readonly __collector: SoftAssertionCollector
  ) {
    super(unwrapLocator(locator), page, description, tcId, testInfo, stepCounter);
  }
  get not(): SoftNegatedLocatorAssertions {
    return new SoftNegatedLocatorAssertions(
      this._rawLocator, this._page, this._description,
      this._tcId, this._testInfo, this._stepCounter, this.__collector
    );
  }
}

export class SoftNegatedLocatorAssertions extends BaseLocatorAssertions {
  protected get _negated() { return true; }
  protected get _soft() { return true; }
  protected get _collector() { return this.__collector; }

  constructor(
    locator: Locator, page: Page, description: string,
    tcId: string | undefined, testInfo: TestInfo | undefined,
    stepCounter: StepCounter,
    private readonly __collector: SoftAssertionCollector
  ) {
    super(unwrapLocator(locator), page, description, tcId, testInfo, stepCounter);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── PAGE-LEVEL ASSERTIONS ───────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

abstract class BasePageAssertions {
  protected abstract get _negated(): boolean;
  protected abstract get _collector(): SoftAssertionCollector | undefined;

  constructor(
    protected readonly _page: Page,
    protected readonly _tcId: string | undefined,
    protected readonly _testInfo: TestInfo | undefined,
    protected readonly _stepCounter: StepCounter
  ) { }

  protected e() { return this._negated ? baseExpect(this._page).not : baseExpect(this._page); }

  protected async run(assertionName: string, fn: () => Promise<void>): Promise<void> {
    await runAssertion({
      tcId: this._tcId,
      stepCounter: this._stepCounter,
      assertionName,
      description: 'page',
      fn,
      page: this._page,
      testInfo: this._testInfo,
      prefix: this._negated ? 'NOT ' : '',
      collector: this._collector,
    });
  }

  async toHaveURL(url: string | RegExp, options?: { ignoreCase?: boolean; timeout?: number }) { await this.run('toHaveURL', () => this.e().toHaveURL(url, options)); }
  async toHaveTitle(title: string | RegExp, options?: { timeout?: number }) { await this.run('toHaveTitle', () => this.e().toHaveTitle(title, options)); }
  async toHaveScreenshot(name?: string | string[], options?: any): Promise<void> {
    const assertionName = name
      ? `toHaveScreenshot(${Array.isArray(name) ? name.join('/') : name})`
      : 'toHaveScreenshot';
    await this.run(assertionName, () =>
      name
        ? (this.e() as any).toHaveScreenshot(name, options)
        : (this.e() as any).toHaveScreenshot(options)
    );
  }
  async toMatchAriaSnapshot(
    expected?: string,
    options?: { timeout?: number }
  ): Promise<void> {
    await this.run('toMatchAriaSnapshot', () =>
      (this.e() as any).toMatchAriaSnapshot(expected, options)
    );
  }
}

export class PageAssertions extends BasePageAssertions {
  protected get _negated() { return false; }
  protected get _collector() { return undefined as SoftAssertionCollector | undefined; }
  get not(): NegatedPageAssertions {
    return new NegatedPageAssertions(this._page, this._tcId, this._testInfo, this._stepCounter);
  }
}

export class NegatedPageAssertions extends BasePageAssertions {
  protected get _negated() { return true; }
  protected get _collector() { return undefined as SoftAssertionCollector | undefined; }
}

export class SoftPageAssertions extends BasePageAssertions {
  protected get _negated() { return false; }
  protected get _collector() { return this.__collector; }

  constructor(
    page: Page, tcId: string | undefined, testInfo: TestInfo | undefined,
    stepCounter: StepCounter,
    private readonly __collector: SoftAssertionCollector
  ) { super(page, tcId, testInfo, stepCounter); }

  get not(): SoftNegatedPageAssertions {
    return new SoftNegatedPageAssertions(
      this._page, this._tcId, this._testInfo, this._stepCounter, this.__collector
    );
  }
}

export class SoftNegatedPageAssertions extends BasePageAssertions {
  protected get _negated() { return true; }
  protected get _collector() { return this.__collector; }

  constructor(
    page: Page, tcId: string | undefined, testInfo: TestInfo | undefined,
    stepCounter: StepCounter,
    private readonly __collector: SoftAssertionCollector
  ) { super(page, tcId, testInfo, stepCounter); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── VALUE ASSERTIONS (back-compat alias for page.assertValue()) ─────────────
// ═══════════════════════════════════════════════════════════════════════════════

export class ValueAssertions<T> extends LoggedValueAssertions {
  constructor(value: T, _label: string, tcId: string | undefined, stepCounter: StepCounter) {
    super(value, tcId, stepCounter);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── FRAME LOCATOR WRAPPER ───────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

export class FrameLocatorWrapper {
  private readonly _frameLocator: FrameLocator;
  private readonly _page: Page;
  private readonly _description: string;
  private readonly _stepCounter: StepCounter;
  private readonly _testInfo?: TestInfo;

  constructor(
    frameLocator: FrameLocator, page: Page, description: string,
    stepCounter: StepCounter, testInfo?: TestInfo
  ) {
    this._frameLocator = frameLocator;
    this._page = page;
    this._description = description;
    this._stepCounter = stepCounter;
    this._testInfo = testInfo;

    return new Proxy(this, {
      get(target, prop, receiver) {
        if (prop in target) {
          const v = Reflect.get(target, prop, receiver);
          return typeof v === 'function' ? v.bind(target) : v;
        }
        const raw = target._frameLocator;
        const pw = Reflect.get(raw, prop, raw);
        return typeof pw === 'function'
          ? (...args: unknown[]) => (pw as Function).apply(raw, args)
          : pw;
      },
      getPrototypeOf: (t) => Object.getPrototypeOf(t._frameLocator),
    });
  }

  private wrap(locator: Locator, desc: string): LocatorWrapper {
    return new LocatorWrapper(locator, this._page, desc, this._stepCounter, this._testInfo);
  }
  private wrapFrame(fl: FrameLocator, desc: string): FrameLocatorWrapper {
    return new FrameLocatorWrapper(fl, this._page, desc, this._stepCounter, this._testInfo);
  }

  frameLocator(selector: string) { return this.wrapFrame(this._frameLocator.frameLocator(selector), `frameLocator('${selector}')`); }
  locator(selector: string, opts?: Parameters<FrameLocator['locator']>[1]) { return this.wrap(this._frameLocator.locator(selector, opts), buildLocatorDescription('locator', opts ? [selector, opts] : [selector])); }
  getByRole(...args: Parameters<FrameLocator['getByRole']>) { return this.wrap(this._frameLocator.getByRole(...args), buildLocatorDescription('getByRole', args as unknown[])); }
  getByText(...args: Parameters<FrameLocator['getByText']>) { return this.wrap(this._frameLocator.getByText(...args), buildLocatorDescription('getByText', args as unknown[])); }
  getByLabel(...args: Parameters<FrameLocator['getByLabel']>) { return this.wrap(this._frameLocator.getByLabel(...args), buildLocatorDescription('getByLabel', args as unknown[])); }
  getByPlaceholder(...args: Parameters<FrameLocator['getByPlaceholder']>) { return this.wrap(this._frameLocator.getByPlaceholder(...args), buildLocatorDescription('getByPlaceholder', args as unknown[])); }
  getByTestId(...args: Parameters<FrameLocator['getByTestId']>) { return this.wrap(this._frameLocator.getByTestId(...args), buildLocatorDescription('getByTestId', args as unknown[])); }
  getByAltText(...args: Parameters<FrameLocator['getByAltText']>) { return this.wrap(this._frameLocator.getByAltText(...args), buildLocatorDescription('getByAltText', args as unknown[])); }
  getByTitle(...args: Parameters<FrameLocator['getByTitle']>) { return this.wrap(this._frameLocator.getByTitle(...args), buildLocatorDescription('getByTitle', args as unknown[])); }

  raw(): FrameLocator { return this._frameLocator; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── CONTEXT WRAPPER ─────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

export class ContextWrapper {
  private readonly _context: BrowserContext;
  private readonly _testInfo?: TestInfo;
  // public so the page fixture can read it without string-keyed access
  readonly _stepCounter: StepCounter;

  constructor(context: BrowserContext, testInfo: TestInfo | undefined, stepCounter: StepCounter) {
    this._context = context;
    this._testInfo = testInfo;
    this._stepCounter = stepCounter;

    return new Proxy(this, {
      get(target, prop, receiver) {
        if (prop in target) {
          const v = Reflect.get(target, prop, receiver);
          return typeof v === 'function' ? v.bind(target) : v;
        }
        const raw = target._context;
        const pw = Reflect.get(raw, prop, raw);
        return typeof pw === 'function'
          ? (...args: unknown[]) => (pw as Function).apply(raw, args)
          : pw;
      },
      getPrototypeOf: (t) => Object.getPrototypeOf(t._context),
    });
  }

  private get _tcId() { return resolveTcId(this._testInfo); }

  private wrapPage(rawPage: Page): PageWrapper {
    return new PageWrapper(rawPage, this._testInfo, this._stepCounter);
  }

  async waitForEvent(event: string, options?: unknown): Promise<unknown> {
    if (event === 'page') {
      await log('INFO', fmt(this._tcId, 'Waiting for new page/tab to open...'));
      const rawPage = await this._context.waitForEvent('page', options as any);
      await log('INFO', fmt(this._tcId, `New page opened — url: "${(rawPage as Page).url()}"`));
      return this.wrapPage(rawPage as Page);
    }
    return this._context.waitForEvent(event as any, options as any);
  }

  on(event: string, handler: (...args: unknown[]) => void): this {
    const tcId = this._tcId;
    const descFn = CONTEXT_EVENT_DESCRIPTIONS[event.toLowerCase()];
    if (event === 'page') {
      this._context.on('page', async (rawPage: Page) => {
        await log('INFO', fmt(tcId, `[context.on('page')] New page opened — url: "${rawPage.url()}"`));
        handler(this.wrapPage(rawPage));
      });
      return this;
    }
    this._context.on(event as any, async (...args: any[]) => {
      const description = descFn
        ? descFn(...args)
        : `Event "${event}" fired${args.length ? ` with ${args.length} argument(s)` : ''}`;
      log('INFO', fmt(tcId, `[context.on('${event}')] ${description}`)).catch(() => { });
      await (handler as any)(...args);
    });
    return this;
  }

  raw(): BrowserContext { return this._context; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── LOCATOR WRAPPER ─────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

export class LocatorWrapper {
  private readonly _locator: Locator;
  private readonly _page: Page;
  readonly _description: string;   // public for serializeOptions (filter has/hasNot)
  private readonly _stepCounter: StepCounter;
  private readonly _testInfo?: TestInfo;

  constructor(
    locator: Locator, page: Page, description: string,
    stepCounter: StepCounter, testInfo?: TestInfo
  ) {
    this._locator = locator;
    this._page = page;
    this._description = description;
    this._stepCounter = stepCounter;
    this._testInfo = testInfo;

    return new Proxy(this, {
      get(target, prop, receiver) {
        if (prop in target) {
          const v = Reflect.get(target, prop, receiver);
          return typeof v === 'function' ? v.bind(target) : v;
        }
        const raw = target._locator;
        const pw = Reflect.get(raw, prop, raw);
        if (typeof pw === 'function') {
          return (...args: unknown[]) => {
            const result = (pw as Function).apply(raw, args);
            if (result && typeof result === 'object' && '_selector' in result) {
              return new LocatorWrapper(
                result as Locator, target._page,
                `${target._description} >> ${buildLocatorDescription(String(prop), args)}`,
                target._stepCounter, target._testInfo
              );
            }
            return result;
          };
        }
        return pw;
      },
      getPrototypeOf: (t) => Object.getPrototypeOf(t._locator),
    });
  }

  private get _tcId() { return resolveTcId(this._testInfo); }

  private wrap(locator: Locator, description: string): LocatorWrapper {
    return new LocatorWrapper(locator, this._page, description, this._stepCounter, this._testInfo);
  }

  // ── Assertion factories ───────────────────────────────────────────────────

  assertions(): LocatorAssertions {
    return new LocatorAssertions(
      this._locator, this._page, this._description,
      this._tcId, this._testInfo, this._stepCounter
    );
  }

  softAssertions(collector: SoftAssertionCollector): SoftLocatorAssertions {
    return new SoftLocatorAssertions(
      this._locator, this._page, this._description,
      this._tcId, this._testInfo, this._stepCounter, collector
    );
  }

  // ── Chaining helpers ──────────────────────────────────────────────────────

  locator(selector: string, opts?: Parameters<Locator['locator']>[1]) { return this.wrap(this._locator.locator(selector, opts), `${this._description} >> ${buildLocatorDescription('locator', opts ? [selector, opts] : [selector])}`); }
  getByRole(...args: Parameters<Locator['getByRole']>) { return this.wrap(this._locator.getByRole(...args), `${this._description} >> ${buildLocatorDescription('getByRole', args as unknown[])}`); }
  getByText(...args: Parameters<Locator['getByText']>) { return this.wrap(this._locator.getByText(...args), `${this._description} >> ${buildLocatorDescription('getByText', args as unknown[])}`); }
  getByLabel(...args: Parameters<Locator['getByLabel']>) { return this.wrap(this._locator.getByLabel(...args), `${this._description} >> ${buildLocatorDescription('getByLabel', args as unknown[])}`); }
  getByPlaceholder(...args: Parameters<Locator['getByPlaceholder']>) { return this.wrap(this._locator.getByPlaceholder(...args), `${this._description} >> ${buildLocatorDescription('getByPlaceholder', args as unknown[])}`); }
  getByTestId(...args: Parameters<Locator['getByTestId']>) { return this.wrap(this._locator.getByTestId(...args), `${this._description} >> ${buildLocatorDescription('getByTestId', args as unknown[])}`); }
  getByAltText(...args: Parameters<Locator['getByAltText']>) { return this.wrap(this._locator.getByAltText(...args), `${this._description} >> ${buildLocatorDescription('getByAltText', args as unknown[])}`); }
  getByTitle(...args: Parameters<Locator['getByTitle']>) { return this.wrap(this._locator.getByTitle(...args), `${this._description} >> ${buildLocatorDescription('getByTitle', args as unknown[])}`); }
  nth(index: number) { return this.wrap(this._locator.nth(index), `${this._description}.nth(${index})`); }
  first() { return this.wrap(this._locator.first(), `${this._description}.first()`); }
  last() { return this.wrap(this._locator.last(), `${this._description}.last()`); }
  and(other: Locator) { const raw = other instanceof LocatorWrapper ? (other as any)._locator : other; return this.wrap(this._locator.and(raw), `${this._description}.and(...)`); }
  or(other: Locator) { const raw = other instanceof LocatorWrapper ? (other as any)._locator : other; return this.wrap(this._locator.or(raw), `${this._description}.or(...)`); }

  filter(options: Parameters<Locator['filter']>[0]): LocatorWrapper {
    const resolved = { ...options } as Record<string, unknown>;
    const display = { ...options } as Record<string, unknown>;
    if (resolved.has instanceof LocatorWrapper) { display.has = resolved.has; resolved.has = (resolved.has as LocatorWrapper).raw(); }
    if (resolved.hasNot instanceof LocatorWrapper) { display.hasNot = resolved.hasNot; resolved.hasNot = (resolved.hasNot as LocatorWrapper).raw(); }
    const opts = serializeOptions(display);
    return this.wrap(
      this._locator.filter(resolved as Parameters<Locator['filter']>[0]),
      `${this._description}.filter(${opts})`
    );
  }

  // ── Action helper ─────────────────────────────────────────────────────────

  private async act<T>(
    actionLabel: string, completedLabel: string,
    action: () => Promise<T>,
    screenshotOnFailure = true
  ): Promise<T> {
    return runAction({
      page: this._page,
      tcId: this._tcId,
      stepCounter: this._stepCounter,
      description: this._description,
      actionLabel,
      completedLabel,
      action,
      screenshotOnFailure,
      testInfo: this._testInfo,
    });
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  async click(options?: Parameters<Locator['click']>[0]) { await this.act(`Clicking on ${this._description}`, `Clicked on ${this._description}`, () => this._locator.click(options)); }
  async dblclick(options?: Parameters<Locator['dblclick']>[0]) { await this.act(`Double-clicking on ${this._description}`, `Double-clicked on ${this._description}`, () => this._locator.dblclick(options)); }
  async fill(value: string, options?: Parameters<Locator['fill']>[1]) { await this.act(`Filling "${value}" into ${this._description}`, `Filled "${value}" into ${this._description}`, () => this._locator.fill(value, options)); }
  async type(text: string, options?: Parameters<Locator['pressSequentially']>[1]) { await this.act(`Typing "${text}" into ${this._description}`, `Typed "${text}" into ${this._description}`, () => this._locator.pressSequentially(text, options)); }
  async clear(options?: Parameters<Locator['clear']>[0]) { await this.act(`Clearing ${this._description}`, `Cleared ${this._description}`, () => this._locator.clear(options)); }
  async check(options?: Parameters<Locator['check']>[0]) { await this.act(`Checking ${this._description}`, `Checked ${this._description}`, () => this._locator.check(options)); }
  async uncheck(options?: Parameters<Locator['uncheck']>[0]) { await this.act(`Unchecking ${this._description}`, `Unchecked ${this._description}`, () => this._locator.uncheck(options)); }
  async hover(options?: Parameters<Locator['hover']>[0]) { await this.act(`Hovering over ${this._description}`, `Hovered over ${this._description}`, () => this._locator.hover(options)); }
  async focus(options?: Parameters<Locator['focus']>[0]) { await this.act(`Focusing on ${this._description}`, `Focused on ${this._description}`, () => this._locator.focus(options)); }
  async blur(options?: Parameters<Locator['blur']>[0]) { await this.act(`Blurring ${this._description}`, `Blurred ${this._description}`, () => this._locator.blur(options)); }
  async tap(options?: Parameters<Locator['tap']>[0]) { await this.act(`Tapping ${this._description}`, `Tapped ${this._description}`, () => this._locator.tap(options)); }
  async press(key: string, options?: Parameters<Locator['press']>[1]) { await this.act(`Pressing "${key}" on ${this._description}`, `Pressed "${key}" on ${this._description}`, () => this._locator.press(key, options)); }
  async scrollIntoViewIfNeeded(options?: Parameters<Locator['scrollIntoViewIfNeeded']>[0]) { await this.act(`Scrolling into view ${this._description}`, `Scrolled into view ${this._description}`, () => this._locator.scrollIntoViewIfNeeded(options)); }

  async setInputFiles(files: Parameters<Locator['setInputFiles']>[0], options?: Parameters<Locator['setInputFiles']>[1]): Promise<void> {
    await this.act(
      `Setting input files on ${this._description}`,
      `Set input files on ${this._description}`,
      () => this._locator.setInputFiles(files, options)
    );
  }

  async selectOption(values: Parameters<Locator['selectOption']>[0], options?: Parameters<Locator['selectOption']>[1]): Promise<string[]> {
    return this.act(
      `Selecting option in ${this._description}`,
      `Selected option in ${this._description}`,
      () => this._locator.selectOption(values, options)
    );
  }

  async dragTo(target: Locator, options?: Parameters<Locator['dragTo']>[1]): Promise<void> {
    const raw = target instanceof LocatorWrapper ? (target as any)._locator : target;
    const desc = target instanceof LocatorWrapper
      ? (target as any)._description
      : ((target as any)._selector ?? (target as any)._spec ?? 'unknown locator');
    await this.act(
      `Dragging ${this._description} into ${desc}`,
      `Dragged ${this._description} into ${desc}`,
      () => this._locator.dragTo(raw, options)
    );
  }

  async drop(
    options?: Parameters<Locator['drop']>[0]
  ): Promise<void> {
    await this.act(
      `Dropping onto ${this._description}`,
      `Dropped onto ${this._description}`,
      () => (this._locator as any).drop(options)
    );
  }

  async waitFor(options?: Parameters<Locator['waitFor']>[0]): Promise<void> {
    await this.act(
      `Waiting for ${this._description}`,
      `Wait complete for ${this._description}`,
      () => this._locator.waitFor(options),
      false  // screenshotOnFailure = false
    );
  }

  // ── Read-only helpers (simple INFO log, no step block) ───────────────────

  async innerText(options?: Parameters<Locator['innerText']>[0]): Promise<string> { const v = await this._locator.innerText(options); await log('INFO', fmt(this._tcId, `innerText of ${this._description} retrieved`)); return v; }
  async textContent(options?: Parameters<Locator['textContent']>[0]): Promise<string | null> { const v = await this._locator.textContent(options); await log('INFO', fmt(this._tcId, `textContent of ${this._description} retrieved`)); return v; }
  async inputValue(options?: Parameters<Locator['inputValue']>[0]): Promise<string> { const v = await this._locator.inputValue(options); await log('INFO', fmt(this._tcId, `inputValue of ${this._description} retrieved`)); return v; }
  async getAttribute(name: string, options?: Parameters<Locator['getAttribute']>[1]): Promise<string | null> { const v = await this._locator.getAttribute(name, options); await log('INFO', fmt(this._tcId, `getAttribute(${name}) of ${this._description} retrieved`)); return v; }
  async isVisible(options?: Parameters<Locator['isVisible']>[0]): Promise<boolean> { const v = await this._locator.isVisible(options); await log('INFO', fmt(this._tcId, `isVisible of ${this._description}: ${v}`)); return v; }
  async isEnabled(options?: Parameters<Locator['isEnabled']>[0]): Promise<boolean> { const v = await this._locator.isEnabled(options); await log('INFO', fmt(this._tcId, `isEnabled of ${this._description}: ${v}`)); return v; }
  async isChecked(options?: Parameters<Locator['isChecked']>[0]): Promise<boolean> { const v = await this._locator.isChecked(options); await log('INFO', fmt(this._tcId, `isChecked of ${this._description}: ${v}`)); return v; }
  async count(): Promise<number> { const v = await this._locator.count(); await log('INFO', fmt(this._tcId, `count of ${this._description}: ${v}`)); return v; }

  raw(): Locator { return this._locator; }

  contentFrame(): FrameLocatorWrapper {
    return new FrameLocatorWrapper(
      this._locator.contentFrame(), this._page,
      `${this._description}.contentFrame()`,
      this._stepCounter, this._testInfo
    );
  }

  context(): ContextWrapper {
    return new ContextWrapper(this._page.context(), this._testInfo, this._stepCounter);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── PAGE EVENT DESCRIPTIONS ─────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

const PAGE_EVENT_DESCRIPTIONS: Record<string, (...args: any[]) => string> = {
  dialog: (d: any) => `Dialog appeared — type: "${d?.type?.() ?? 'unknown'}", message: "${d?.message?.() ?? ''}"`,
  download: (dl: any) => `Download started — suggested filename: "${dl?.suggestedFilename?.() ?? 'unknown'}"`,
  filechooser: () => `File chooser opened`,
  frameattached: (f: any) => `Frame attached — url: "${f?.url?.() ?? 'unknown'}"`,
  framedetached: (f: any) => `Frame detached — url: "${f?.url?.() ?? 'unknown'}"`,
  framenavigated: (f: any) => `Frame navigated — url: "${f?.url?.() ?? 'unknown'}"`,
  load: () => `Page load event fired`,
  domcontentloaded: () => `DOMContentLoaded event fired`,
  pageerror: (e: any) => `Page error: ${e?.message ?? String(e)}`,
  popup: (p: any) => `Popup opened — url: "${p?.url?.() ?? 'unknown'}"`,
  request: (r: any) => `Request: ${r?.method?.() ?? 'unknown'} ${r?.url?.() ?? 'unknown'}`,
  requestfailed: (r: any) => `Request failed: ${r?.method?.() ?? 'unknown'} ${r?.url?.() ?? 'unknown'} — ${r?.failure?.()?.errorText ?? 'unknown error'}`,
  requestfinished: (r: any) => `Request finished: ${r?.method?.() ?? 'unknown'} ${r?.url?.() ?? 'unknown'}`,
  response: (r: any) => `Response: ${r?.status?.() ?? 'unknown'} ${r?.url?.() ?? 'unknown'}`,
  websocket: (ws: any) => `WebSocket opened — url: "${ws?.url?.() ?? 'unknown'}"`,
  worker: (w: any) => `Worker created — url: "${w?.url?.() ?? 'unknown'}"`,
  pageclose: (p: any) => `Page closed — url: "${p?.url?.() ?? 'unknown'}"`,
  pageload: (p: any) => `Page loaded — url: "${p?.url?.() ?? 'unknown'}"`,
};

const CONTEXT_EVENT_DESCRIPTIONS: Record<string, (...args: any[]) => string> = {
  download: (dl: any) => `Download started — suggested filename: "${dl?.suggestedFilename?.() ?? 'unknown'}"`,
  frameattached: (f: any) => `Frame attached — url: "${f?.url?.() ?? 'unknown'}"`,
  framedetached: (f: any) => `Frame detached — url: "${f?.url?.() ?? 'unknown'}"`,
  framenavigated: (f: any) => `Frame navigated — url: "${f?.url?.() ?? 'unknown'}"`,
  pageclose: (p: any) => `Page closed — url: "${p?.url?.() ?? 'unknown'}"`,
  pageload: (p: any) => `Page loaded — url: "${p?.url?.() ?? 'unknown'}"`,
  page: (p: any) => `New page opened — url: "${p?.url?.() ?? 'unknown'}"`,
};

// ═══════════════════════════════════════════════════════════════════════════════
// ─── PAGE WRAPPER ────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

export class PageWrapper {
  readonly _page: Page;
  readonly _stepCounter: StepCounter;
  readonly _testInfo?: TestInfo;
  private readonly _softCollector: SoftAssertionCollector;

  constructor(page: Page, testInfo?: TestInfo, stepCounter?: StepCounter) {
    this._page = page;
    this._testInfo = testInfo;
    this._stepCounter = stepCounter ?? new StepCounter();
    this._softCollector = new SoftAssertionCollector();

    return new Proxy(this, {
      get(target, prop, receiver) {
        if (prop in target) {
          const v = Reflect.get(target, prop, receiver);
          return typeof v === 'function' ? v.bind(target) : v;
        }
        const raw = target._page;
        const pw = Reflect.get(raw, prop, raw);
        return typeof pw === 'function'
          ? (...args: unknown[]) => (pw as Function).apply(raw, args)
          : pw;
      },
      getPrototypeOf: (t) => Object.getPrototypeOf(t._page),
    });
  }

  private get _tcId() { return resolveTcId(this._testInfo); }

  // ── Assertion factories ───────────────────────────────────────────────────

  assertions(): PageAssertions { return new PageAssertions(this._page, this._tcId, this._testInfo, this._stepCounter); }
  softAssertions(): SoftPageAssertions { return new SoftPageAssertions(this._page, this._tcId, this._testInfo, this._stepCounter, this._softCollector); }

  assertValue<T>(value: T, label = String(value)): ValueAssertions<T> {
    return new ValueAssertions<T>(value, label, this._tcId, this._stepCounter);
  }

  getSoftCollector(): SoftAssertionCollector { return this._softCollector; }

  // ── Convenience assertion shortcuts ──────────────────────────────────────

  async toHaveURL(url: string | RegExp, options?: { ignoreCase?: boolean; timeout?: number }) { return this.assertions().toHaveURL(url, options); }
  async toHaveTitle(title: string | RegExp, options?: { timeout?: number }) { return this.assertions().toHaveTitle(title, options); }
  async toHaveScreenshot(name?: string | string[], options?: any) { return this.assertions().toHaveScreenshot(name, options); }

  // ── page.on() with structured logging ─────────────────────────────────────

  on(event: string, handler: (...args: any[]) => void): this {
    const tcId = this._tcId;
    const descFn = PAGE_EVENT_DESCRIPTIONS[event.toLowerCase()];
    const wrapped = async (...args: any[]) => {
      const description = descFn
        ? descFn(...args)
        : `Event "${event}" fired${args.length ? ` with ${args.length} argument(s)` : ''}`;
      log('INFO', fmt(tcId, `[page.on('${event}')] ${description}`)).catch(() => { });
      await handler(...args);
    };
    this._page.on(event as any, wrapped);
    return this;
  }

  // ── waitForEvent ──────────────────────────────────────────────────────────

  async waitForEvent(event: string, options?: unknown): Promise<unknown> {
    if (event === 'popup') {
      await log('INFO', fmt(this._tcId, 'Waiting for popup window to open...'));
      const rawPage = await this._page.waitForEvent('popup', options as any);
      await log('INFO', fmt(this._tcId, `Popup opened — url: "${(rawPage as Page).url()}"`));
      return new PageWrapper(rawPage as Page, this._testInfo, this._stepCounter);
    }
    return this._page.waitForEvent(event as any, options as any);
  }

  // ── Action helper ─────────────────────────────────────────────────────────

  private async act<T>(
    actionLabel: string, completedLabel: string,
    action: () => Promise<T>,
    screenshotOnFailure = true
  ): Promise<T> {
    return runAction({
      page: this._page,
      tcId: this._tcId,
      stepCounter: this._stepCounter,
      actionLabel,
      completedLabel,
      action,
      screenshotOnFailure,
      testInfo: this._testInfo,
    });
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  async goto(url: string, options?: Parameters<Page['goto']>[1]) {
    const isRelative = url.startsWith('/') || (!url.startsWith('http://') && !url.startsWith('https://'));
    const baseUrl = (this._page.context() as any)?._options?.baseURL
      ?? process.env.BASE_URL
      ?? 'baseURL (from playwright.config)';
    return this.act(
      url === '/' ? `Navigating to ${baseUrl}` : `Navigating to "${url}"`,
      url === '/' ? `Navigated to ${baseUrl}` : `Navigated to "${url}"`,
      () => this._page.goto(url, options)
    );
  }

  async reload(options?: Parameters<Page['reload']>[0]) {
    return this.act(
      `Reloading page — current url: ${this._page.url()}`,
      `Reloaded page — now at: ${this._page.url()}`,
      () => this._page.reload(options)
    );
  }

  async goBack(options?: Parameters<Page['goBack']>[0]) {
    return this.act(
      `Navigating back — current url: ${this._page.url()}`,
      `Navigated back`,
      () => this._page.goBack(options)
    );
  }

  async goForward(options?: Parameters<Page['goForward']>[0]) {
    return this.act(
      `Navigating forward — current url: ${this._page.url()}`,
      `Navigated forward`,
      () => this._page.goForward(options)
    );
  }

  async toMatchAriaSnapshot(expected?: string, options?: { timeout?: number }) {
    return this.assertions().toMatchAriaSnapshot(expected, options);
  }

  async waitForURL(url: Parameters<Page['waitForURL']>[0], options?: Parameters<Page['waitForURL']>[1]) {
    return this.act(
      `Waiting for URL: ${url}`,
      `URL reached: ${url}`,
      () => this._page.waitForURL(url, options),
      false  // screenshotOnFailure = false
    );
  }

  async waitForLoadState(
    state?: Parameters<Page['waitForLoadState']>[0],
    options?: Parameters<Page['waitForLoadState']>[1]
  ) {
    return this.act(
      `Waiting for load state: ${state ?? 'load'}`,
      `Load state reached: ${state ?? 'load'}`,
      () => this._page.waitForLoadState(state, options),
      false  // screenshotOnFailure = false
    );
  }

  async waitForSelector(selector: string, options?: Parameters<Page['waitForSelector']>[1]) {
    return this.act(
      `Waiting for selector ${selector}`,
      `Selector found: ${selector}`,
      () => this._page.waitForSelector(selector)
    );
  }

  // ── Page-level locator factories ──────────────────────────────────────────

  private makeLocator(locator: Locator, desc: string): LocatorWrapper {
    return new LocatorWrapper(locator, this._page, desc, this._stepCounter, this._testInfo);
  }

  locator(selector: string, opts?: Parameters<Page['locator']>[1]) { return this.makeLocator(this._page.locator(selector, opts), buildLocatorDescription('locator', opts ? [selector, opts] : [selector])); }
  getByRole(...args: Parameters<Page['getByRole']>) { return this.makeLocator(this._page.getByRole(...args), buildLocatorDescription('getByRole', args as unknown[])); }
  getByText(...args: Parameters<Page['getByText']>) { return this.makeLocator(this._page.getByText(...args), buildLocatorDescription('getByText', args as unknown[])); }
  getByLabel(...args: Parameters<Page['getByLabel']>) { return this.makeLocator(this._page.getByLabel(...args), buildLocatorDescription('getByLabel', args as unknown[])); }
  getByPlaceholder(...args: Parameters<Page['getByPlaceholder']>) { return this.makeLocator(this._page.getByPlaceholder(...args), buildLocatorDescription('getByPlaceholder', args as unknown[])); }
  getByTestId(...args: Parameters<Page['getByTestId']>) { return this.makeLocator(this._page.getByTestId(...args), buildLocatorDescription('getByTestId', args as unknown[])); }
  getByAltText(...args: Parameters<Page['getByAltText']>) { return this.makeLocator(this._page.getByAltText(...args), buildLocatorDescription('getByAltText', args as unknown[])); }
  getByTitle(...args: Parameters<Page['getByTitle']>) { return this.makeLocator(this._page.getByTitle(...args), buildLocatorDescription('getByTitle', args as unknown[])); }

  frameLocator(selector: string): FrameLocatorWrapper {
    return new FrameLocatorWrapper(
      this._page.frameLocator(selector), this._page,
      `frameLocator('${selector}')`,
      this._stepCounter, this._testInfo
    );
  }

  // ── Page-level legacy selector actions ───────────────────────────────────

  async click(selector: string, options?: Parameters<Page['click']>[1]): Promise<void> {
    await this.act(
      `Clicking ${selector}`, `Clicked ${selector}`,
      () => this._page.click(selector, options)
    );
  }

  async fill(selector: string, value: string, options?: Parameters<Page['fill']>[2]): Promise<void> {
    await this.act(
      `Filling "${value}" into ${selector}`, `Filled "${value}" into ${selector}`,
      () => this._page.fill(selector, value, options)
    );
  }

  // ── Screenshot ────────────────────────────────────────────────────────────

  async screenshot(options?: Parameters<Page['screenshot']>[0]): Promise<Buffer> {
    await log('INFO', fmt(this._tcId, 'Taking page screenshot'));
    return this._page.screenshot(options);
  }

  // ── Screencast helpers ────────────────────────────────────────────────────

  async startScreencast(options?: {
    path?: string;
    size?: { width: number; height: number };
    onFrame?: (frame: { data: Buffer; timestamp: number }) => void;
  }): Promise<void> {
    await log('INFO', fmt(this._tcId, 'Starting screencast recording'));
    try {
      await (this._page as any).screencast.start(options ?? {});
      await log('INFO', fmt(this._tcId, 'Screencast recording started'));
    } catch (e) {
      await log('ERROR', fmt(this._tcId, `Failed to start screencast: ${extractErrorMessage(e)}`));
      throw e;
    }
  }

  async stopScreencast(): Promise<void> {
    await log('INFO', fmt(this._tcId, 'Stopping screencast recording'));
    try {
      await (this._page as any).screencast.stop();
      await log('INFO', fmt(this._tcId, 'Screencast recording stopped'));
    } catch (e) {
      await log('ERROR', fmt(this._tcId, `Failed to stop screencast: ${extractErrorMessage(e)}`));
      throw e;
    }
  }

  async hideHighlight(): Promise<void> {
    await log('INFO', fmt(this._tcId, 'Hiding all locator highlights'));
    await (this._page as any).hideHighlight();
  }

  async showScreencastActions(options?: {
    position?: 'top-left' | 'top' | 'top-right' | 'bottom-left' | 'bottom' | 'bottom-right';
    duration?: number;
    fontSize?: number;
  }): Promise<{ dispose: () => Promise<void> }> {
    await log('INFO', fmt(this._tcId, `Enabling screencast action annotations (position: ${options?.position ?? 'default'})`));
    try {
      const disposable = await (this._page as any).screencast.showActions(options ?? {});
      await log('INFO', fmt(this._tcId, 'Screencast action annotations enabled'));
      return {
        dispose: async () => {
          await log('INFO', fmt(this._tcId, 'Disabling screencast action annotations'));
          if (typeof disposable?.[Symbol.asyncDispose] === 'function')
            await disposable[Symbol.asyncDispose]();
          else if (typeof disposable?.dispose === 'function')
            await disposable.dispose();
        },
      };
    } catch (e) {
      await log('ERROR', fmt(this._tcId, `Failed to enable action annotations: ${extractErrorMessage(e)}`));
      throw e;
    }
  }

  async hideScreencastActions(): Promise<void> {
    await log('INFO', fmt(this._tcId, 'Hiding screencast action annotations'));
    try { await (this._page as any).screencast.hideActions(); await log('INFO', fmt(this._tcId, 'Screencast action annotations hidden')); }
    catch (e) { await log('WARN', fmt(this._tcId, `hideScreencastActions failed: ${extractErrorMessage(e)}`)); }
  }

  async showScreencastChapter(title: string, options?: { description?: string; duration?: number }): Promise<void> {
    await log('INFO', fmt(this._tcId, `Showing screencast chapter: "${title}"${options?.description ? ` — ${options.description}` : ''}`));
    try { await (this._page as any).screencast.showChapter(title, options ?? {}); }
    catch (e) { await log('WARN', fmt(this._tcId, `showScreencastChapter failed: ${extractErrorMessage(e)}`)); }
  }

  async showScreencastOverlay(html: string): Promise<void> {
    await log('INFO', fmt(this._tcId, 'Showing screencast HTML overlay'));
    try { await (this._page as any).screencast.showOverlay(html); }
    catch (e) { await log('WARN', fmt(this._tcId, `showScreencastOverlay failed: ${extractErrorMessage(e)}`)); }
  }

  async hideScreencastOverlays(): Promise<void> {
    await log('INFO', fmt(this._tcId, 'Hiding all screencast overlays'));
    try { await (this._page as any).screencast.hideOverlays(); }
    catch (e) { await log('WARN', fmt(this._tcId, `hideScreencastOverlays failed: ${extractErrorMessage(e)}`)); }
  }

  async showScreencastOverlays(): Promise<void> {
    await log('INFO', fmt(this._tcId, 'Showing all screencast overlays'));
    try { await (this._page as any).screencast.showOverlays(); }
    catch (e) { await log('WARN', fmt(this._tcId, `showScreencastOverlays failed: ${extractErrorMessage(e)}`)); }
  }

  raw(): Page { return this._page; }

  context(): ContextWrapper {
    return new ContextWrapper(this._page.context(), this._testInfo, this._stepCounter);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── ACTIVE CONTEXT REGISTRY ─────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
// Allows smartExpect(plainValue) to pick up the running test's StepCounter
// so plain-value assertions are also step-logged.

let _activeStepCounter: StepCounter | undefined;
let _activeTcId: string | undefined;
let _activeTestId: string | undefined;

export function setActiveContext(stepCounter: StepCounter, tcId: string | undefined, testId?: string): void {
  _activeStepCounter = stepCounter;
  _activeTcId = tcId;
  _activeTestId = testId;
}

export function clearActiveContext(): void {
  _activeStepCounter = undefined;
  _activeTcId = undefined;
  _activeTestId = undefined;
}
// ═══════════════════════════════════════════════════════════════════════════════
// ─── SMART EXPECT ────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

function isApiResponseWrapper(v: unknown): v is ApiResponseWrapper {
  return v !== null && typeof v === 'object' && (v as any).__isApiResponseWrapper === true;
}
function isPageWrapper(v: unknown): v is PageWrapper {
  return v !== null && typeof v === 'object'
    && typeof (v as any).goto === 'function'
    && typeof (v as any).assertions === 'function';
}
function isLocatorWrapper(v: unknown): v is LocatorWrapper {
  return v !== null && typeof v === 'object'
    && typeof (v as any).raw === 'function'
    && typeof (v as any).assertions === 'function'
    && !isPageWrapper(v);
}

/** Returns the most-recently registered API test context (for API-only tests). */
function resolveCounter(): StepCounter | undefined {
  if (_activeStepCounter !== undefined) return _activeStepCounter;
  if (_activeTestId !== undefined) return _apiTestContextRegistry.get(_activeTestId)?.stepCounter;
  return undefined;

}

function resolveTcIdActive(): string | undefined {
  if (_activeTcId !== undefined) return _activeTcId;
  if (_activeTestId !== undefined) return _apiTestContextRegistry.get(_activeTestId)?.tcId;
  return undefined;
}

// ── Proxy builders ─────────────────────────────────────────────────────────

function proxyNot<T extends { not: any }>(assertions: T): T {
  return new Proxy(assertions, {
    get(target, prop, receiver) {
      if (prop === 'not') return target.not;
      return Reflect.get(target, prop, receiver);
    },
  });
}

function makeLoggedLocatorExpect(wrapper: LocatorWrapper): LocatorAssertions {
  return proxyNot(wrapper.assertions());
}
function makeLoggedPageExpect(wrapper: PageWrapper): PageAssertions {
  return proxyNot(wrapper.assertions());
}
function makeLoggedSoftLocatorExpect(wrapper: LocatorWrapper, collector: SoftAssertionCollector): SoftLocatorAssertions {
  return proxyNot(wrapper.softAssertions(collector));
}
function makeLoggedSoftPageExpect(wrapper: PageWrapper): SoftPageAssertions {
  return proxyNot(wrapper.softAssertions());
}
function makeApiResponseExpect(wrapper: ApiResponseWrapper, soft = false): ApiResponseAssertions {
  const counter = resolveCounter() ?? new StepCounter();
  const tcId = resolveTcIdActive();
  const testInfo = _activeTestId !== undefined
    ? _apiTestContextRegistry.get(_activeTestId)?.testInfo
    : undefined;
  return proxyNot(new ApiResponseAssertions(wrapper, tcId, testInfo, counter, soft));
}

// ── smartExpect + expect.soft ─────────────────────────────────────────────

function buildSmartExpect() {
  const _orig = baseExpect;

  function smartExpect(value: unknown, ...args: unknown[]): any {
    if (isPageWrapper(value)) return makeLoggedPageExpect(value);
    if (isLocatorWrapper(value)) return makeLoggedLocatorExpect(value);
    if (isApiResponseWrapper(value)) return makeApiResponseExpect(value);

    // Plain primitive / array — route through LoggedValueAssertions if a counter is active
    // In buildSmartExpect(), replace the plain-value routing block:

    const counter = resolveCounter();
    const isPlainValue =
      value === null ||
      value === undefined ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      Array.isArray(value) ||
      (typeof value === 'object' &&        // ← ADD THIS
        Object.getPrototypeOf(value) === Object.prototype);

    if (counter !== undefined && isPlainValue) {
      return new LoggedValueAssertions(value, resolveTcIdActive(), counter);
    }

    // Anything else (Buffer, object, etc.) — delegate to native Playwright expect
    return (_orig as any)(value, ...args);
  }

  function softExpect(value: unknown, collectorOrAnything?: unknown, ...rest: unknown[]): any {
    if (isPageWrapper(value)) return makeLoggedSoftPageExpect(value);
    if (isLocatorWrapper(value)) {
      const collector = collectorOrAnything instanceof SoftAssertionCollector
        ? collectorOrAnything
        : new SoftAssertionCollector();
      return makeLoggedSoftLocatorExpect(value, collector);
    }
    if (isApiResponseWrapper(value)) return makeApiResponseExpect(value, true);
    return (_orig as any).soft(value, collectorOrAnything, ...rest);
  }

  (smartExpect as any).soft = softExpect;
  Object.assign(smartExpect, _orig);

  return smartExpect as typeof baseExpect & {
    soft(value: PageWrapper): SoftPageAssertions;
    soft(value: LocatorWrapper, collector?: SoftAssertionCollector): SoftLocatorAssertions;
    soft(value: ApiResponseWrapper): ApiResponseAssertions;
    soft(value: unknown, ...args: unknown[]): any;
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── COMBINED TEST FIXTURES ──────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

type CombinedFixtures = {
  page: PageWrapper;
  context: ContextWrapper;
  request: ApiContextWrapper;
};

export const test = baseTest.extend<CombinedFixtures>({
  // ── BrowserContext ─────────────────────────────────────────────────────────
  context: [
    async ({ context }, use, testInfo) => {
      const stepCounter = new StepCounter();
      const wrapper = new ContextWrapper(context, testInfo, stepCounter);
      await use(wrapper as unknown as BrowserContext);
    },
    { scope: 'test' },
  ],

  // ── Page — shares StepCounter with context ─────────────────────────────────
  page: [
    async ({ page, context }, use, testInfo) => {
      // Reuse any counter already set by the request fixture; otherwise use context's counter.
      const sharedCounter = _activeStepCounter
        ?? (context as unknown as ContextWrapper)._stepCounter
        ?? new StepCounter();
      const wrapper = new PageWrapper(page, testInfo, sharedCounter);
      setActiveContext(sharedCounter, testInfo.title, testInfo.testId);
      await use(wrapper as unknown as Page);
      clearActiveContext();
    },
    { scope: 'test' },
  ],

  // ── API request — reuses running page counter when both fixtures are active ─
  request: [
    async ({ request: rawRequest }, use, testInfo) => {
      const ctx = getApiTestContext(testInfo);
      const counter = ctx.stepCounter;
      const wrapper = new ApiContextWrapper(rawRequest, testInfo, counter);

      setActiveContext(counter, resolveTcId(testInfo), testInfo.testId);
      try {
        await use(wrapper as unknown as APIRequestContext);
      } finally {
        clearActiveContext();
        deleteApiTestContext(testInfo);
      }
    },
    { scope: 'test' },
  ],
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── EXPORTS ─────────────────────────────────────────════════════════════════
// ═══════════════════════════════════════════════════════════════════════════════

export const expect = buildSmartExpect();

/**
 * Creates a standalone ApiContextWrapper outside of a test fixture
 * (e.g. in globalSetup / storageState generation scripts).
 */
export async function createApiContext(
  options?: Parameters<typeof playwrightRequest.newContext>[0],
  testInfo?: TestInfo
): Promise<ApiContextWrapper> {
  const ctx = await playwrightRequest.newContext(options);
  return new ApiContextWrapper(ctx, testInfo);
}

export type { CombinedFixtures };
export type {
  Page,
  Locator,
  FrameLocator,
  TestInfo,
  BrowserContext,
  APIRequestContext,
  APIResponse,
} from '@playwright/test';