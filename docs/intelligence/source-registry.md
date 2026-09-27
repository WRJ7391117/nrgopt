# Fixed source monitoring

The registry in `lib/intelligence/registry.cjs` is deliberately limited to entry points verified with the same HTTPS fetcher used by collection. The first five entry points were checked on 2026-09-24; KAPP and Principal Buyer were checked on 2026-09-25. These seven entries cover publishers in all six GCC countries:

| Publisher | Entry point | Article links in first fetched page |
| --- | --- | ---: |
| ACWA | https://www.acwapower.com/en/media-center/latest-news/ | 13 |
| Principal Buyer (Saudi Arabia) | https://www.pb.com.sa/ | 5 |
| Nama PWP | https://www.omanpwp.om/news | 15 |
| EWA Bahrain | https://www.ewa.bh/en/news | 9 |
| Masdar | https://masdar.ae/en/news/newsroom | 10 |
| Qatar News Agency | https://qna.org.qa/en/economy | 25 |
| KAPP (Kuwait) | https://www.kapp.gov.kw/news-media | 87 |

These counts prove index readability, not article accuracy, relevance or market coverage. Publisher country is not a project's occurrence country. Official indexes contain non-energy news, and URL slugs can be misleading; articles still pass through source preservation, extraction and relevance checks.

Each daily run adds one durable item per entry point. It queues at most 50 unseen article URLs and revisits at most two previously seen URLs for corrections. Any remaining first-page links are explicitly counted as pending. The last successful checkpoint for that owner and entry point retains up to 512 queued URLs. Enqueue failure or an empty/unreadable index never advances that checkpoint. An article fetch can fail after discovery; the child job retains its own retries and visible failure. Repeated URLs use the existing per-run source keys and source-version deduplication.

This first version reads the index's first page only. It does not claim complete historical backfill, pagination coverage, full market coverage in any of the six countries, or the approximately 30-entry launch target. Older links beyond the bounded cursor may be revisited. Country searches and active watch searches continue independently. KAPP and Principal Buyer article parsing was verified locally; the counts above do not prove their scheduled cloud runs succeed.

Outstanding access checks include KAHRAMAA (DNS lookup failed), PIF (timeout), KUNA (transport failed), and an SPPC candidate domain (browser certificate mismatch). KAPP and Principal Buyer use host-specific supplementary certificate chains after validation; TLS and hostname checks remain enabled. A reachable procurement page containing only an external supplier login is not counted as working announcement discovery.

Operational results appear in the private overview's task list: new link count, correction rechecks, retries and safe error reasons. Link discovery itself makes no paid model calls. Article extraction remains subject to the existing provider budgets.

## MENA scope expansion — 2026-09-27

The product supports 24 countries/territories defined in `lib/intelligence/regions.json`, grouped as GCC, other Middle East and North Africa. This is a product boundary, not a claim of universal MENA geography or full collection coverage. Western Sahara is separately labeled as disputed; occurrence, affected regions and cross-border topics remain separate.

Three additional indexes and article bodies were verified using the production HTTPS fetcher and actual model analysis with preserved originals and exact quotes:

| Publisher | Index | First-page article links | Verified sample publication date |
| --- | --- | ---: | --- |
| Türkiye Ministry of Energy | https://enerji.gov.tr/media-news | 15 | 2026-05-12 |
| Morocco MASEN | https://www.masen.ma/fr/actualites-masen | 10 | 2026-07-23 |
| Algeria Sonelgaz | https://www.sonelgaz.dz/fr/category/actualites | 15 | 2026-08-11 |

These sample dates are historical, not fresh intelligence. The default 30-day filter continues to exclude them. Article IDs in Turkish query parameters are preserved; dates in unrelated Algerian sidebar stories are excluded. Each new index is limited to one unseen article and one correction revisit per daily run, with pending links explicitly reported. Original GCC limits are unchanged. Country search retains the six GCC countries plus at most two rotating enabled additional countries per day. Existing budget limits and pause behavior remain unchanged.

Egypt, Iraq, Iran and Israel were probed but are not enabled: official endpoints returned transport/access/encoding errors, or readable content lacked verifiable publication dates. Other unverified countries remain pending. The overview shows configuration and actual daily entry status separately. A successful index task is not proof that its child article extraction succeeded, or that a country's market is fully covered. Scheduled cloud evidence is recorded separately from local parsing and paid model verification; no manual verification counts as a natural observation day.

### Additional verified source — Libya NOC

`https://noc.ly/en/` exposes three dated article cards in the checked page. Report navigation is excluded. The 2026-09-26 announcement about resumed Sharara–Zawiya crude flow has explicit publication metadata, an isolated article body and eight model-validated quotations. It is enabled as `noc-news`, with the same one-new/one-revisit cap. Today's persisted country-search selection remains unchanged when a release adds countries, preventing deployments from exceeding the two-extra-country daily limit.

The remaining regional probe checked Jordan, Lebanon, Syria, Yemen, Palestine, Cyprus, Tunisia, Sudan, Mauritania and the UN mission in Western Sahara. Readable landing pages alone did not qualify them for activation: several article samples lacked explicit publication fields, while others returned encoding, timeout, redirect, DNS or TLS failures. UN mission access is not proof of energy-market coverage. These remain pending; no TLS bypass, guessed publication date or extra budget was used.
