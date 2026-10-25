import { pathToFileURL } from 'node:url';

export function pagesTarget(pages) {
  const site = new URL(pages.cname ? `https://${pages.cname}/` : pages.html_url);
  if (site.username || site.password || site.search || site.hash || site.port ||
      (pages.cname && (site.hostname !== pages.cname.toLowerCase() || site.pathname !== '/')) ||
      (!pages.cname && !site.hostname.endsWith('.github.io'))) throw new Error('Invalid GitHub Pages target.');
  site.protocol = 'https:';
  if (!site.pathname.endsWith('/')) site.pathname += '/';
  return { site: site.href, base: site.pathname };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const { site, base } = pagesTarget(JSON.parse(input));
  console.log(`SITE_URL=${site}\nVITE_BASE=${base}`);
}
