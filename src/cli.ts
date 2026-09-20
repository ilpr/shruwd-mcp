#!/usr/bin/env node
/**
 * `shruwd-mcp` — stdio entry point.
 *
 *   SHRUWD_API_KEY   required; an API key minted in the dashboard
 *   SHRUWD_API_URL   optional; defaults to https://shruwd.io/api/v1
 *
 * stdout is the MCP channel, so nothing here writes to it except the
 * transport. Diagnostics go to stderr.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Shruwd } from '@shruwd/sdk';
import { createShruwdMcpServer, SERVER_VERSION } from './server.js';

const apiKey = process.env.SHRUWD_API_KEY;
if (!apiKey) {
  process.stderr.write(
    'shruwd-mcp: SHRUWD_API_KEY is not set. Mint a key in the Shruwd dashboard (Account → API keys) ' +
      'and put it in the MCP server\'s environment.\n',
  );
  process.exit(1);
}

const baseUrl = process.env.SHRUWD_API_URL;
// `client` is what makes these calls countable as MCP rather than as any other
// use of the SDK: the API meters the request as an `mcp_tool_call` (api.md §1.2).
const shruwd = new Shruwd({
  apiKey,
  client: `shruwd-mcp/${SERVER_VERSION}`,
  ...(baseUrl ? { baseUrl } : {}),
});
const server = createShruwdMcpServer(shruwd);

await server.connect(new StdioServerTransport());
process.stderr.write(`shruwd-mcp ${SERVER_VERSION} ready\n`);
