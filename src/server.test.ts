/**
 * The MCP server end to end, in memory: a real MCP client talks to the real
 * server over a linked transport, and the server talks to a fake Shruwd API.
 * What this proves is the wiring — tool names, argument passing, that an API
 * error comes back as a tool error carrying the structured body — not the
 * API itself, which has its own tests.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Shruwd } from '@shruwd/sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createShruwdMcpServer } from './server.js';

interface Recorded {
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
}

function fakeApi(responses: Array<{ status: number; body: unknown }>) {
  const calls: Recorded[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      method: init?.method ?? 'GET',
      url: String(input),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    const next = responses.shift();
    if (!next) throw new Error('no response queued');
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

async function connect(fetch: typeof globalThis.fetch) {
  const shruwd = new Shruwd({ apiKey: 'sh_live_test', baseUrl: 'https://example.test/api/v1', fetch, maxRetries: 0 });
  const server = createShruwdMcpServer(shruwd);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientTransport);
  return { client, server };
}

function text(result: Awaited<ReturnType<Client['callTool']>>): string {
  const content = result.content as Array<{ type: string; text?: string }>;
  return content[0]?.text ?? '';
}

describe('shruwd-mcp', () => {
  let cleanup: (() => Promise<void>) | null = null;

  beforeEach(() => {
    cleanup = null;
  });
  afterEach(async () => {
    await cleanup?.();
  });

  it('exposes one tool per API operation an agent needs, named shruwd_<verb>_<resource>', async () => {
    const { client, server } = await connect(fakeApi([]).fetch);
    cleanup = async () => {
      await client.close();
      await server.close();
    };

    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();

    expect(names).toEqual(
      [
        'shruwd_add_competitor',
        'shruwd_add_prompts',
        'shruwd_archive_brand',
        'shruwd_create_brand',
        'shruwd_accept_suggestion',
        'shruwd_create_ingest_token',
        'shruwd_dismiss_suggestion',
        'shruwd_get_brand',
        'shruwd_get_crawlers',
        'shruwd_get_finding',
        'shruwd_get_visibility',
        'shruwd_get_visibility_series',
        'shruwd_get_workspace',
        'shruwd_list_brands',
        'shruwd_list_answers',
        'shruwd_list_cycles',
        'shruwd_list_entities',
        'shruwd_list_findings',
        'shruwd_list_prompts',
        'shruwd_list_suggestions',
        'shruwd_remove_entity',
        'shruwd_remove_prompt',
        'shruwd_run_measurement',
        'shruwd_set_entity',
        'shruwd_suggest_setup',
        'shruwd_transition_finding',
        'shruwd_update_brand',
        'shruwd_update_prompt',
      ].sort(),
    );

    // The descriptions carry the rules the agent needs (api.md §6).
    const byName = new Map(tools.map((t) => [t.name, t.description ?? '']));
    expect(byName.get('shruwd_get_visibility')).toContain('insufficient_data is NOT zero');
    expect(byName.get('shruwd_add_competitor')).toContain('contextTerms');
    expect(byName.get('shruwd_get_crawlers')).toContain('never summed');
    expect(byName.get('shruwd_transition_finding')).toContain('fourteen-day');
    expect(byName.get('shruwd_run_measurement')).toContain('following hours');
  });

  it('calls the API with the tool arguments and returns the response as JSON text', async () => {
    const api = fakeApi([
      { status: 201, body: { prompts: [{ promptGroupId: 'g1', text: 'best crm', intent: 'commercial' }] } },
    ]);
    const { client, server } = await connect(api.fetch);
    cleanup = async () => {
      await client.close();
      await server.close();
    };

    const result = await client.callTool({
      name: 'shruwd_add_prompts',
      arguments: { brandId: 'b1', prompts: [{ text: 'best crm', intent: 'commercial' }] },
    });

    expect(result.isError).toBeFalsy();
    expect(JSON.parse(text(result))).toEqual([{ promptGroupId: 'g1', text: 'best crm', intent: 'commercial' }]);
    expect(api.calls[0]).toEqual({
      method: 'POST',
      url: 'https://example.test/api/v1/brands/b1/prompts',
      body: { prompts: [{ text: 'best crm', intent: 'commercial' }] },
    });
  });

  it('turns an API refusal into a tool error carrying the structured body', async () => {
    const api = fakeApi([
      {
        status: 422,
        body: {
          code: 'context_terms_required',
          message: '"Arc" is 3 characters.',
          retryable: false,
          details: { name: 'Arc' },
        },
      },
    ]);
    const { client, server } = await connect(api.fetch);
    cleanup = async () => {
      await client.close();
      await server.close();
    };

    const result = await client.callTool({
      name: 'shruwd_add_competitor',
      arguments: { brandId: 'b1', name: 'Arc' },
    });

    expect(result.isError).toBe(true);
    expect(JSON.parse(text(result))).toEqual({
      error: {
        status: 422,
        code: 'context_terms_required',
        message: '"Arc" is 3 characters.',
        retryable: false,
        details: { name: 'Arc' },
      },
    });
  });

  it('maps list_findings arguments onto the API query', async () => {
    const api = fakeApi([{ status: 200, body: { findings: [], counts: {}, queued: 0, brand: {} } }]);
    const { client, server } = await connect(api.fetch);
    cleanup = async () => {
      await client.close();
      await server.close();
    };

    await client.callTool({
      name: 'shruwd_list_findings',
      arguments: { brandId: 'b1', states: ['resolved', 'not_moved'], includeSuppressed: true },
    });

    expect(api.calls[0]?.url).toBe(
      'https://example.test/api/v1/brands/b1/findings?states=resolved%2Cnot_moved&suppressed=1',
    );
  });
});
