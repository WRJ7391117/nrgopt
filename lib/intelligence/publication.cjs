const cheerio = require('cheerio');

function parseDate(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  const match = /^(\d{4}-\d{2}-\d{2})(?:T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.exec(raw);
  if (!match || !Number.isFinite(Date.parse(match[1])) || new Date(match[1]).toISOString().slice(0, 10) !== match[1]) return null;
  const timestamp = /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(raw) && Number.isFinite(Date.parse(raw))
    ? new Date(raw).toISOString() : null;
  if (raw.includes('T') && !Number.isFinite(Date.parse(raw))) return null;
  return { date: match[1], timestamp, raw };
}

// Only explicit publication fields qualify. Modified dates and arbitrary event dates do not.
function publicationMetadata(bytes, contentType, url, excerpt = '') {
  const found = [];
  let host;
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* No publisher-specific parsing. */ }
  const add = (value, method) => {
    const parsed = parseDate(value);
    if (parsed) found.push({ ...parsed, method });
  };
  if (host === 'mem.gov.om' && /^\/public\/news\/[a-z0-9]{24}\/?$/.test(new URL(url).pathname)
    && contentType.split(';')[0].trim() === 'application/json') {
    try {
      const item = JSON.parse(bytes.toString('utf8')).data;
      if (item?.documentId === new URL(url).pathname.split('/')[3] && item?.type === 'MEM'
        && item?.CommunicationType === 'NEWS') add(item.date, 'metadata');
    } catch { /* Invalid JSON is rejected by source extraction. */ }
  }
  if (contentType.split(';')[0].trim() === 'text/html') {
    const $ = cheerio.load(bytes);
    $('meta[property="article:published_time"], meta[name="datePublished"], meta[itemprop="datePublished"]').each((_, node) => add($(node).attr('content'), 'metadata'));
    $('time[itemprop="datePublished"]').each((_, node) => add($(node).attr('datetime'), 'metadata'));
    $('script[type="application/ld+json"]').each((_, node) => {
      let data;
      try { data = JSON.parse($(node).text()); } catch { return; }
      const objects = Array.isArray(data) ? data : [data];
      for (const item of objects.flatMap(item => item?.['@graph'] || [item])) {
        const types = Array.isArray(item?.['@type']) ? item['@type'] : [item?.['@type']];
        if (types.some(type => ['Article', 'NewsArticle', 'Report', 'BlogPosting'].includes(type))) add(item.datePublished, 'metadata');
      }
    });
    const selector = host === 'ewa.bh' ? '.__news_details_sec_head .__date_div'
      : host === 'masdar.ae' ? '.news-listing.details .actionables .date' : null;
    if (selector) $(selector).each((_, node) => {
      const raw = $(node).text().replace(/\s+/g, ' ').trim();
      const match = /^(\d{1,2}) ([A-Za-z]{3}) (\d{4})$/.exec(raw);
      if (!match) return;
      const month = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'].indexOf(match[2].toUpperCase()) + 1;
      const parsed = parseDate(`${match[3]}-${String(month).padStart(2, '0')}-${match[1].padStart(2, '0')}`);
      if (parsed) found.push({ ...parsed, raw, method: 'publisher_dateline' });
    });
    if (host === 'qna.org.qa') {
      $('.news-details-holder #news-date[data-utc-time-to-local]').each((_, node) => {
        const raw = $(node).attr('data-utc-time-to-local');
        const parsed = parseDate(raw);
        // Preserve the supplied precision; an unzoned value does not establish an instant.
        if (parsed) found.push({ ...parsed, raw, method: 'publisher_dateline' });
      });
    }
    if (host === 'fsa.gov.om') {
      $('main .body-content .newsimg p').first().each((_, node) => {
        const raw = $(node).text().replace(/\s+/g, ' ').trim();
        const match = /^(\d{1,2}) (January|February|March|April|May|June|July|August|September|October|November|December) (\d{4})$/.exec(raw);
        if (match) {
          const month = ['January','February','March','April','May','June','July','August','September','October','November','December'].indexOf(match[2]) + 1;
          add(`${match[3]}-${String(month).padStart(2, '0')}-${match[1].padStart(2, '0')}`, 'publisher_dateline');
        }
      });
    }
    if (host === 'kapp.gov.kw' && /^\/media\/get_details\/\d+\/?$/.test(new URL(url).pathname)) {
      $('.blog-items > .blog-content > .item > .info.content-box > .meta > .date').first().each((_, node) => {
        const raw = $(node).text().replace(/\s+/g, ' ').trim();
        const match = /^(\d{1,2}) ([A-Za-z]{3}), (\d{4})$/.exec(raw);
        if (!match) return;
        const month = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'].indexOf(match[2].toUpperCase()) + 1;
        const parsed = month && parseDate(`${match[3]}-${String(month).padStart(2, '0')}-${match[1].padStart(2, '0')}`);
        if (parsed) found.push({ ...parsed, raw, method: 'publisher_dateline' });
      });
    }
    if (host === 'pb.com.sa' && /^\/media-center\/news\/[^/]+\/?$/.test(new URL(url).pathname)) {
      $('.main_bannar.media-detail .banner-text > h4').first().each((_, node) => {
        const raw = $(node).text().replace(/\s+/g, ' ').trim();
        const match = /^(\d{1,2}) ([A-Za-z]{3}) (\d{4})$/.exec(raw);
        if (!match) return;
        const month = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'].indexOf(match[2].toUpperCase()) + 1;
        const parsed = month && parseDate(`${match[3]}-${String(month).padStart(2, '0')}-${match[1].padStart(2, '0')}`);
        if (parsed) found.push({ ...parsed, raw, method: 'publisher_dateline' });
      });
    }
    if (host === 'omannews.gov.om') {
      const article = $('.post-item .post-content .back-home-news-child').first();
      const lead = article.children('p').slice(0, 3).text().replace(/\s+/g, ' ');
      const dateline = /\b(\d{1,2}) ([A-Za-z]{3})(?: (\d{4}))? \(ONA\)\s*[-–—]+/.exec(lead);
      const comments = article.contents().filter((_, node) => node.type === 'comment').map((_, node) => node.data).get();
      const byline = comments.map(text => /<span class="author-name skew25">\s*(\d{1,2}) ([A-Za-z]+) (\d{4})\s*<\/span>/i.exec(text)).find(Boolean);
      const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
      const day = dateline?.[1].padStart(2, '0');
      const month = months.indexOf(dateline?.[2].toUpperCase()) + 1;
      if (dateline?.[3] && month) add(`${dateline[3]}-${String(month).padStart(2, '0')}-${day}`, 'publisher_dateline');
      if (byline && month && (!dateline[3] || byline[3] !== dateline[3])
        && Number(byline[1]) === Number(dateline[1]) && byline[2].slice(0, 3).toUpperCase() === dateline[2].toUpperCase()) {
        add(`${byline[3]}-${String(month).padStart(2, '0')}-${day}`, 'publisher_dateline');
      }
    }
  }
  if (host === 'spa.gov.sa' || host?.endsWith('.spa.gov.sa')) {
    const match = /^[^,\n]{1,100}, (January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2}), (\d{4}), SPA\s*[-–—]/.exec(excerpt);
    if (match) {
      const month = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].indexOf(match[1]) + 1;
      const parsed = parseDate(`${match[3]}-${String(month).padStart(2, '0')}-${match[2].padStart(2, '0')}`);
      if (parsed) found.push({ ...parsed, raw: match[0], method: 'spa_dateline' });
    }
  }
  if (!found.length) return { published_at: null, publication_date: null, publication_method: null, publication_evidence: null };
  const dates = new Set(found.map(item => item.date));
  const timestamps = new Set(found.map(item => item.timestamp).filter(Boolean));
  const conflict = dates.size > 1 || timestamps.size > 1;
  return {
    published_at: conflict ? null : [...timestamps][0] || null,
    publication_date: conflict ? null : found[0].date,
    publication_method: conflict ? 'conflicting_metadata' : found[0].method === 'publisher_dateline' ? 'metadata' : found[0].method,
    publication_evidence: found.map(item => `${item.method}: ${item.raw}`).join(' | ').slice(0, 2000)
  };
}

module.exports = { publicationMetadata, parseDate };
