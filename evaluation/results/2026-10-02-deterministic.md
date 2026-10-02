# source_route evaluation

- Mode: deterministic-only
- Provider: none
- Cases: 27
- Successful executions: 27
- Useful top-1: 70.4%
- Useful top-3: 77.8%
- Ranking failures: 2
- Coverage failures: 2
- Classification failures: 4
- Useful candidate at rank 2 / rank 3: 16 / 14
- Obviously bad top-1: 0%
- Third-party top-1: 0%
- Search-only top-1: 0%
- Verified top-1: 7.4%
- No route: 7.4%
- Direct discovery: 92.6%
- Search fallback: 0%
- Provider failures: 0%
- Average direct requests: 5.96
- Average searches per call: 0
- Latency p50/p95: 1208.1/6741.5 ms

## Provisional quality gates

| Metric | Target | Result |
|---|---:|---:|
| Useful top-1 | ≥75% | 70.4% |
| Useful top-3 | ≥90% | 77.8% |
| Obviously bad top-1 | 0% | 0% |
| Provider failure (search run only) | <3% | 0% |
| p95 latency | ≤5,500 ms | 6741.5 ms |

## Cases

| Case | Status | Top route | Type | Score | Useful top-1 | Useful top-3 | Direct requests | Search requests | Latency ms | Limitations / error |
|---|---|---|---|---:|---|---|---:|---:|---:|---|
| us-census | routes_found | https://www.census.gov/data/developers.html | developer_docs | 0.47 | yes | yes | 7 | 0 | 449.6 | Candidate inspection was capped to keep validation work bounded.; External search fallback was unavailable because no search provider is configured; deterministic discovery was used. |
| us-data | routes_found | https://catalog.data.gov/dataset/crime-data-from-2020-to-present | bulk_download | 0.53 | yes | yes | 4 | 0 | 1089.9 | Candidate inspection was capped to keep validation work bounded.; External search fallback was unavailable because no search provider is configured; deterministic discovery was used. |
| eurostat | routes_found | https://ec.europa.eu/eurostat/web/european-statistics-learning-hub/overview | web | 0.4 | no | no | 5 | 0 | 2031.3 | Candidate inspection was capped to keep validation work bounded.; External search fallback was unavailable because no search provider is configured; deterministic discovery was used. |
| world-bank | routes_found | https://data.worldbank.org/products/tools | developer_docs | 0.5 | yes | yes | 6 | 0 | 9302.8 | External search fallback was unavailable because no search provider is configured; deterministic discovery was used. |
| opendatasoft | routes_found | https://www.data.gouv.fr/api/1/swagger.json | openapi | 0.53 | no | no | 7 | 0 | 2366.3 | External search fallback was unavailable because no search provider is configured; deterministic discovery was used. |
| sec-edgar | routes_found | https://sec.gov/openapi.json | openapi | 0.5 | yes | yes | 6 | 0 | 842.4 | External search fallback was unavailable because no search provider is configured; deterministic discovery was used. |
| companies-house | routes_found | https://developer.companieshouse.gov.uk/ | developer_docs | 0.46 | no | yes | 6 | 0 | 3271.6 | External search fallback was unavailable because no search provider is configured; deterministic discovery was used. |
| opencorporates | routes_found | https://knowledge.opencorporates.com/knowledge-base/api-documentation/ | developer_docs | 0.48 | yes | yes | 7 | 0 | 2184.4 | Candidate inspection was capped to keep validation work bounded.; External search fallback was unavailable because no search provider is configured; deterministic discovery was used. |
| github-docs | routes_found | https://docs.github.com/en/repositories | developer_docs | 0.5 | yes | yes | 6 | 0 | 526.8 | Candidate inspection was capped to keep validation work bounded.; External search fallback was unavailable because no search provider is configured; deterministic discovery was used. |
| stripe-docs | routes_found | https://docs.stripe.com/api/errors.md | official_api | 0.57 | yes | yes | 7 | 0 | 2020.6 | The supplied domain could not be fetched within the network safety and request limits.; Candidate inspection was capped to keep validation work bounded.; External search fallback was unavailable because no search provider is configured; deterministic discovery was used. |
| postgres-docs | routes_found | https://www.postgresql.org/docs/ | developer_docs | 0.47 | yes | yes | 3 | 0 | 1802.7 | Candidate inspection was capped to keep validation work bounded.; External search fallback was unavailable because no search provider is configured; deterministic discovery was used. |
| nasa-api | routes_found | https://data.nasa.gov/ | developer_docs | 0.49 | yes | yes | 7 | 0 | 1317.5 | External search fallback was unavailable because no search provider is configured; deterministic discovery was used. |
| noaa | routes_found | https://www.noaa.gov/openapi.json | openapi | 0.52 | no | no | 6 | 0 | 684.5 | External search fallback was unavailable because no search provider is configured; deterministic discovery was used. |
| un-data | no_suitable_route_found | — | — | — | no | no | 6 | 0 | 660.1 | A discovered candidate was omitted because its URL did not pass public-address safety checks.; External search fallback was unavailable because no search provider is configured; deterministic discovery was used.; No suitable route was found within checked scope; this does not establish that no route exists. |
| who-gho | routes_found | https://www.who.int/ | web | 0.38 | no | yes | 7 | 0 | 845 | External search fallback was unavailable because no search provider is configured; deterministic discovery was used. |
| arxiv | routes_found | https://arxiv.org/list/astro-ph.CO/recent | web | 0.36 | yes | yes | 6 | 0 | 6741.5 | Candidate inspection was capped to keep validation work bounded.; External search fallback was unavailable because no search provider is configured; deterministic discovery was used. |
| crossref | routes_found | https://www.crossref.org/site-search/?query= | web | 0.34 | yes | yes | 7 | 0 | 1208.1 | External search fallback was unavailable because no search provider is configured; deterministic discovery was used. |
| openalex | routes_found | https://openalex.org/openapi.json | openapi | 0.52 | yes | yes | 6 | 0 | 204 | External search fallback was unavailable because no search provider is configured; deterministic discovery was used. |
| usgs | routes_found | https://earthquake.usgs.gov/earthquakes/feed/ | structured_feed | 0.53 | yes | yes | 7 | 0 | 1960.1 | Candidate inspection was capped to keep validation work bounded.; External search fallback was unavailable because no search provider is configured; deterministic discovery was used. |
| federal-register | routes_found | https://www.federalregister.gov/developers/documentation/api/v1 | official_api | 0.55 | yes | yes | 7 | 0 | 1010.7 | External search fallback was unavailable because no search provider is configured; deterministic discovery was used. |
| wikipedia-feed | no_suitable_route_found | — | — | — | no | no | 7 | 0 | 827 | External search fallback was unavailable because no search provider is configured; deterministic discovery was used.; No suitable route was found within checked scope; this does not establish that no route exists. |
| open-meteo | routes_found | https://open-meteo.com/en/docs/gfs-api | developer_docs | 0.52 | yes | yes | 6 | 0 | 466 | Candidate inspection was capped to keep validation work bounded.; External search fallback was unavailable because no search provider is configured; deterministic discovery was used. |
| uk-data | routes_found | https://www.data.gov.uk/collections/government-and-parliament | web | 0.37 | yes | yes | 6 | 0 | 2409.7 | External search fallback was unavailable because no search provider is configured; deterministic discovery was used. |
| nyc-data | routes_found | https://www.nyc.gov/openapi.json | openapi | 0.49 | no | no | 6 | 0 | 1387.7 | External search fallback was unavailable because no search provider is configured; deterministic discovery was used. |
| ietf-rfc | routes_found | https://www.rfc-editor.org/rfc-index/ | web | 0.42 | yes | yes | 4 | 0 | 526 | Candidate inspection was capped to keep validation work bounded.; External search fallback was unavailable because no search provider is configured; deterministic discovery was used. |
| openstreetmap | routes_found | https://planet.openstreetmap.org/pbf/planet-pbf-rss.xml | structured_feed | 0.52 | yes | yes | 3 | 0 | 991.9 | External search fallback was unavailable because no search provider is configured; deterministic discovery was used. |
| boamp | routes_found | https://www.boamp.fr/api/explore/v2.1/swagger.json | openapi | 0.55 | yes | yes | 6 | 0 | 2715.9 | External search fallback was unavailable because no search provider is configured; deterministic discovery was used. |
