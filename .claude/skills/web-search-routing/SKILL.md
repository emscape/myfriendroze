---
name: web-search-routing
description:   Web search and content retrieval tool routing decision matrix.
---

# Web Search & Content Retrieval Routing

## Tool Hierarchy (Highest → Lowest Priority)

### Tier 1: URL DISCOVERY (find what exists)

**Tool**: `open-search` MCP (SearXNG)

| Aspect | Detail |
|--------|--------|
| Returns | JSON: title, url, snippet, score, engine, category |
| Cost | ~1,000 tokens for 10 results |
| Latency | <2s (local SearXNG, no rate limits) |
| Engines | Google + Brave aggregated with scoring |
| Controls | `categories`, `language`, `time_range`, `limit` |

**Use when**: Need to DISCOVER what exists on the web. No specific URL yet.

**Patterns**: "search for X", "find info about X", "what is X", "look up X", "latest news on X"

### Tier 2: CONTENT EXTRACTION (read a specific URL)

**Tools**: `scraper-mcp` (direct) or `fetch-page` MCP

| Tool | Returns | Best For |
|------|---------|----------|
| `scraper-mcp` (`scrape_url`) | Full markdown | Docs, articles, full page |
| `scraper-mcp` (`scrape_url_text`) | Plain text | Data extraction |
| `scraper-mcp` (`scrape_url_html`) | Raw HTML | Structured parsing |
| `scraper-mcp` (`scrape_extract_links`) | Links | Discovery, crawling |
| `fetch-page` MCP | Chunked content (RLM) | Token-safe large pages |

**Use when**: Have a specific URL, need its CONTENT.

**Patterns**: "read this page", "extract content from URL", "what does this page say"

**Critical**: `render_js=true` MANDATORY for SPAs and modern documentation sites.

**fetch-page vs scraper-mcp**:
- `fetch-page`: Automatic RLM chunking (8192 byte default). Read first chunk, decide if more needed. Token-safe for large pages.
- `scraper-mcp`: Full page in one call. Better when you need everything or specific CSS selectors.

### Tier 3: FALLBACK (when Tiers 1-2 unavailable)

| Tool | Use When |
|------|----------|
| `WebSearch` | open-search (SearXNG) is DOWN |
| `WebFetch` | Both scraper-mcp AND fetch-page are DOWN |

**Anti-Pattern**: Using WebFetch when scraper-mcp is available = wrong tool selection.

## Pipeline Pattern (Research Tasks)

For prompts requiring discovery + deep reading:

```
Step 1: open-search(query="X", limit=5)        →  ~500 tokens (discovery)
    ↓ pick best URLs by score
Step 2: fetch-page(url=best_url)                →  ~8K tokens per chunk
    ↓ RLM: read chunks until answer found
    ↓ STOP early (don't read entire page)
Step 3: Answer with evidence                    →  Total: ~2-10K tokens
```

**Token comparison**:
- New pipeline: open-search (~1K) + fetch-page (~8K) = ~9K tokens
- Old pipeline: WebSearch (~3K) + WebFetch (~5-15K) = ~8-18K tokens
- Savings: More control, same or fewer tokens, no AI processing overhead

## Decision Matrix

| Prompt Pattern | Tool | Rationale |
|----------------|------|-----------|
| "Search for X" | **open-search** | URL discovery, ~1K tokens, local |
| "What's the latest on X?" | **open-search** | Current events, metadata sufficient |
| "Read docs.example.com/api" | **scraper-mcp** or **fetch-page** | Have URL, need content |
| "Research X thoroughly" | **open-search → fetch-page** | Discovery then deep-read |
| "Summarize this article at URL" | **fetch-page** | RLM chunking prevents token explosion |
| "Find and read about X" | **open-search → fetch-page** | Pipeline pattern |
| SearXNG is down | **WebSearch** | Fallback for URL discovery |
| scraper-mcp is down | **WebFetch** | Last resort for content |

## Token-Saving Delegation Pattern

When full page content would overwhelm main context:

```
Agent(subagent_type="general-purpose", model="haiku",
      prompt="Scrape <URL> using scraper-mcp with render_js=true.
              Return only: <specific info needed>.")
```

Sub-agent consumes full page in its context, returns only the relevant extract.

## Anti-Patterns

1. Using `WebSearch` when `open-search` is available (wastes tokens, external rate limits)
2. Using `WebFetch` when `scraper-mcp` is available (AI processing overhead, less control)
3. Reading entire page via `fetch-page` when first chunk has the answer (token waste)
4. Skipping `render_js=true` on modern docs sites (gets empty/partial content)
5. Using `open-search` when you already have the URL (use scraper/fetch-page directly)
