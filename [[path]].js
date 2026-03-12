// Cloudflare Pages Function — NOAA S3 NEXRAD Level-2 proxy with CORS
// Routes:
//   GET /radar/list/KXXX   → JSON array of S3 keys (last 30 scans)
//   GET /radar/file/KEY    → raw Level-2 bytes (KEY = full S3 path)

const S3_BASE = 'https://noaa-nexrad-level2.s3.amazonaws.com';
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

    const keys = [];
    const now  = new Date();

    // Check today and yesterday (handles files near midnight)
    for (let d = 0; d <= 1; d++) {
      const t    = new Date(now.getTime() - d * 86400000);
      const yyyy = t.getUTCFullYear();
      const mm   = String(t.getUTCMonth() + 1).padStart(2, '0');
      const dd   = String(t.getUTCDate()).padStart(2, '0');
      const prefix = `${yyyy}/${mm}/${dd}/${site}/`;
      const listUrl = `${S3_BASE}?prefix=${prefix}&max-keys=200`;

      const r = await fetch(listUrl, { cf: { cacheTtl: 30, cacheEverything: false } });
      const xml = await r.text();

      for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) {
        const key = m[1];
        if (!key.endsWith('_MDM')) keys.push(key); // skip metadata files
      }
    }

    // Sort ascending (oldest first), keep last 30
    keys.sort();
    const recent = keys.slice(-30);

    return new Response(JSON.stringify(recent), {
      headers: {
        ...CORS,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  }

  // ── FILE: /radar/file/YYYY/MM/DD/KXXX/filename ────────────────────────
  if (path.startsWith('file/')) {
    const s3key = path.slice(5);
    const s3url = `${S3_BASE}/${s3key}`;

    const r = await fetch(s3url, { cf: { cacheTtl: 86400, cacheEverything: true } });
    if (!r.ok) return new Response(`S3 ${r.status}`, { status: r.status, headers: CORS });

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
