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
