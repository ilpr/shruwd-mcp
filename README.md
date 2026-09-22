# shruwd-mcp

A local [MCP](https://modelcontextprotocol.io) server for [Shruwd](https://shruwd.io).
It lets an AI agent — Claude Desktop, Claude Code, Cursor, anything that speaks MCP —
set up a brand, add the prompts and competitors to track, read how the brand appears in
AI-generated answers, and act on the diagnostic findings.

You need an API key from the Shruwd dashboard (Account → API keys). The key is bound to
one workspace and acts with your role in it: reads need `viewer`, writes `editor`,
creating or archiving a brand `owner`, minting an ingest token `admin`. To work across
several workspaces, mint a key in each and add one server entry per workspace.

## Hosted, no install

The same tools run at `https://shruwd.io/mcp` (Streamable HTTP). In Claude.ai, ChatGPT
or Grok, add that URL as a custom connector and sign in with your Shruwd account; no
key needed. A client that takes a header can send a key instead:

```powershell
claude mcp add --transport http shruwd https://shruwd.io/mcp --header "Authorization: Bearer sh_live_…"
```

Setup for each app: [shruwd.io/docs/api/mcp-server](https://shruwd.io/docs/api/mcp-server).

## Claude Desktop

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "shruwd": {
      "command": "npx",
      "args": ["-y", "shruwd-mcp"],
      "env": { "SHRUWD_API_KEY": "sh_live_…" }
    }
  }
}
```

## Claude Code

```powershell
claude mcp add shruwd -e SHRUWD_API_KEY=sh_live_… -- npx -y shruwd-mcp
```

## Cursor

`.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "shruwd": {
      "command": "npx",
      "args": ["-y", "shruwd-mcp"],
      "env": { "SHRUWD_API_KEY": "sh_live_…" }
    }
  }
}
```

## Tools

| Tool | Does |
|---|---|
| `shruwd_get_workspace` | Plan, entitlements, usage, brands. Start here. |
| `shruwd_list_brands` · `shruwd_get_brand` · `shruwd_create_brand` · `shruwd_update_brand` · `shruwd_archive_brand` | Brands. Creating one also creates its self entity and first measurement. Creating and archiving need `owner`. |
| `shruwd_list_prompts` · `shruwd_add_prompts` · `shruwd_update_prompt` · `shruwd_remove_prompt` | The questions asked of each engine every cycle. |
| `shruwd_list_entities` · `shruwd_add_competitor` · `shruwd_set_entity` · `shruwd_remove_entity` | The brand and its competitors, with the exact aliases that count as a mention. |
| `shruwd_run_measurement` · `shruwd_list_cycles` | Measure now; watch the cycle. Results arrive over the following hours. |
| `shruwd_get_visibility` · `shruwd_get_visibility_series` · `shruwd_get_crawlers` | Mention rate and share of voice with intervals, now and at every cycle close; verified AI-crawler activity. |
| `shruwd_list_answers` | The latest individual answers: whether the brand was named and at what rank, the competitors named, the pages cited. Evidence, not a metric. |
| `shruwd_list_suggestions` · `shruwd_accept_suggestion` · `shruwd_dismiss_suggestion` | Competitors the answers named that the brand does not track yet. |
| `shruwd_suggest_setup` | Drafts ten prompts and up to six competitors from the homepage. Nothing is saved until they are added with the usual tools. |
| `shruwd_list_findings` · `shruwd_get_finding` · `shruwd_transition_finding` | Diagnoses with a specific fix; mark a fix applied to start the recheck. Capped plans return the rest as a `locked` count. |
| `shruwd_create_ingest_token` | The token and endpoint for shipping server logs. Needs `admin`. |

Every tool returns exactly what the API returns. Metrics are never bare numbers: each is
a point estimate with its 95% interval and `n`, or an explicit `insufficient_data` state,
which the tool descriptions tell the agent not to read as zero. Plans that cap visible
findings report the remainder as a `locked` count rather than hiding that it exists.

## Environment

| Variable | |
|---|---|
| `SHRUWD_API_KEY` | Required. |
| `SHRUWD_API_URL` | Optional. Defaults to `https://shruwd.io/api/v1`. |
