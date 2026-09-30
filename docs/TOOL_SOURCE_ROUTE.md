# source_route

## Scope and contract

`source_route` answers: “What is the best practical, preferably authoritative and machine-readable route for obtaining this information?” It discovers access paths; it does not perform general web search or research. Input is `goal` (3–500 characters), optional DNS `domain`, optional preferred formats (`json`, `csv`, `xml`, `rss`, `api`, `bulk_download`, `html`), optional `require_official` (default false), and `max_candidates` (default 5, range 1–10). The object is strict. It accepts no headers, credentials, cookies, or executable content.

The response has `status` (`routes_found`, `no_suitable_route_found`, or `insufficient_input`), candidate `routes`, `checked` request/search counters, and `limitations`. A no-result response means only “no suitable route found within checked scope”; it is not evidence of nonexistence. Publisher relationship describes the discovery path observed and does not assert legal or semantic authority based on a domain suffix.

## Discovery algorithm

1. Fetch the supplied domain root.
2. Inspect response content type, HTML anchors and alternate links; collect API/OpenAPI, feed, JSON/CSV, developer/data, and sitemap references.
3. Probe `/llms.txt`, `/robots.txt`, `/sitemap.xml`, `/openapi.json`, `/.well-known/openapi.json`, and `/swagger.json` (up to the global eight-request cap). Follow at most two sitemap declarations from robots and inspect at most 30 sitemap locations. Do not spider pages.
4. Validate discovered route URLs against public-address safety checks and deduplicate.
5. If there is no machine-readable non-search route scoring at least 0.75, make at most one configured Brave Search API query. With no configured provider, return deterministic findings and say search was unavailable.

No LLM or model inference is used.

## Deterministic ranking

Base scores: API 0.94, OpenAPI 0.90, bulk download 0.87, dataset 0.86, feed 0.84, developer docs 0.68, structured web 0.62, ordinary web 0.42. Add 0.07 for an exact supplied-domain host or 0.04 for a route linked from that site; add 0.04 for machine readability and 0.02 when a direct successful probe observed no authentication challenge; subtract 0.12 when a direct probe returned 401/403. A preferred format adds 0.12. A search result on the exact supplied host receives the exact-domain bonus; other search results receive no publisher bonus. Raw scores determine order before displayed scores are clamped to [0,1]. `require_official` excludes search results that do not match the supplied host; it does not make legal-authority claims.

Scores encode explicit observed route type, host relationship, content type, and status only. They are a deterministic prioritization aid, not a guarantee of source quality.

## Hard limits

- At most 8 direct-discovery HTTP requests per execution, including redirects.
- At most 1 additional paid search HTTP request.
- At most 5 seconds per outbound request and 12 seconds total.
- At most 1 MiB read per HTTP response.
- At most 3 redirects per request; every destination is revalidated.
- At most 10 returned routes, with 5 by default.
- At most 100 homepage links, 30 candidates for public-address validation, and 30 sitemap entries inspected.

## Cost and remaining product uncertainty

Direct discovery has $0 in third-party search spend; hosting and outbound request costs depend on deployment and have not been measured against a live host. A Brave Search API fallback is priced by Brave at $5 per 1,000 Search requests (currently $0.005 per query); one tool call can therefore add at most $0.005 in direct search-provider spend, before hosting. This is a significant fraction of the $0.02 beta price, so measure fallback frequency and revisit economics before charging.
