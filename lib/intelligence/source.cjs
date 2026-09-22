const dns = require('node:dns').promises;
const https = require('node:https');
const { isIP } = require('node:net');
const { createHash } = require('node:crypto');
const ipaddr = require('ipaddr.js');
const cheerio = require('cheerio');

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 25_000;

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

function extractDocument(bytes, contentType, excerptLimit = 2_000) {
  const mime = contentType.split(';')[0].trim().toLowerCase();
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
    $('script, style, noscript, template, iframe, object, embed, svg, canvas').remove();
    title = Array.from($('title').first().text().replace(/\s+/g, ' ').trim()).slice(0, 500).join('');
    $('br').replaceWith('\n');
    $('p, div, section, article, li, h1, h2, h3, h4, h5, h6, tr').append('\n');
    const main = $('main, [role="main"]').first();
    text = (main.length ? main : $('body')).text();
    if (!text.replace(/\s+/g, ' ').trim()) {
      const descriptions = ['meta[name="description"]', 'meta[property="og:description"]']
        .map(selector => $(selector).first().attr('content') || '').sort((left, right) => right.length - left.length);
      text = descriptions[0] || '';
    }
  }
  return { title, excerpt: Array.from(text.replace(/\s+/g, ' ').trim()).slice(0, excerptLimit).join('') };
}

function requestSource(url, address, signal) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      agent: false,
      signal,
      family: address.family,
      autoSelectFamily: false,
      lookup(_hostname, options, callback) {
        if (options.all) callback(null, [address]);
        else callback(null, address.address, address.family);
      },
      headers: {
        'User-Agent': 'NRGOPT-Source-Import/1.0',
        Accept: 'text/html, text/plain',
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
        stop(failure('source_http_error', 502, 'Source returned an unsuccessful HTTP response.'));
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
    let url = validateUrl(requestedUrl);
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
        if (redirects >= 3) throw failure('source_redirect_limit', 502, 'Source exceeded three redirects.');
        let next;
        try { next = new URL(response.location, url); } catch {
          throw failure('source_invalid_redirect', 502, 'Source redirect URL is invalid.');
        }
        url = validateUrl(next.href);
        continue;
      }
      return {
        requestedUrl, finalUrl: url.href, contentType: response.contentType.split(';')[0].trim().toLowerCase(), bytes: response.bytes,
        sha256: createHash('sha256').update(response.bytes).digest('hex'),
        ...extractDocument(response.bytes, response.contentType),
      };
    }
  };
  try {
    return await Promise.race([collect(), timeout]);
  } catch (error) {
    if (error.code?.startsWith('source_')) throw error;
    throw failure('source_fetch_failed', 502, 'Source could not be fetched.');
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { fetchSource, validateUrl, assertPublicAddress, extractDocument };
