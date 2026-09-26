const { failure } = require('./store.cjs');
const countries = { SA: 'Saudi Arabia', AE: 'United Arab Emirates', QA: 'Qatar', KW: 'Kuwait', OM: 'Oman', BH: 'Bahrain' };
const primaryHosts = {
  SA: ['gov.sa', 'spa.gov.sa', 'pif.gov.sa', 'acwapower.com', 'aramco.com', 'powersaudiarabia.com.sa', 'saudiexchange.sa'],
  AE: ['gov.ae', 'wam.ae', 'mediaoffice.abudhabi', 'ewec.ae', 'masdar.ae'],
  QA: ['gov.qa', 'qna.org.qa', 'qatarenergy.qa'],
  KW: ['gov.kw', 'kuna.net.kw', 'kapp.gov.kw', 'acwapower.com'],
  OM: ['gov.om', 'omannews.gov.om', 'omanpwp.om'],
  BH: ['gov.bh', 'bna.bh', 'ewa.bh']
};
function primarySource(url, country) {
  const host = new URL(url).hostname.toLowerCase();
  return primaryHosts[country].some(value => host === value || host.endsWith(`.${value}`));
}
function discoveryQuery(country, attempt = 1) {
  // A retry narrows the first-party hosts while keeping regional change signals discoverable.
  const retryHosts = {
    SA: ['spa.gov.sa', 'acwapower.com'], AE: ['wam.ae', 'masdar.ae'],
    QA: ['qna.org.qa', 'qatarenergy.qa'], KW: ['acwapower.com', 'kapp.gov.kw'],
    OM: ['omanpwp.om', 'gov.om'], BH: ['ewa.bh', 'gov.bh']
  };
  if (attempt > 1) return `${countries[country]} (regulation OR security OR industry OR public services OR infrastructure OR climate OR disaster OR outage OR energy OR project) site:${retryHosts[country][Math.min(attempt - 2, 1)]}`;
  return `${countries[country]} (regulation OR security OR industry OR hospital OR water OR transport OR data center OR infrastructure OR heatwave OR flood OR storm OR drought OR outage OR fuel OR electricity OR grid OR renewable OR storage OR project) (${primaryHosts[country].map(host => `site:${host}`).join(' OR ')})`;
}
async function discoverCountry(country, profile, discoveryFactory, attempt = 1) {
  const discovery = await discoveryFactory(profile)({ query: discoveryQuery(country, attempt) });
  const sources = discovery.results.filter(item => primarySource(item.url, country)).map(item => ({ ...item, source_level: 'primary' }));
  if (!sources.length) throw failure('discovery_no_primary_sources', 502);
  return { ...discovery, results: undefined, sources };
}

module.exports = { countries, primaryHosts, primarySource, discoveryQuery, discoverCountry };
