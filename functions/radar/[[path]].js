// Cloudflare Pages Function — NOMADS NEXRAD Level-2 proxy
// Routes:
//   GET /radar/list/KXXX          → JSON array of {filename, label} for last 30 scans
//   GET /radar/file/KXXX/filename → raw bzip2 Level-2 bytes

const NOMADS = 'https://nomads.ncep.noaa.gov/pub/data/nccf/radar/nexrad_level2';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

export async function onRequest(context) {
  const url  = new URL(context.request.url);
  const path = url.pathname.replace(/^\/radar\//, '');

  if (context.request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  // ── LIST: /radar/list/KXXX ────────────────────────────────────────────
  if (path.startsWith('list/')) {
    const site = path.slice(5).toUpperCase().replace(/[^A-Z]/g, '');
    if (site.length !== 4) return new Response('Bad site', { status: 400, headers: CORS });

    const dirUrl = `${NOMADS}/${site}/`;
    const r = await fetch(dirUrl, { cf: { cacheTtl: 30 } });
    if (!r.ok) return new Response('NOMADS error ' + r.status, { status: 502, headers: CORS });

    const html = await r.text();

    // Parse all .bz2 filenames from the Apache directory listing
    // Format: KXXX_YYYYMMDD_HHMMSS.bz2
    const re = /href="(K[A-Z]{3}_\d{8}_\d{6}\.bz2)"/g;
    const files = [];
    let m;
    while ((m = re.exec(html)) !== null) {
      files.push(m[1]);
    }

    // Sort ascending, keep last 30
    files.sort();
    const recent = files.slice(-30);

    return new Response(JSON.stringify(recent), {
      headers: {
        ...CORS,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  }

  // ── FILE: /radar/file/KXXX/filename ──────────────────────────────────
  if (path.startsWith('file/')) {
    const rest = path.slice(5); // KXXX/filename
    const fileUrl = `${NOMADS}/${rest}`;

    const r = await fetch(fileUrl, { cf: { cacheTtl: 86400, cacheEverything: true } });
    if (!r.ok) return new Response('NOMADS ' + r.status, { status: r.status, headers: CORS });

    return new Response(r.body, {
      status: 200,
      headers: {
        ...CORS,
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  }

  return new Response('Not found', { status: 404, headers: CORS });
}
