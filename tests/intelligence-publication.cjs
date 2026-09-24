const test = require('node:test');
const assert = require('node:assert/strict');
const { publicationMetadata, parseDate } = require('../lib/intelligence/publication.cjs');
const parse = (html, url = 'https://official.example/news', excerpt = '') => publicationMetadata(Buffer.from(html), 'text/html', url, excerpt);

test('publication metadata keeps date precision and preserves evidence', () => {
  const date = parse('<meta property="article:published_time" content="2025-02-20">');
  assert.equal(date.publication_date, '2025-02-20');
  assert.equal(date.published_at, null);
  assert.match(date.publication_evidence, /2025-02-20/);
  const timed = parse('<script type="application/ld+json">{"@graph":[{"@type":"NewsArticle","datePublished":"2025-02-20T11:03:00+03:00"}]}</script>');
  assert.equal(timed.published_at, '2025-02-20T08:03:00.000Z');
  assert.equal(timed.publication_date, '2025-02-20');
});

test('SPA datelines are publisher-scoped and do not fabricate time of day', () => {
  const excerpt = 'Riyadh, February 20, 2025, SPA -- Project agreement signed.';
  const result = parse('', 'https://www.spa.gov.sa/en/N2266456', excerpt);
  assert.equal(result.publication_date, '2025-02-20');
  assert.equal(result.publication_method, 'spa_dateline');
  assert.equal(result.published_at, null);
  assert.equal(parse('', 'https://example.com', excerpt).publication_date, null);
  assert.equal(parse('', 'https://spa.gov.sa.evil.example', excerpt).publication_date, null);
  assert.equal(parse('', 'https://spa.gov.sa', 'The project will start on February 20, 2025.').publication_date, null);
});

test('missing, ambiguous and modified dates cannot become a publication date', () => {
  for (const value of ['2025-02-30', '2025-13-01', '20/02/2025', 'yesterday', '', '2025-01-01T99:00:00Z', '2025-01-01T24:00:00Z']) assert.equal(parseDate(value), null);
  assert.equal(parse('<meta property="article:modified_time" content="2026-09-24"><time datetime="2026-09-24">today</time>').publication_date, null);
  assert.equal(parse('<script type="application/ld+json">{"@type":"Organization","datePublished":"2025-01-01"}</script>').publication_date, null);
  assert.equal(parse('<script type="application/ld+json">invalid JSON</script>').publication_date, null);
  const conflict = parse('<meta property="article:published_time" content="2025-02-20"><script type="application/ld+json">{"@type":"Article","datePublished":"2025-03-01"}</script>');
  assert.equal(conflict.publication_date, null);
  assert.equal(conflict.publication_method, 'conflicting_metadata');
  assert.match(conflict.publication_evidence, /2025-02-20.*2025-03-01/);
});

test('multilingual pages retain ISO publication metadata without translating or executing scripts', () => {
  for (const headline of ['مشروع الطاقة', '能源项目', 'Energy project']) {
    const result = parse(`<time itemprop="datePublished" datetime="2024-02-29">${headline}</time>`);
    assert.equal(result.publication_date, '2024-02-29');
  }
});

test('observed publisher datelines exclude related articles and last-updated dates', () => {
  const ewa = '<div class="__news_details_sec_head"><div class="__date_div">05 Jul 2026</div></div>'
    + '<section class="__last-updated-main">22 September 2026</section><div class="news-date">01 Jul 2026</div>';
  const result = parse(ewa, 'https://www.ewa.bh/en/announcement');
  assert.equal(result.publication_date, '2026-07-05');
  assert.equal(result.publication_method, 'metadata');
  assert.equal(result.published_at, null);
  assert.equal(result.publication_evidence, 'publisher_dateline: 05 Jul 2026');
  assert.equal(parse(ewa, 'https://ewa.bh.evil.example/').publication_date, null);
  const masdar = '<div class="news-listing details"><div class="actionables"><div class="date">23 SEP 2026</div></div></div>';
  assert.equal(parse(masdar, 'https://masdar.ae/en/news/newsroom/report').publication_date, '2026-09-23');
  assert.equal(parse(masdar.replace('23 SEP', '31 FEB'), 'https://masdar.ae/').publication_date, null);
  const conflict = parse('<meta property="article:published_time" content="2026-07-06">' + ewa, 'https://ewa.bh/');
  assert.equal(conflict.publication_date, null);
  assert.equal(conflict.publication_method, 'conflicting_metadata');
});

test('QNA article date comes from its saved header attribute, not the URL or related news', () => {
  const header = '<div class="news-details-holder"><span id="news-date" data-utc-time-to-local="2026-09-24T10:10:47"></span></div>';
  const related = '<aside><span id="news-date" data-utc-time-to-local="2026-09-25T09:00:00"></span></aside>';
  const result = parse(header + related, 'https://qna.org.qa/en/news/news-details?date=25/09/2026');
  assert.equal(result.publication_date, '2026-09-24');
  assert.equal(result.publication_method, 'metadata');
  assert.equal(result.published_at, null);
  assert.equal(result.publication_evidence, 'publisher_dateline: 2026-09-24T10:10:47');
  assert.equal(parse(related, 'https://qna.org.qa/').publication_date, null);
  assert.equal(parse(header, 'https://qna.org.qa.evil.example/').publication_date, null);
  assert.equal(parse(header.replace('2026-09-24', '2026-02-30'), 'https://qna.org.qa/').publication_date, null);
  assert.equal(parse('', 'https://qna.org.qa/en/News-Area/News/2026-9/24/title').publication_date, null);
  const conflict = parse(header + '<meta property="article:published_time" content="2026-09-23">', 'https://qna.org.qa/');
  assert.equal(conflict.publication_date, null);
  assert.equal(conflict.publication_method, 'conflicting_metadata');
});
