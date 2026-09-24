const assert = require('node:assert/strict');
const dns = require('node:dns').promises;
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createHash } = require('node:crypto');
const { fetchSource, validateUrl, assertPublicAddress, extractDocument } = require('../lib/intelligence/source.cjs');

async function main() {
  for (const address of [
    '127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.0.1', '169.254.169.254',
    '100.100.100.200', '0.0.0.0', '198.18.0.1', '224.0.0.1', '255.255.255.255',
    '::', '::1', 'fd00:ec2::254', 'fe80::1', 'fec0::1', 'ff02::1', '::ffff:127.0.0.1',
    '::192.168.0.1', '64:ff9b::127.0.0.1', '2001:db8::1',
  ]) assert.throws(() => assertPublicAddress(address), { code: 'source_unsafe_address', status: 400 });
  for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) {
    assert.equal(assertPublicAddress(address), address);
  }
  for (const url of ['http://example.com', 'https://user:secret@example.com', 'https://example.com:444', 'not a url']) {
    assert.throws(() => validateUrl(url), { code: 'source_invalid_url', status: 400 });
  }
  for (const url of ['https://2130706433', 'https://0x7f000001', 'https://[::ffff:127.0.0.1]']) {
    assert.throws(() => validateUrl(url), { code: 'source_unsafe_address' });
  }
  assert.equal(validateUrl('https://example.com:443/a#fragment').href, 'https://example.com/a');

  const html = Buffer.from('<title>Project &amp; Energy</title><script>globalThis.sourceExecuted = true</script><style>SECRET_STYLE</style><p>First fact.</p><p>第二条事实。</p>');
  const extracted = extractDocument(html, 'text/html; charset=UTF-8');
  assert.deepEqual(extracted, { title: 'Project & Energy', excerpt: 'First fact. 第二条事实。' });
  assert.equal(globalThis.sourceExecuted, undefined);
  const metadataOnly = extractDocument(Buffer.from('<title>Official notice</title><meta name="description" content="First official fact. Second official fact."><script>{"content":"not executed"}</script><body></body>'), 'text/html');
  assert.deepEqual(metadataOnly, { title: 'Official notice', excerpt: 'First official fact. Second official fact.' });
  assert.throws(() => extractDocument(html, 'application/json'), { code: 'source_unsupported_type' });
  assert.throws(() => extractDocument(html, 'text/html; charset=gbk'), { code: 'source_unsupported_encoding' });
  assert.throws(() => extractDocument(Buffer.from('<meta charset="gb2312"><p>News</p>'), 'text/html'), { code: 'source_unsupported_encoding' });
  assert.throws(() => extractDocument(Buffer.from([0xff]), 'text/plain'), { code: 'source_unsupported_encoding' });
  const longDocument = Buffer.from(`<title>Long energy report</title><nav>${'Site navigation. '.repeat(200)}</nav><main><p>${'Solar project facts. '.repeat(200)}</p></main>`);
  const longExcerpt = extractDocument(longDocument, 'text/html; charset=utf-8').excerpt;
  assert.equal(longExcerpt.length, 2_000);
  assert.ok(longExcerpt.startsWith('Solar project facts.'));
  assert.ok(!longExcerpt.includes('Site navigation.'));
  const emojiTitle = extractDocument(Buffer.from(`<title>${'a'.repeat(499)}😀extra</title>`), 'text/html').title;
  assert.equal(emojiTitle, `${'a'.repeat(499)}😀`);
  assert.equal(emojiTitle.isWellFormed(), true);
  assert.equal(Array.from(emojiTitle).length, 500);
  const emojiExcerpt = extractDocument(Buffer.from(`${'a'.repeat(1999)}😀extra`), 'text/plain').excerpt;
  assert.equal(emojiExcerpt, `${'a'.repeat(1999)}😀`);
  assert.equal(emojiExcerpt.isWellFormed(), true);
  assert.equal(Array.from(emojiExcerpt).length, 2_000);

  const originalLookup = dns.lookup;
  const originalGet = https.get;
  const lookups = [];
  const requests = [];
  let answers = {};
  let responses = [];
  dns.lookup = async (hostname) => {
    lookups.push(hostname);
    return (answers[hostname] || ['8.8.8.8']).map(address => ({ address, family: 4 }));
  };
  https.get = (url, options, callback) => {
    const request = new EventEmitter();
    requests.push({ url: url.href, options });
    const fixture = responses.shift();
    assert.ok(fixture, 'Unexpected source request');
    process.nextTick(() => {
      if (fixture.error) { request.emit('error', fixture.error); return; }
      const response = new PassThrough();
      response.statusCode = fixture.status || 200;
      response.headers = fixture.headers || { 'content-type': 'text/html; charset=utf-8' };
      callback(response);
      if (!response.destroyed) response.end(fixture.bytes || html);
    });
    return request;
  };
  try {
    responses = [{ status: 302, headers: { location: 'https://other.example/story' } }, {}];
    const source = await fetchSource('https://news.example/start');
    assert.equal(source.finalUrl, 'https://other.example/story');
    assert.equal(source.requestedUrl, 'https://news.example/start');
    assert.deepEqual(source.bytes, html);
    assert.equal(source.sha256, createHash('sha256').update(html).digest('hex'));
    assert.equal(source.title, extracted.title);
    assert.equal(source.contentType, 'text/html');
    assert.deepEqual(lookups, ['news.example', 'other.example']);
    for (const request of requests) {
      assert.equal(request.options.agent, false);
      assert.equal(request.options.headers['Accept-Encoding'], 'identity');
      request.options.lookup('news.example', {}, (error, address, family) => {
        assert.equal(error, null);
        assert.equal(address, '8.8.8.8');
        assert.equal(family, 4);
      });
    }
    // Changing DNS after validation cannot change the address used by HTTPS.
    answers['news.example'] = ['127.0.0.1'];
    requests[0].options.lookup('news.example', { all: true }, (error, addresses) => {
      assert.equal(error, null);
      assert.deepEqual(addresses, [{ address: '8.8.8.8', family: 4 }]);
    });
    const beforeUnsafe = requests.length;
    await assert.rejects(fetchSource('https://news.example/'), { code: 'source_unsafe_address' });
    assert.equal(requests.length, beforeUnsafe);
    answers = { 'mixed.example': ['8.8.8.8', '169.254.169.254'], 'internal.example': ['10.0.0.1'] };
    await assert.rejects(fetchSource('https://mixed.example/'), { code: 'source_unsafe_address' });
    assert.equal(requests.length, beforeUnsafe);
    responses = [{ status: 302, headers: { location: 'https://internal.example/' } }];
    await assert.rejects(fetchSource('https://public.example/'), { code: 'source_unsafe_address' });
    assert.equal(requests.length, beforeUnsafe + 1);
    responses = [{ status: 302, headers: { location: 'http://example.com/' } }];
    await assert.rejects(fetchSource('https://public.example/'), { code: 'source_invalid_url' });
    answers = { 'fallback.example': ['8.8.8.8', '1.1.1.1'] };
    responses = [{ error: new Error('first public address unavailable') }, {}];
    const fallback = await fetchSource('https://fallback.example/');
    assert.equal(fallback.title, extracted.title);
    assert.equal(requests.at(-2).options.lookup('fallback.example', {}, (_, address) => assert.equal(address, '8.8.8.8')), undefined);
    requests.at(-1).options.lookup('fallback.example', {}, (_, address) => assert.equal(address, '1.1.1.1'));
    answers = {};
    responses = Array.from({ length: 4 }, () => ({ status: 302, headers: { location: '/again' } }));
    await assert.rejects(fetchSource('https://public.example/'), { code: 'source_redirect_limit' });
    responses = [{ headers: { 'content-length': '2097153' } }];
    await assert.rejects(fetchSource('https://public.example/'), { code: 'source_too_large', status: 413 });
    responses = [{ bytes: Buffer.alloc(2 * 1024 * 1024 + 1) }];
    await assert.rejects(fetchSource('https://public.example/'), { code: 'source_too_large', status: 413 });
    responses = [{ headers: { 'content-type': 'text/html', 'content-encoding': 'gzip' } }];
    await assert.rejects(fetchSource('https://public.example/'), { code: 'source_unsupported_encoding' });
    for (const [status, code] of [[403, 'source_access_denied'], [405, 'source_access_denied'], [404, 'source_not_found'], [429, 'source_rate_limited'], [503, 'source_http_error']]) {
      responses = [{ status }];
      await assert.rejects(fetchSource('https://public.example/'), { code, status: 502 });
    }
    responses = [{ error: Object.assign(new Error('certificate detail'), { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' }) }];
    await assert.rejects(fetchSource('https://public.example/'), { code: 'source_tls_error' });
    responses = [{ bytes: Buffer.from('<title>Ministry</title><body><script>loadArticle()</script></body>') }];
    await assert.rejects(fetchSource('https://public.example/'), { code: 'source_empty_document' });
    responses = [{ bytes: longDocument, headers: { 'content-type': 'Text/HTML; charset="UTF-8"' } }];
    const longSource = await fetchSource('https://public.example/long-report');
    assert.equal(longSource.contentType, 'text/html');
    assert.equal(longSource.excerpt.length, 2_000);
    assert.deepEqual(longSource.bytes, longDocument);
    responses = [{ headers: { 'content-type': 'text/html; charset=gbk' } }];
    await assert.rejects(fetchSource('https://public.example/legacy-report'), { code: 'source_unsupported_encoding' });
    const originalSetTimeout = global.setTimeout;
    const requestCount = requests.length;
    let finishDns;
    dns.lookup = () => new Promise(resolve => { finishDns = resolve; });
    global.setTimeout = (callback, milliseconds) => {
      assert.equal(milliseconds, 25_000);
      return originalSetTimeout(callback, 0);
    };
    try {
      await assert.rejects(fetchSource('https://slow.example/'), { code: 'source_timeout', status: 504 });
      finishDns([{ address: '8.8.8.8', family: 4 }]);
      await new Promise(resolve => originalSetTimeout(resolve, 0));
      assert.equal(requests.length, requestCount, 'DNS completion after timeout must not start HTTPS');
    } finally {
      global.setTimeout = originalSetTimeout;
    }
  } finally {
    dns.lookup = originalLookup;
    https.get = originalGet;
  }
  console.log('intelligence-source: all assertions passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
