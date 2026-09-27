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
    selector: 'a[href]', path: '^/media/get_details/[0-9]+/?$' },
  { id: 'tr-energy-news', country: 'TR', name: '土耳其能源与自然资源部公告', url: 'https://enerji.gov.tr/media-news',
    selector: 'a[href]', path: '^/news-detail$', queryParam: 'id', maxNew: 1 },
  { id: 'masen-news', country: 'MA', name: '摩洛哥 MASEN 公告', url: 'https://www.masen.ma/fr/actualites-masen',
    selector: 'a[href]', path: '^/fr/actualites-masen/[^/]+/?$', maxNew: 1 },
  { id: 'sonelgaz-news', country: 'DZ', name: '阿尔及利亚 Sonelgaz 公告', url: 'https://www.sonelgaz.dz/fr/category/actualites',
    selector: 'a[href]', path: '^/fr/[0-9]+/[^/]+/?$', maxNew: 1 },
  { id: 'noc-news', country: 'LY', name: '利比亚国家石油公司 NOC 公告', url: 'https://noc.ly/en/',
    selector: '.el-item a.uk-card[href]:has(.el-meta)', path: '^/en/[^/]+/?$', maxNew: 1 }
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
      const identity = entry.queryParam ? url.searchParams.get(entry.queryParam) : null;
      if (entry.queryParam && !/^[0-9]+$/.test(identity || '')) return;
      url.search = '';
      if (entry.queryParam) url.searchParams.set(entry.queryParam, identity);
      links.add(url.href);
    } catch { /* Navigation and unsafe links are not article sources. */ }
  });
  if (!links.size) throw Object.assign(new Error('registry_no_links'), { code: 'registry_no_links' });
  return [...links];
}

function registryPlan(links, previous = {}, maxNew = 50) {
  const seen = Array.isArray(previous.seen_urls) ? previous.seen_urls : [];
  const unseen = links.filter(url => !seen.includes(url));
  const fresh = unseen.slice(0, maxNew);
  // Re-fetch two recently listed articles to catch corrections; unchanged bodies reuse extraction.
  const overlap = links.filter(url => seen.includes(url)).slice(0, maxNew === 1 ? 1 : 2);
  return { urls: [...fresh, ...overlap], fresh_count: fresh.length, pending_count: unseen.length - fresh.length,
    seen_urls: [...new Set([...fresh, ...seen])].slice(0, 512) };
}

module.exports = { registry, registryLinks, registryPlan };
