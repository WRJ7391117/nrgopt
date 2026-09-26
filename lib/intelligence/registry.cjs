const cheerio = require('cheerio');
const { validateUrl } = require('./source.cjs');

// Entry points whose article links were verified with the production fetcher.
// Country is the publisher's location, never proof of a project's location.
const registry = [
  { id: 'acwa-news', country: 'SA', name: 'ACWA 官方公告', url: 'https://www.acwapower.com/en/media-center/latest-news/',
    selector: 'a[href]', path: '^/en/media-center/latest-news/[^/]+/?$' },
  { id: 'pb-news', country: 'SA', name: '沙特 Principal Buyer 官方公告', url: 'https://www.pb.com.sa/',
    selector: 'a[href]', path: '^/media-center/news/[^/]+/?$' },
  { id: 'nama-news', country: 'OM', name: '阿曼 Nama PWP 公告', url: 'https://www.omanpwp.om/news',
    selector: 'a[href]', path: '^/news-details/[^/]+/?$' },
  { id: 'ewa-news', country: 'BH', name: '巴林 EWA 公告', url: 'https://www.ewa.bh/en/news',
    selector: 'a.__news_col[href]', path: '^/en/[^/]+/?$' },
  { id: 'masdar-news', country: 'AE', name: 'Masdar 官方公告', url: 'https://masdar.ae/en/news/newsroom',
    selector: 'a[href]', path: '^/en/news/newsroom/[^/]+/?$' },
  { id: 'qna-economy', country: 'QA', name: '卡塔尔通讯社经济新闻', url: 'https://qna.org.qa/en/economy',
    selector: 'a[href]', path: '^/en/News-Area/News/[0-9-]+/[0-9]+/[^/]+/?$' },
  { id: 'kapp-news', country: 'KW', name: '科威特 KAPP 官方公告', url: 'https://www.kapp.gov.kw/news-media',
    selector: 'a[href]', path: '^/media/get_details/[0-9]+/?$' }
];

function registryLinks(entry, source) {
  const host = new URL(entry.url).hostname.replace(/^www\./, '');
  if (new URL(source.finalUrl).hostname.replace(/^www\./, '') !== host) {
    throw Object.assign(new Error('registry_redirect_host'), { code: 'registry_redirect_host' });
  }
  const $ = cheerio.load(source.bytes);
  const links = new Set();
  $(entry.selector).each((_, element) => {
    try {
      const url = validateUrl(new URL($(element).attr('href'), source.finalUrl).href);
      if (url.hostname.replace(/^www\./, '') !== host || !new RegExp(entry.path).test(url.pathname)) return;
      // Article identity excludes tracking parameters; pagination stays on the index.
      url.search = '';
      links.add(url.href);
    } catch { /* Navigation and unsafe links are not article sources. */ }
  });
  if (!links.size) throw Object.assign(new Error('registry_no_links'), { code: 'registry_no_links' });
  return [...links];
}

function registryPlan(links, previous = {}) {
  const seen = Array.isArray(previous.seen_urls) ? previous.seen_urls : [];
  const unseen = links.filter(url => !seen.includes(url));
  const fresh = unseen.slice(0, 50);
  // Re-fetch two recently listed articles to catch corrections; unchanged bodies reuse extraction.
  const overlap = links.filter(url => seen.includes(url)).slice(0, 2);
  return { urls: [...fresh, ...overlap], fresh_count: fresh.length, pending_count: unseen.length - fresh.length,
    seen_urls: [...new Set([...fresh, ...seen])].slice(0, 512) };
}

module.exports = { registry, registryLinks, registryPlan };
