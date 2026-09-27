#!/usr/bin/env node
// Read-only public checks. This verifies site responses, not Google's indexing decisions.
const { parseHTML } = require('linkedom');
const base = (process.env.PUBLIC_BASE_URL || 'https://xput.app').replace(/\/$/, '');
async function request(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000), headers: {'User-Agent':'XPut-SEO-check/1.9.0'} });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return { res, body: await res.text() };
}
(async () => {
  const robots = await request(base+'/robots.txt');
  if (!robots.body.includes('Sitemap: '+base+'/sitemap.xml')) throw Error('Missing sitemap declaration');
  const {body:xml} = await request(base+'/sitemap.xml');
  const locations = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m=>m[1]);
  const urls = [];
  for (const location of locations) {
    if (/\/sitemaps\/\d+\.xml$/.test(location)) {
      const sub=await request(location);urls.push(...[...sub.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m=>m[1]));
    } else urls.push(location);
  }
  if (new Set(urls).size!==urls.length) throw Error('Duplicate sitemap URLs');
  const limit=Number(process.env.SEO_CHECK_LIMIT || 30);
  let checked=0;
  for (const url of urls.slice(0,limit)) {
    if (new URL(url).origin!==new URL(base).origin) throw Error('Foreign sitemap URL');
    const {body}=await request(url), doc=parseHTML(body).document;
    if(doc.querySelector('link[rel=canonical]')?.getAttribute('href')!==url)throw Error('Canonical mismatch: '+url);
    if(doc.querySelector('meta[name=robots]')?.getAttribute('content').includes('noindex'))throw Error('Sitemap includes noindex: '+url);
    if(doc.querySelectorAll('h1').length!==1)throw Error('Expected one primary heading: '+url);
    for(const node of doc.querySelectorAll('script[type="application/ld+json"]'))JSON.parse(node.textContent);
    checked++;
  }
  console.log(JSON.stringify({base, sitemapUrls:urls.length, checked, checks:'robots, HTTP, canonical, index, H1, JSON-LD', googleIndexVerified:false}));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
