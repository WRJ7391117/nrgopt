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

test('ONA article date requires its own dateline and matching publisher byline', () => {
  const article = (lead, byline = '22 January 2026') => '<div class="post-item"><article class="post-content"><div class="back-home-news-child">'
    + `<!--h5><span class="author-name skew25"> ${byline} </span></h5>--><p>Article title</p><p>${lead}</p></div></article></div>`;
  const url = 'https://omannews.gov.om/topics/en/79/show/126638';
  const result = parse(article('Muscat, 22 Jan 2026 (ONA) --- Project signed.')
    + '<aside><p>Related item: 24 Sep 2026 (ONA) --- Other news.</p></aside>', url);
  assert.equal(result.publication_date, '2026-01-22');
  assert.equal(result.publication_method, 'metadata');
  assert.equal(result.published_at, null);
  assert.match(result.publication_evidence, /publisher_dateline: 2026-01-22/);
  assert.equal(parse(article('Muscat, 22 Jan (ONA) --- Project signed.', '22 January 2025'), url).publication_date, '2025-01-22');
  assert.equal(parse(article('Muscat, 22 Jan (ONA) --- Project signed.', '23 January 2026'), url).publication_date, null);
  assert.equal(parse(article('A future event is planned for 22 Jan 2026.'), url).publication_date, null);
  assert.equal(parse(article('Muscat, 22 Jan (ONA) --- Project signed.'), 'https://omannews.gov.om.evil.example/').publication_date, null);
  const conflict = parse(article('Muscat, 22 Jan 2026 (ONA) --- Project signed.', '22 January 2025'), url);
  assert.equal(conflict.publication_date, null);
  assert.equal(conflict.publication_method, 'conflicting_metadata');
});

test('MEM publication date comes from the matching official article response', () => {
  const id = 'n5efiz4fr7o01xqbg9u5gcni';
  const url = `https://mem.gov.om/public/news/${id}`;
  const item = { data: { documentId: id, type: 'MEM', CommunicationType: 'NEWS', date: '2026-03-08' } };
  const parseJson = (value, target = url) => publicationMetadata(Buffer.from(JSON.stringify(value)), 'application/json', target);
  assert.equal(parseJson(item).publication_date, '2026-03-08');
  assert.equal(parseJson(item).published_at, null);
  assert.equal(parseJson(item).publication_evidence, 'metadata: 2026-03-08');
  assert.equal(parseJson(item, `https://mem.gov.om.evil.example/public/news/${id}`).publication_date, null);
  assert.equal(parseJson({ data: { ...item.data, documentId: 'different' } }).publication_date, null);
});

test('FSA publication date comes from its article header rather than a related item', () => {
  const body = '<main><div class="body-content"><h2>Official decision</h2><div class="newsimg"><p>22 June 2025</p></div></div></main>';
  const related = '<aside class="newsimg"><p>23 June 2025</p></aside>';
  const url = 'https://fsa.gov.om/Home/SearchNews/12?newsId=10711';
  assert.equal(parse(body + related, url).publication_date, '2025-06-22');
  assert.equal(parse(body, 'https://fsa.gov.om.evil.example/').publication_date, null);
  assert.equal(parse('<main><p>22 June 2025</p></main>', url).publication_date, null);
});

test('KAPP article date comes only from its own header', () => {
  const article = '<div class="blog-items"><div class="blog-content"><div class="item"><div class="info content-box">'
    + '<div class="meta"><div class="date">03 Feb, 2026</div></div><h3>مشروع محطة الزور</h3></div></div></div></div>';
  const related = '<aside><div class="date">24 Sep, 2026</div></aside>';
  const url = 'https://www.kapp.gov.kw/media/get_details/126';
  const result = parse(article + related, url);
  assert.equal(result.publication_date, '2026-02-03');
  assert.equal(result.published_at, null);
  assert.equal(result.publication_evidence, 'publisher_dateline: 03 Feb, 2026');
  assert.equal(parse(article, 'https://www.kapp.gov.kw/announcement/details/84').publication_date, '2026-02-03');
  assert.equal(parse(article, 'https://www.kapp.gov.kw/news-media').publication_date, null);
  assert.equal(parse(article, 'https://www.kapp.gov.kw.evil.example/media/get_details/126').publication_date, null);
  assert.equal(parse(article, 'https://www.kapp.gov.kw.evil.example/announcement/details/84').publication_date, null);
  assert.equal(parse(article.replace('03 Feb', '31 Feb'), url).publication_date, null);
  assert.equal(parse(article + '<meta property="article:published_time" content="2026-02-04">', url).publication_method,
    'conflicting_metadata');
});

test('Principal Buyer article date comes only from its own banner', () => {
  const article = '<div class="main_bannar media-detail"><div class="banner-text"><h4>20 Aug 2026</h4>'
    + '<h2>Four BESS agreements</h2></div></div>';
  const related = '<aside><h4>21 Sep 2026</h4></aside>';
  const url = 'https://www.pb.com.sa/media-center/news/four-bess-agreements/';
  const result = parse(article + related, url);
  assert.equal(result.publication_date, '2026-08-20');
  assert.equal(result.publication_evidence, 'publisher_dateline: 20 Aug 2026');
  assert.equal(parse(article, 'https://www.pb.com.sa/').publication_date, null);
  assert.equal(parse(article, 'https://www.pb.com.sa.evil.example/media-center/news/four-bess-agreements/').publication_date, null);
  assert.equal(parse(article.replace('20 Aug', '31 Feb'), url).publication_date, null);
});
