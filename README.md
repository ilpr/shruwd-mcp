# shruwd-mcp

A local [MCP](https://modelcontextprotocol.io) server for [Shruwd](https://shruwd.io).
It lets an AI agent — Claude Desktop, Claude Code, Cursor, anything that speaks MCP —
set up a brand, add the prompts and competitors to track, read how the brand appears in
AI-generated answers, and act on the diagnostic findings.

You need an API key from the Shruwd dashboard (Account → API keys).

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
| `shruwd_list_brands` · `shruwd_get_brand` · `shruwd_create_brand` · `shruwd_update_brand` · `shruwd_archive_brand` | Brands. Creating one also creates its self entity and first measurement. |
| `shruwd_list_prompts` · `shruwd_add_prompts` · `shruwd_update_prompt` · `shruwd_remove_prompt` | The questions asked of each engine every cycle. |
| `shruwd_list_entities` · `shruwd_add_competitor` · `shruwd_set_entity` · `shruwd_remove_entity` | The brand and its competitors, with the exact aliases that count as a mention. |
| `shruwd_run_measurement` · `shruwd_list_cycles` | Measure now; watch the cycle. Results arrive over the following hours. |
| `shruwd_get_visibility` · `shruwd_get_visibility_series` · `shruwd_get_crawlers` | Mention rate and share of voice with intervals, now and at every cycle close; verified AI-crawler activity. |
| `shruwd_list_answers` | The latest individual answers: whether the brand was named and at what rank, the competitors named, the pages cited. Evidence, not a metric. |
| `shruwd_suggest_setup` | Drafts ten prompts and up to six competitors from the homepage. Nothing is saved until they are added with the usual tools. |
| `shruwd_list_findings` · `shruwd_get_finding` · `shruwd_transition_finding` | Diagnoses with a specific fix; mark a fix applied to start the recheck. |
| `shruwd_create_ingest_token` | The token and endpoint for shipping server logs. |

Every tool returns exactly what the API returns. Metrics are never bare numbers: each is
a point estimate with its 95% interval and `n`, or an explicit `insufficient_data` state,
which the tool descriptions tell the agent not to read as zero.

## Environment

| Variable | |
|---|---|
| `SHRUWD_API_KEY` | Required. |
| `SHRUWD_API_URL` | Optional. Defaults to `https://shruwd.io/api/v1`. |
