const dns = require('node:dns').promises;
const https = require('node:https');
const { rootCertificates } = require('node:tls');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { isIP } = require('node:net');
const { createHash } = require('node:crypto');
const ipaddr = require('ipaddr.js');
const cheerio = require('cheerio');

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 25_000;
// omannews.gov.om serves only its leaf certificate. This DigiCert intermediate
// was verified against the bundled trust root; keep normal TLS verification on.
const OMAN_NEWS_CA = [...rootCertificates,
  readFileSync(join(__dirname, 'certs/digicert-global-g2-tls-rsa-sha256-2020-ca1.pem'), 'utf8')];
// fsa.gov.om and www.pb.com.sa omit their issuer. Add the verified Sectigo
// chain only for those two publishers while retaining normal TLS verification.
const SECTIGO_R36_CA = [...rootCertificates,
  readFileSync(join(__dirname, 'certs/sectigo-public-server-authentication-root-r46.pem'), 'utf8'),
  readFileSync(join(__dirname, 'certs/sectigo-public-server-authentication-ca-dv-r36.pem'), 'utf8')];
// KAPP serves only its leaf certificate. Supply the verified Let's Encrypt
// issuer chain for this publisher while retaining the normal trust roots.
const KAPP_CA = [...rootCertificates,
  readFileSync(join(__dirname, 'certs/lets-encrypt-yr1.pem'), 'utf8'),
  readFileSync(join(__dirname, 'certs/isrg-root-yr-by-x1.pem'), 'utf8')];

function failure(code, status, message) {
  return Object.assign(new Error(message), { code, status });
}

function assertPublicAddress(address) {
  const parsed = ipaddr.isValid(address) ? ipaddr.parse(address) : null;
  // The library's default range also includes deprecated IPv6 site-local space.
  if (!parsed || parsed.range() !== 'unicast' ||
      (parsed.kind() === 'ipv6' && !parsed.match(ipaddr.parse('2000::'), 3))) {
    throw failure('source_unsafe_address', 400, 'Source must resolve only to public addresses.');
  }
  return address;
}

function validateUrl(input) {
  let url;
  try { url = new URL(input); } catch {
    throw failure('source_invalid_url', 400, 'Source URL is invalid.');
  }
  if (url.protocol !== 'https:' || (url.port && url.port !== '443') || url.username || url.password) {
    throw failure('source_invalid_url', 400, 'Source must use HTTPS on port 443 without credentials.');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(hostname)) assertPublicAddress(hostname);
  url.hash = '';
  return url;
}

function assertUtf8(declaration) {
  if (declaration && !/^utf-?8$/i.test(declaration.trim())) {
    throw failure('source_unsupported_encoding', 415, 'Only UTF-8 source documents are supported.');
  }
}

function declaredCharset(contentType) {
  return /\bcharset\s*=\s*["']?([^;"'\s]+)/i.exec(contentType)?.[1];
}

function memArticleId(url) {
  if (!url) return null;
  const parsed = new URL(url);
  return parsed.hostname === 'mem.gov.om' && !parsed.search
    ? /^\/public\/news\/([a-z0-9]{24})\/?$/.exec(parsed.pathname)?.[1] || null : null;
}

function extractDocument(bytes, contentType, excerptLimit = 2_000, url = '') {
  const mime = contentType.split(';')[0].trim().toLowerCase();
  const articleId = memArticleId(url);
  if (mime === 'application/json' && articleId) {
    let item;
    try { item = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)).data; } catch {
      throw failure('source_empty_document', 422, 'Official article response is invalid.');
    }
    if (item?.documentId !== articleId || item?.type !== 'MEM' || item?.CommunicationType !== 'NEWS'
      || typeof item.englishTitle !== 'string' || !item.englishTitle.trim()
      || typeof item.englishDescription !== 'string' || !item.englishDescription.trim()) {
      throw failure('source_empty_document', 422, 'Official article response has no matching body.');
    }
    return { title: Array.from(item.englishTitle.replace(/\s+/g, ' ').trim()).slice(0, 500).join(''),
      excerpt: Array.from(item.englishDescription.replace(/\s+/g, ' ').trim()).slice(0, excerptLimit).join('') };
  }
  if (!['text/html', 'text/plain'].includes(mime)) {
    throw failure('source_unsupported_type', 415, 'Source must be HTML or plain text.');
  }
  assertUtf8(declaredCharset(contentType));
  let document;
  try { document = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch {
    throw failure('source_unsupported_encoding', 415, 'Source is not valid UTF-8.');
  }
  let title = '';
  let text = document;
  if (mime === 'text/html') {
    const $ = cheerio.load(document);
    $('meta[charset]').each((_, element) => assertUtf8($(element).attr('charset')));
    $('meta[http-equiv]').each((_, element) => {
      if ($(element).attr('http-equiv').toLowerCase() === 'content-type') {
        assertUtf8(declaredCharset($(element).attr('content') || ''));
      }
    });
    $('script, style, noscript, template, iframe, object, embed, svg, canvas, nav, footer, aside').remove();
    // These article containers were verified against the saved source corpus.
    // Prefer them to a whole-page main/body that can contain other projects' headlines.
    const fsaArticle = url && new URL(url).hostname === 'fsa.gov.om' ? $('main .body-content').first() : null;
    const articleUrl = url ? new URL(url) : null;
    const kappArticle = articleUrl?.hostname === 'www.kapp.gov.kw' && /^\/(?:media\/get_details|announcement\/details)\/\d+\/?$/.test(articleUrl.pathname)
      ? $('.blog-items > .blog-content > .item > .info.content-box').first() : null;
    const pbArticle = articleUrl?.hostname === 'www.pb.com.sa' && /^\/media-center\/news\/[^/]+\/?$/.test(articleUrl.pathname)
      ? $('.content-holder > .detail-content').first() : null;
    const article = kappArticle?.length ? kappArticle : pbArticle?.length ? pbArticle : fsaArticle?.length ? fsaArticle
      : $('.news-dt-body, .__news_details_sec, .news-listing.details .news-list, .news-page-holder.news-details-holder, .press-release-detail .content-sec, .our-blog .entry-content, .com-content-article__body, .blogDetail-content').first();
    if (fsaArticle?.length) article.find('.breadcrumb, #Control, .nextpreviuse').remove();
    if (kappArticle?.length) article.find('.post-pagi-area').remove();
    if (kappArticle?.length && !article.find('p').text().replace(/\s+/g, ' ').trim()) {
      throw failure('source_empty_document', 422, 'Official article has no readable body.');
    }
    const main = $('main, [role="main"]').first();
    const content = article.length ? article : main.length ? main : $('body');
    const heading = article.find('h1, h2, h3').first().text().trim();
    let documentTitle = heading || $('meta[property="og:title"]').first().attr('content') || $('title').first().text();
    if (!documentTitle.trim() || /\|\s*$/.test(documentTitle)) {
      documentTitle = content.find('h1, h2, h3').filter((_, element) => $(element).text().trim().length > 10).first().text() || documentTitle;
    }
    title = Array.from(documentTitle.replace(/\s+/g, ' ').trim()).slice(0, 500).join('');
    // A site's outer header is navigation; headers inside the selected article may be evidence.
    $('body > header').remove();
    $('br').replaceWith('\n');
    $('p, div, section, article, li, h1, h2, h3, h4, h5, h6, tr').append('\n');
    text = content.text();
    if (!text.replace(/\s+/g, ' ').trim()) {
      const descriptions = ['meta[name="description"]', 'meta[property="og:description"]']
        .map(selector => $(selector).first().attr('content') || '').sort((left, right) => right.length - left.length);
      text = descriptions[0] || '';
    }
  }
  return { title, excerpt: Array.from(text.replace(/\s+/g, ' ').trim()).slice(0, excerptLimit).join('') };
}

function isPlaceholderDocument(url, title) {
  return /^under construction$/i.test(String(title || '').trim())
    && typeof url === 'string' && /^\/under-construction\/?$/i.test(new URL(url).pathname);
}

function requestSource(url, address, signal) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      agent: false,
      ca: ['omannews.gov.om', 'www.omannews.gov.om'].includes(url.hostname) ? OMAN_NEWS_CA
        : ['fsa.gov.om', 'www.pb.com.sa'].includes(url.hostname) ? SECTIGO_R36_CA
          : url.hostname === 'www.kapp.gov.kw' ? KAPP_CA : undefined,
      signal,
      family: address.family,
      autoSelectFamily: false,
      lookup(_hostname, options, callback) {
        if (options.all) callback(null, [address]);
        else callback(null, address.address, address.family);
      },
      headers: {
        'User-Agent': 'NRGOPT-Source-Import/1.0',
        Accept: 'text/html, text/plain, application/json',
        'Accept-Encoding': 'identity',
      },
    }, (response) => {
      const stop = (error) => { response.destroy(); reject(error); };
      response.on('error', reject);
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.destroy();
        if (!response.headers.location) {
          reject(failure('source_invalid_redirect', 502, 'Source redirect has no location.'));
        } else resolve({ location: response.headers.location });
        return;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        const code = [401, 403, 405].includes(response.statusCode) ? 'source_access_denied'
          : [404, 410].includes(response.statusCode) ? 'source_not_found'
          : response.statusCode === 429 ? 'source_rate_limited' : 'source_http_error';
        stop(failure(code, 502, 'Source returned an unsuccessful HTTP response.'));
        return;
      }
      if (response.headers['content-encoding'] && response.headers['content-encoding'].toLowerCase() !== 'identity') {
        stop(failure('source_unsupported_encoding', 415, 'Compressed source responses are not supported.'));
        return;
      }
      if (Number(response.headers['content-length']) > MAX_BYTES) {
        stop(failure('source_too_large', 413, 'Source exceeds the 2 MiB limit.'));
        return;
      }
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BYTES) stop(failure('source_too_large', 413, 'Source exceeds the 2 MiB limit.'));
        else chunks.push(chunk);
      });
      response.on('end', () => resolve({
        bytes: Buffer.concat(chunks),
        contentType: response.headers['content-type'] || '',
      }));
    });
    request.on('error', reject);
  });
}

async function fetchSource(input) {
  const requestedUrl = validateUrl(input).href;
  const articleId = memArticleId(requestedUrl);
  const evidenceUrl = articleId
    ? `https://mem.gov.om/cms/api/communication-items/${articleId}?populate=*` : requestedUrl;
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = failure('source_timeout', 504, 'Source fetch exceeded 25 seconds.');
      controller.abort(error);
      reject(error);
    }, TIMEOUT_MS);
  });
  const collect = async () => {
    let url = validateUrl(evidenceUrl);
    for (let redirects = 0; ; redirects += 1) {
      const hostname = url.hostname.replace(/^\[|\]$/g, '');
      const addresses = isIP(hostname)
        ? [{ address: hostname, family: isIP(hostname) }]
        : await dns.lookup(hostname, { all: true, verbatim: true });
      controller.signal.throwIfAborted();
      if (!addresses.length) throw failure('source_dns_error', 502, 'Source has no DNS addresses.');
      addresses.forEach(({ address }) => assertPublicAddress(address));
      let response;
      let lastError;
      for (const address of addresses) {
        try { response = await requestSource(url, address, controller.signal); break; }
        catch (error) {
          if (error.code?.startsWith('source_')) throw error;
          lastError = error;
        }
      }
      if (!response) throw lastError || failure('source_fetch_failed', 502, 'Source could not be fetched.');
      if (response.location) {
        if (articleId) throw failure('source_invalid_redirect', 502, 'Official article API redirected.');
        if (redirects >= 3) throw failure('source_redirect_limit', 502, 'Source exceeded three redirects.');
        let next;
        try { next = new URL(response.location, url); } catch {
          throw failure('source_invalid_redirect', 502, 'Source redirect URL is invalid.');
        }
        url = validateUrl(next.href);
        continue;
      }
      const finalUrl = articleId ? requestedUrl : url.href;
      const document = extractDocument(response.bytes, response.contentType, 2_000, finalUrl);
      if (!document.excerpt || isPlaceholderDocument(finalUrl, document.title)) {
        throw failure('source_empty_document', 422, 'Source contains no readable article.');
      }
      return {
        requestedUrl, finalUrl, contentType: response.contentType.split(';')[0].trim().toLowerCase(), bytes: response.bytes,
        sha256: createHash('sha256').update(response.bytes).digest('hex'),
        ...document,
      };
    }
  };
  try {
    return await Promise.race([collect(), timeout]);
  } catch (error) {
    if (error.code?.startsWith('source_')) throw error;
    if (['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'CERT_HAS_EXPIRED',
      'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'ERR_TLS_CERT_ALTNAME_INVALID'].includes(error.code)) {
      throw failure('source_tls_error', 502, 'Source certificate could not be verified.');
    }
    if (['ENOTFOUND', 'EAI_AGAIN'].includes(error.code)) throw failure('source_dns_error', 502, 'Source DNS lookup failed.');
    if (['ECONNRESET', 'EPIPE'].includes(error.code)) throw failure('source_connection_reset', 502, 'Source connection was interrupted.');
    if (['ETIMEDOUT', 'ESOCKETTIMEDOUT'].includes(error.code)) throw failure('source_connection_timeout', 504, 'Source connection timed out.');
    throw failure('source_fetch_failed', 502, 'Source could not be fetched.');
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { fetchSource, validateUrl, assertPublicAddress, extractDocument, isPlaceholderDocument };
