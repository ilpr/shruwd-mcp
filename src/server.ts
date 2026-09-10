/**
 * shruwd-mcp — the Shruwd API as MCP tools. `claude-docs/spec/api.md` §6.
 *
 * A transport, not a product: every tool calls one API operation through
 * `@shruwd/sdk` and returns what the API returned. Nothing is computed here,
 * so every property the API keeps — metrics never shown without their
 * interval or below the n = 10 floor, verified and unverified crawler hits
 * never summed, resolution decided only by the recheck — the tools keep too.
 *
 * What this file adds is the descriptions. An agent reads them instead of the
 * spec, so each one carries the rule the agent needs to use the tool well:
 * what `insufficient_data` means, why a short competitor name needs context
 * terms, that a measurement is asynchronous, that `fix_applied` starts a
 * fourteen-day clock it cannot shortcut.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ShruwdError, type Shruwd } from '@shruwd/sdk';
import { z } from 'zod';

export const SERVER_NAME = 'shruwd';
export const SERVER_VERSION = '0.1.0';

// ─── Shared input pieces ────────────────────────────────────────────────────

const brandId = z
  .string()
  .min(1)
  .describe('Brand id, from shruwd_get_workspace, shruwd_list_brands or shruwd_create_brand.');

const engine = z
  .enum(['google_aio', 'chatgpt'])
  .describe('google_aio = Google AI Overviews / AI Mode; chatgpt = ChatGPT. Defaults to google_aio.');

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

const intent = z
  .enum(['informational', 'comparison', 'commercial', 'navigational', 'problem'])
  .describe(
    'Why someone asks the prompt. informational = learning about a topic; comparison = weighing named ' +
      'options; commercial = choosing what to buy; navigational = looking for a specific site; ' +
      'problem = fixing something. Decides which diagnostic rules apply.',
  );

const aliasInput = z.object({
  alias: z.string().min(1).max(80).describe('An exact string, matched on word boundaries. Not a pattern.'),
  kind: z.enum(['name', 'product', 'abbreviation', 'misspelling']).optional(),
  caseSensitive: z.boolean().optional().describe('True for acronyms ("SAP", not "sap").'),
});

const entityConfig = {
  aliases: z.array(aliasInput).optional().describe('Defaults to the name. Exact strings only.'),
  domains: z
    .array(z.string())
    .optional()
    .describe('Hosts or URLs; reduced to registrable domains. A citation of one counts for this entity.'),
  exclusions: z
    .array(z.string().max(80))
    .optional()
    .describe('Literal phrases that contain an alias but are not the entity ("arc welding" for "Arc").'),
  contextTerms: z
    .array(z.string().max(80))
    .optional()
    .describe(
      'When given, a mention counts only if one of these words appears near it. REQUIRED for names of ' +
        'six characters or fewer and for common English words; the API refuses such names without them.',
    ),
};

// ─── Result shaping ─────────────────────────────────────────────────────────

function ok(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function failed(error: unknown): CallToolResult {
  const body =
    error instanceof ShruwdError
      ? {
          error: {
            status: error.status,
            code: error.code,
            message: error.message,
            retryable: error.retryable,
            ...(error.details ? { details: error.details } : {}),
          },
        }
      : { error: { code: 'unexpected', message: error instanceof Error ? error.message : String(error) } };
  return { isError: true, content: [{ type: 'text', text: JSON.stringify(body, null, 2) }] };
}

async function call(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return ok(await fn());
  } catch (error) {
    return failed(error);
  }
}

const READ = { readOnlyHint: true, openWorldHint: true } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: true } as const;
const REMOVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true } as const;

// ─── The server ─────────────────────────────────────────────────────────────

export function createShruwdMcpServer(shruwd: Shruwd): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        'Shruwd measures how a brand appears in AI-generated answers (Google AI Overviews / AI Mode, ' +
        'ChatGPT), diagnoses why it is or is not cited, recommends a specific fix, and re-checks whether ' +
        'the fix moved anything. Start with shruwd_get_workspace. Measurement is asynchronous: creating a ' +
        'brand or running a measurement schedules work whose results arrive over the following hours. ' +
        'Every metric is either a point estimate with a 95% interval and n, or an explicit ' +
        '"insufficient_data" / "undefined" state. insufficient_data is not zero — never report it as a number.',
    },
  );

  // ── Workspace and brands ──────────────────────────────────────────────

  server.registerTool(
    'shruwd_get_workspace',
    {
      title: 'Get workspace',
      description:
        'The plan, the entitlements in force (brand and prompt limits, engines, cadence, history window, ' +
        'rechecks per month), usage against the period allowance, and the brands. Call this first.',
      annotations: READ,
    },
    () => call(() => shruwd.workspace.get()),
  );

  server.registerTool(
    'shruwd_list_brands',
    {
      title: 'List brands',
      description: 'Active brands with their prompt and competitor counts.',
      annotations: READ,
    },
    () => call(() => shruwd.brands.list()),
  );

  server.registerTool(
    'shruwd_get_brand',
    {
      title: 'Get brand',
      description:
        'One brand with its pipeline health: last successful cycle, next scheduled cycle, run success ' +
        'rate, log-ingest continuity and connection states. Check this before treating a flat metric as ' +
        'a signal — "nothing ran" and "nothing was mentioned" look identical in a chart.',
      inputSchema: { brandId },
      annotations: READ,
    },
    ({ brandId }) => call(() => shruwd.brands.get(brandId)),
  );

  server.registerTool(
    'shruwd_create_brand',
    {
      title: 'Create brand',
      description:
        'Creates a brand, its self entity (one alias = the name, one domain = the registrable domain) and ' +
        'the first measurement cycle. If the account has no workspace yet, one is created on the free ' +
        'tier. The response says which engines the plan measures and whether a first cycle was planted. ' +
        'On the free tier "snapshot" is "planned" or "already_taken": a domain gets one free measurement ' +
        'ever, across all accounts. Add prompts and competitors right after; the first cycle runs within ' +
        'fifteen minutes and measures whatever prompts exist then.',
      inputSchema: {
        name: z.string().min(1).max(120),
        domain: z.string().min(1).describe('Host or URL; reduced to the registrable domain (www.x.com/p → x.com).'),
        timezone: z.string().optional().describe('IANA zone for day boundaries. Defaults to UTC.'),
      },
      annotations: WRITE,
    },
    ({ name, domain, timezone }) =>
      call(() => shruwd.brands.create({ name, domain, ...(timezone !== undefined ? { timezone } : {}) })),
  );

  server.registerTool(
    'shruwd_archive_brand',
    {
      title: 'Archive brand',
      description: 'Archives a brand. Nothing is deleted; scheduling stops and history stays. Ask before using this.',
      inputSchema: { brandId },
      annotations: REMOVE,
    },
    ({ brandId }) => call(() => shruwd.brands.archive(brandId)),
  );

  // ── Prompts ───────────────────────────────────────────────────────────

  server.registerTool(
    'shruwd_list_prompts',
    {
      title: 'List prompts',
      description:
        'The brand\'s prompts. With an engine, each prompt carries its coverage over the window: how ' +
        'often the brand was mentioned in answers to it. Per-prompt n is small (three repetitions per ' +
        'cycle), so coverage is often insufficient_data; that is correct, not missing data.',
      inputSchema: {
        brandId,
        engine: engine.optional(),
        from: day.optional(),
        to: day.optional(),
        includeInactive: z.boolean().optional(),
      },
      annotations: READ,
    },
    ({ brandId, engine, from, to, includeInactive }) =>
      call(() =>
        shruwd.prompts.list(brandId, {
          ...(engine !== undefined ? { engine } : {}),
          ...(from !== undefined ? { from } : {}),
          ...(to !== undefined ? { to } : {}),
          ...(includeInactive ? { includeInactive: '1' } : {}),
        }),
      ),
  );

  server.registerTool(
    'shruwd_add_prompts',
    {
      title: 'Add prompts',
      description:
        'Adds prompts — the questions asked of each engine every cycle. Write them the way a buyer would ' +
        'type them, without the brand name unless the intent is navigational. 1–500 characters each. ' +
        'The batch is atomic: if it would exceed the plan\'s prompts-per-brand, nothing is added and the ' +
        'error carries limit, current and submitted.',
      inputSchema: {
        brandId,
        prompts: z
          .array(
            z.object({
              text: z.string().min(1).max(500),
              intent,
              tags: z.array(z.string().max(40)).optional(),
            }),
          )
          .min(1),
      },
      annotations: WRITE,
    },
    ({ brandId, prompts }) => call(() => shruwd.prompts.add(brandId, prompts)),
  );

  server.registerTool(
    'shruwd_update_prompt',
    {
      title: 'Update prompt',
      description:
        'Edits a prompt by its promptGroupId. Changing text or intent creates a new version under the ' +
        'same group — history stays attached to the version that produced it. tags and active change in ' +
        'place. Reactivating counts against the plan limit.',
      inputSchema: {
        promptGroupId: z.string().min(1),
        text: z.string().min(1).max(500).optional(),
        intent: intent.optional(),
        tags: z.array(z.string().max(40)).optional(),
        active: z.boolean().optional(),
      },
      annotations: WRITE,
    },
    ({ promptGroupId, text, intent, tags, active }) =>
      call(() =>
        shruwd.prompts.update(promptGroupId, {
          ...(text !== undefined ? { text } : {}),
          ...(intent !== undefined ? { intent } : {}),
          ...(tags !== undefined ? { tags } : {}),
          ...(active !== undefined ? { active } : {}),
        }),
      ),
  );

  server.registerTool(
    'shruwd_remove_prompt',
    {
      title: 'Remove prompt',
      description: 'Deactivates a prompt. Nothing is deleted; its history stays readable.',
      inputSchema: { promptGroupId: z.string().min(1) },
      annotations: REMOVE,
    },
    ({ promptGroupId }) => call(() => shruwd.prompts.remove(promptGroupId)),
  );

  // ── Entities ──────────────────────────────────────────────────────────

  server.registerTool(
    'shruwd_list_entities',
    {
      title: 'List entities',
      description:
        'The brand itself (isSelf) and every competitor, each with the exact aliases, domains, ' +
        'exclusions and context terms that decide what counts as a mention or a citation.',
      inputSchema: { brandId },
      annotations: READ,
    },
    ({ brandId }) => call(() => shruwd.entities.list(brandId)),
  );

  server.registerTool(
    'shruwd_add_competitor',
    {
      title: 'Add competitor',
      description:
        'Adds a competitor. Matching is exact, on word boundaries — no fuzzy matching, ever — because a ' +
        'false positive silently corrupts every metric. That is also why a short name (six characters or ' +
        'fewer) or a common English word ("Arc", "Linear", "Notion") is refused without contextTerms: ' +
        'those names appear in sentences that are not about the company. Give one or two category words ' +
        'as context terms ("waitlist", "crm") and the mention counts only when one appears nearby. ' +
        'Include the competitor\'s domain so citations of it are attributed.',
      inputSchema: { brandId, name: z.string().min(1).max(120), ...entityConfig },
      annotations: WRITE,
    },
    ({ brandId, name, aliases, domains, exclusions, contextTerms }) =>
      call(() =>
        shruwd.entities.add(brandId, {
          name,
          ...(aliases !== undefined ? { aliases } : {}),
          ...(domains !== undefined ? { domains } : {}),
          ...(exclusions !== undefined ? { exclusions } : {}),
          ...(contextTerms !== undefined ? { contextTerms } : {}),
        }),
      ),
  );

  server.registerTool(
    'shruwd_set_entity',
    {
      title: 'Set entity configuration',
      description:
        'Sets the DESIRED aliases, domains, exclusions and context terms of an entity (the brand\'s own ' +
        'self entity included). Send the full lists: what is missing is closed as of now, what is new is ' +
        'added, what is unchanged is untouched, and past measurements keep the aliases that were valid ' +
        'when they ran. Read shruwd_list_entities first.',
      inputSchema: { entityId: z.string().min(1), ...entityConfig },
      annotations: { ...WRITE, idempotentHint: true },
    },
    ({ entityId, aliases, domains, exclusions, contextTerms }) =>
      call(() =>
        shruwd.entities.set(entityId, {
          ...(aliases !== undefined ? { aliases } : {}),
          ...(domains !== undefined ? { domains } : {}),
          ...(exclusions !== undefined ? { exclusions } : {}),
          ...(contextTerms !== undefined ? { contextTerms } : {}),
        }),
      ),
  );

  server.registerTool(
    'shruwd_remove_entity',
    {
      title: 'Remove competitor',
      description: 'Closes a competitor as of now. The brand\'s own entity cannot be removed.',
      inputSchema: { entityId: z.string().min(1) },
      annotations: REMOVE,
    },
    ({ entityId }) => call(() => shruwd.entities.remove(entityId)),
  );

  // ── Measurement ───────────────────────────────────────────────────────

  server.registerTool(
    'shruwd_run_measurement',
    {
      title: 'Run a measurement',
      description:
        'Schedules a measurement cycle now: every active prompt, on every entitled engine, three times ' +
        'each. It is picked up within fifteen minutes and completes over the following hours; this ' +
        'response contains only the cycle id. Watch it with shruwd_list_cycles, then read ' +
        'shruwd_get_visibility and shruwd_list_findings. A cycle spends the period\'s run allowance ' +
        '(see shruwd_get_workspace); weekly plans already run one per week, so use this for a first ' +
        'read or after a change worth measuring. On the free tier it is the single free measurement.',
      inputSchema: { brandId },
      annotations: WRITE,
    },
    ({ brandId }) => call(() => shruwd.cycles.run(brandId)),
  );

  server.registerTool(
    'shruwd_list_cycles',
    {
      title: 'List cycles',
      description:
        'Recent measurement cycles, newest first, with state (pending, running, complete, partial, ' +
        'failed, skipped_quota) and run counts. "partial" means some runs failed; "skipped_quota" means ' +
        'the allowance, the plan or billing stopped it.',
      inputSchema: { brandId, limit: z.number().int().min(1).max(100).optional() },
      annotations: READ,
    },
    ({ brandId, limit }) => call(() => shruwd.cycles.list(brandId, limit)),
  );

  server.registerTool(
    'shruwd_get_visibility',
    {
      title: 'Get visibility',
      description:
        'Mention rate and share of voice for the brand and each competitor on one engine over a window ' +
        '(default: last 30 days), plus per-prompt coverage. Each metric is {state: "ok", point, lo, hi, n} ' +
        '— a proportion with its 95% interval — or {state: "insufficient_data"} when fewer than ten ' +
        'responses exist, or {state: "undefined"}. A metric with state insufficient_data is NOT zero; do ' +
        'not report it as a number, and do not compare two metrics whose intervals overlap as if one were ' +
        'higher. "asOf" is the day the numbers describe. "historyFrom" is set when the window was ' +
        'clamped to the plan\'s history. "modelIds" lists the provider models seen; a change there can ' +
        'move metrics on its own.',
      inputSchema: { brandId, engine: engine.optional(), from: day.optional(), to: day.optional() },
      annotations: READ,
    },
    ({ brandId, engine, from, to }) =>
      call(() =>
        shruwd.visibility.get(brandId, {
          ...(engine !== undefined ? { engine } : {}),
          ...(from !== undefined ? { from } : {}),
          ...(to !== undefined ? { to } : {}),
        }),
      ),
  );

  server.registerTool(
    'shruwd_get_crawlers',
    {
      title: 'Get crawler activity',
      description:
        'Which AI crawlers fetched the brand\'s site, from its server logs, over a window. verifiedHits ' +
        'were confirmed against the vendor\'s published IP ranges; unverifiedHits merely claimed the ' +
        'user-agent, which anyone can send. Only verified hits are a signal, and the two are never ' +
        'summed. "live_retrieval" bots fetch pages to answer a question now and correlate with being ' +
        'cited; "training" crawlers do not. "coverage" says whether log ingest has been continuous — if ' +
        'not, an absence of hits means nothing.',
      inputSchema: { brandId, from: day.optional(), to: day.optional() },
      annotations: READ,
    },
    ({ brandId, from, to }) =>
      call(() =>
        shruwd.crawlers.get(brandId, {
          ...(from !== undefined ? { from } : {}),
          ...(to !== undefined ? { to } : {}),
        }),
      ),
  );

  // ── Findings ──────────────────────────────────────────────────────────

  server.registerTool(
    'shruwd_list_findings',
    {
      title: 'List findings',
      description:
        'Diagnoses, ordered by severity, then confidence, then estimated impact. Each has a specific ' +
        'recommendation: what to change, where, and which metric should move. confidence: "observed" was ' +
        'measured from first-party data; "inferred" follows a reliable pattern; "heuristic" is a ' +
        'plausible cause that could not be confirmed — treat it as a hypothesis, not a fact. By default ' +
        'the open, acknowledged, fix_applied and rechecking findings; pass states to change that. ' +
        '"queued" counts open findings held back by the weekly cap.',
      inputSchema: {
        brandId,
        states: z
          .array(
            z.enum(['open', 'acknowledged', 'fix_applied', 'rechecking', 'resolved', 'not_moved', 'dismissed', 'stale']),
          )
          .optional(),
        includeSuppressed: z
          .boolean()
          .optional()
          .describe('Also return findings suppressed because a more fundamental finding explains them.'),
      },
      annotations: READ,
    },
    ({ brandId, states, includeSuppressed }) =>
      call(() =>
        shruwd.findings.list(brandId, {
          ...(states !== undefined && states.length > 0 ? { states: states.join(',') } : {}),
          ...(includeSuppressed ? { suppressed: '1' } : {}),
        }),
      ),
  );

  server.registerTool(
    'shruwd_get_finding',
    {
      title: 'Get finding',
      description: 'One finding with its full evidence, recommendation, and the history of state changes.',
      inputSchema: { findingId: z.string().min(1) },
      annotations: READ,
    },
    ({ findingId }) => call(() => shruwd.findings.get(findingId)),
  );

  server.registerTool(
    'shruwd_transition_finding',
    {
      title: 'Transition finding',
      description:
        'Moves a finding: "acknowledged" (seen), "fix_applied" (the recommended change is live), or ' +
        '"dismissed". fix_applied captures a baseline of the affected prompts and starts a fourteen-day ' +
        'clock; a recheck then measures again and the finding becomes "resolved" or "not_moved" ONLY if ' +
        'the movement gates pass (non-overlapping intervals and at least five points of change). Neither ' +
        'of those states can be set here, and rechecking sooner measures nothing. Do not mark fix_applied ' +
        'until the change is actually deployed; the baseline is taken at that moment.',
      inputSchema: {
        findingId: z.string().min(1),
        to: z.enum(['acknowledged', 'fix_applied', 'dismissed']),
        note: z.string().max(2000).optional().describe('What was done, for the record.'),
      },
      annotations: WRITE,
    },
    ({ findingId, to, note }) =>
      call(() => shruwd.findings.transition(findingId, { to, ...(note !== undefined ? { note } : {}) })),
  );

  // ── Connections ───────────────────────────────────────────────────────

  server.registerTool(
    'shruwd_create_ingest_token',
    {
      title: 'Create log-drain token',
      description:
        'Mints the token the brand\'s server sends its access logs with, and returns the endpoint to ' +
        'POST them to. The token is shown once and never again; previous tokens are revoked. Give the ' +
        'user the token and endpoint verbatim — they paste both into their log shipper (Cloudflare ' +
        'Logpush, Vercel Log Drain, or a small forwarder). Logs power the crawler view and the ' +
        'highest-confidence findings.',
      inputSchema: { brandId, label: z.string().max(80).optional() },
      annotations: WRITE,
    },
    ({ brandId, label }) => call(() => shruwd.connections.createIngestToken(brandId, label)),
  );

  return server;
}
