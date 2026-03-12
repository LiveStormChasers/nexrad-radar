// Cloudflare Pages Function — proxies data2.weatherwise.app
// Route: /wise/* → https://data2.weatherwise.app/composites/processed/*
// This gives our frontend CORS access to the WeatherWise MRMS .wise files

export async function onRequest(context) {
  const url = new URL(context.request.url);

  // Strip /wise/ prefix → composites/processed path
  const subpath = url.pathname.replace(/^\/wise\//, '');
  const targetUrl = `https://data2.weatherwise.app/composites/processed/${subpath}${url.search}`;

  const resp = await fetch(targetUrl, {
    method: context.request.method,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; NEXRAD-Radar/1.0)',
      'Accept': '*/*',
    },
    cf: { cacheTtl: subpath.endsWith('dir.list') ? 30 : 3600 },
  });

  const headers = new Headers(resp.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, HEAD');
  headers.delete('X-Frame-Options');

  return new Response(resp.body, {
    status: resp.status,
    headers,
  });
}
