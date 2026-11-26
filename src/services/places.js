// Free public services. Both are replaced by fakes in tests.
const TIMEOUT = 8000;

async function getJson(url, headers) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return res.json();
}

function createPlaces() {
  return {
    // Open-Meteo: free for non-commercial use.
    async weather(query) {
      const found = await getJson(
        `https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(query)}`,
      );
      const place = found.results?.[0];
      if (!place) return null;
      const data = await getJson(
        `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
          "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=7&timezone=auto",
      );
      const d = data.daily;
      return {
        place: [place.name, place.admin1, place.country].filter(Boolean).join(", "),
        days: d.time.map((date, i) => ({
          date,
          code: d.weather_code[i],
          max: d.temperature_2m_max[i],
          min: d.temperature_2m_min[i],
          rain: d.precipitation_probability_max[i],
        })),
      };
    },

    // ExchangeRate-API open endpoint: free, updated daily, needs attribution.
    async rates(base) {
      const data = await getJson(`https://open.er-api.com/v6/latest/${base}`);
      if (data.result !== "success") return null;
      return { base, updated: data.time_last_update_utc, rates: data.rates };
    },

    // OpenStreetMap Nominatim: one lookup per user action, with an identifying User-Agent.
    async locate(query) {
      const results = await getJson(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`,
        { "User-Agent": "LocoMan-travel-app/2.0" },
      );
      const hit = results[0];
      return hit ? { lat: Number(hit.lat), lng: Number(hit.lon), label: hit.display_name } : null;
    },
  };
}

module.exports = { createPlaces };
