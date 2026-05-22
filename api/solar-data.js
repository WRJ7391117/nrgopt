/**
 * Vercel Serverless — solar data proxy
 * Geocodes address → fetches NASA POWER irradiance data
 * Runs on Vercel's edge network (overseas), not affected by client firewall
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { address, lat, lon } = req.query || {};
  let latitude = parseFloat(lat), longitude = parseFloat(lon);

  // Step 1: geocode address if lat/lon not provided
  if ((!latitude || !longitude) && address) {
    try {
      const geoUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`;
      const geoResp = await fetch(geoUrl, { headers: { 'User-Agent': 'NrgOpt-IRR/1.0' } });
      const geoData = await geoResp.json();
      if (geoData.length > 0) {
        latitude = parseFloat(geoData[0].lat);
        longitude = parseFloat(geoData[0].lon);
      } else {
        return res.status(404).json({ ok: false, error: 'Address not found. Try coordinates like: 31.23,121.47' });
      }
    } catch (e) {
      return res.status(502).json({ ok: false, error: 'Geocoding failed: ' + e.message });
    }
  }

  if (!latitude || !longitude) {
    return res.status(400).json({ ok: false, error: 'Provide address or lat/lon' });
  }

  // Step 2: fetch NASA POWER irradiance data
  try {
    const powerUrl = `https://power.larc.nasa.gov/api/temporal/monthly/point?parameters=ALLSKY_SFC_SW_DWN&community=RE&longitude=${longitude.toFixed(4)}&latitude=${latitude.toFixed(4)}&start=2020&end=2020&format=JSON`;
    const powerResp = await fetch(powerUrl);
    const powerData = await powerResp.json();
    const vals = powerData?.properties?.parameter?.ALLSKY_SFC_SW_DWN;
    if (!vals) throw new Error('No irradiance data returned');

    let sum = 0, count = 0;
    for (const m in vals) { sum += vals[m]; count++; }
    const monthlyAvg = count > 0 ? sum / count : 0;
    const irradiance = Math.round(monthlyAvg * 365);

    if (irradiance < 500 || irradiance > 3000) throw new Error('Irradiance out of range: ' + irradiance);

    // Tilt factor based on latitude
    const al = Math.abs(latitude);
    let tilt = al < 10 ? 1.0 : al > 40 ? (1.1 + Math.min(0.15, (al - 40) / 100)) : 1.05;
    // System efficiency based on latitude
    let se = Math.round(100 - 14 - (al > 35 ? 0 : 3) - (al < 25 ? 2 : 0));

    // Fine-tune by longitude
    if (longitude > 115) irradiance -= 50;
    else if (longitude < 100) irradiance += 100;
    if (latitude < 30 && longitude > 110) irradiance -= 50;
    if (latitude > 40 && longitude < 90) irradiance += 100;

    return res.status(200).json({
      ok: true,
      lat: latitude,
      lon: longitude,
      irradiance,
      tilt: parseFloat(tilt.toFixed(2)),
      efficiency: se,
      source: 'NASA POWER + latitude lookup'
    });
  } catch (e) {
    return res.status(502).json({ ok: false, error: 'NASA POWER API failed: ' + e.message });
  }
}
