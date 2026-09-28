const { failure } = require('./store.cjs');
const regions = require('./regions.json');
const countries = Object.fromEntries(regions.countries.map(item => [item.code, item.english]));
const primaryHosts = {
  TR: ['enerji.gov.tr'], MA: ['masen.ma'], DZ: ['sonelgaz.dz'], LY: ['noc.ly'], EG: ['eehc.gov.eg'],
  JO: ['petra.gov.jo'], PS: ['english.wafa.ps'], YE: ['sabanew.net'], SD: ['suna.sd'],
  MR: ['energies.gov.mr'], TN: ['anme.tn'], IR: ['presstv.co.uk'],
  CY: ['pilot.eac.com.cy'], LB: ['lcec.org.lb'], EH: ['ustda.gov'],
  IQ: ['totalenergies.com'], IL: ['enlightenergy.com'], SY: ['uccholding.com'],
  SA: ['gov.sa', 'spa.gov.sa', 'pif.gov.sa', 'acwapower.com', 'aramco.com', 'powersaudiarabia.com.sa', 'saudiexchange.sa'],
  AE: ['gov.ae', 'wam.ae', 'mediaoffice.abudhabi', 'ewec.ae', 'masdar.ae'],
  QA: ['gov.qa', 'qna.org.qa', 'qatarenergy.qa'],
  KW: ['gov.kw', 'kuna.net.kw', 'kapp.gov.kw', 'acwapower.com'],
  OM: ['gov.om', 'omannews.gov.om', 'omanpwp.om'],
  BH: ['gov.bh', 'bna.bh', 'ewa.bh']
};
function discoveryQuery(country, attempt = 1, direction = null, channel = null) {
  if (!primaryHosts[country]?.length) throw failure('discovery_country_not_enabled', 503);
  const place = country === 'EH' ? '("Western Sahara" OR Laayoune OR "El Aaiun")' : countries[country];
  // Fixed publishers remain monitored separately; search discovers sources beyond that list.
  const terms = direction ? require('./directions.cjs').queryTerms(direction)
    : '(regulation OR security OR industry OR hospital OR water OR transport OR data center OR infrastructure OR heatwave OR flood OR storm OR drought OR outage OR fuel OR electricity OR grid OR renewable OR storage OR project)';
  const url = channel ? new URL(channel.url) : null;
  const scope = url ? ` site:${url.hostname}${channel.scope === 'path' ? url.pathname : ''}` : '';
  return `${place} ${terms}${scope}`;
}
function discoverySources(results) {
  const unique = new Map();
  for (const item of Array.isArray(results) ? results : []) {
    try {
      const url = require('./source.cjs').validateUrl(item.url).href;
      // Search metadata cannot establish publisher identity, independence or truth.
      if (!unique.has(url)) unique.set(url, { ...item, url, source_level: 'unverified' });
    } catch { /* Unsafe links are not collection candidates. DNS is checked when fetching. */ }
  }
  return [...unique.values()].slice(0, 12);
}

async function discoverCountry(country, profile, discoveryFactory, attempt = 1, direction = null, channel = null) {
  const discovery = await discoveryFactory(profile)({ query: discoveryQuery(country, attempt, direction, channel) });
  const sources = discoverySources(discovery.results);
  return { ...discovery, results: undefined, sources };
}

module.exports = { countries, primaryHosts, discoveryQuery, discoverCountry, discoverySources };
