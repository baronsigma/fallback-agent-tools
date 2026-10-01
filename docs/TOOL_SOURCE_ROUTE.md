# source_route

## Scope and contract

`source_route` answers: “What is the best practical, preferably authoritative and machine-readable route for obtaining this information?” It discovers access paths; it does not perform general web search or research. Input is `goal` (3–500 characters), optional DNS `domain`, optional preferred formats (`json`, `csv`, `xml`, `rss`, `api`, `bulk_download`, `html`), optional `require_official` (default false), and `max_candidates` (default 5, range 1–10). The object is strict. It accepts no headers, credentials, cookies, or executable content.

The response has `status` (`routes_found`, `no_suitable_route_found`, or `insufficient_input`), candidate `routes`, `checked` request/search counters, and `limitations`. A no-result response means only “no suitable route found within checked scope”; it is not evidence of nonexistence. Publisher relationship describes the discovery path observed and does not assert legal or semantic authority based on a domain suffix.

## Discovery algorithm

1. Fetch the supplied domain root.
2. Inspect response content type, HTML anchors and alternate links; collect API/OpenAPI, feed, JSON/CSV, developer/data, and sitemap references.
3. Probe `/llms.txt`, `/robots.txt`, `/sitemap.xml`, `/openapi.json`, `/.well-known/openapi.json`, and `/swagger.json` (up to the global eight-request cap). Follow at most two sitemap declarations from robots and inspect at most 30 sitemap locations. Do not spider pages.
4. Validate discovered route URLs against public-address safety checks and deduplicate.
5. If there is no machine-readable non-search route scoring at least 0.75, make at most one query through the configured provider. Tavily is preferred for the MVP; Brave remains supported. With no configured provider, return deterministic findings and say external search was unavailable.

No LLM or model inference is used.

## Deterministic ranking

Base scores: API 0.94, OpenAPI 0.90, bulk download 0.87, dataset 0.86, feed 0.84, developer docs 0.68, structured web 0.62, ordinary web 0.42. Add 0.07 for an exact supplied-domain host or 0.04 for a route linked from that site; add 0.04 for machine readability and 0.02 when a direct successful probe observed no authentication challenge; subtract 0.12 when a direct probe returned 401/403. A preferred format adds 0.12. A search result on the exact supplied host receives the exact-domain bonus; other search results receive no publisher bonus. Raw scores determine order before displayed scores are clamped to [0,1]. `require_official` excludes search results that do not match the supplied host; it does not make legal-authority claims.

Scores encode explicit observed route type, host relationship, content type, and status only. They are a deterministic prioritization aid, not a guarantee of source quality.

## Hard limits

- At most 8 direct-discovery HTTP requests per execution, including redirects.
- At most 1 additional paid search HTTP request.
- One selected provider per call; Tavily and Brave are never chained.
- At most 5 seconds per outbound request and 12 seconds total.
- At most 1 MiB read per HTTP response.
- At most 3 redirects per request; every destination is revalidated.
- At most 10 returned routes, with 5 by default.
- At most 100 homepage links, 30 candidates for public-address validation, and 30 sitemap entries inspected.

## Provider configuration and cost

Set `SEARCH_PROVIDER=tavily`, `brave`, or `none`. When omitted, a Tavily key takes precedence, then a Brave key; without either key the tool starts in deterministic-only mode. Provider credentials are `TAVILY_API_KEY` and `BRAVE_SEARCH_API_KEY`. Tavily is preferred initially because its current free allowance makes early validation inexpensive. Free-tier availability and provider pricing can change; these are business assumptions, not protocol guarantees. Provider cost belongs in evaluation assumptions, not core runtime logic. Direct discovery has no third-party search spend. Hosting and egress have not been measured and are excluded from provider-cost estimates.

## Live evaluation

Run `npm run eval:source-route` for deterministic-only observations. It makes public HTTP requests to the curated targets but never calls search. To use a configured provider, explicitly run `npm run eval:source-route -- --search --provider tavily` (or `brave`) and provide the matching credential. Provider-enabled evaluation requires both the flag and credentials. Results are written under the gitignored `eval-results/` directory. This observational harness is separate from CI and release checks; route usefulness labels allow multiple acceptable route types and domain families. Evaluation cost assumptions use `EVAL_TAVILY_COST_PER_SEARCH` and `EVAL_BRAVE_COST_PER_SEARCH`; the default Tavily zero reflects a temporary evaluation assumption while inside an available free quota. It is not a promise of free service. The report estimates provider spend and gross margin at $0.02 per call, excluding hosting and egress.
