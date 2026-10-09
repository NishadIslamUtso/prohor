/* Static indexing checks: no CDN or JavaScript execution required. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const home = 'https://prohor-rg.vercel.app/';
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const url of [home, home + '?c=CSE221&pv=2', home + '?view=seats']) {
  const dom = new JSDOM(html, { url });
  const d = dom.window.document;
  assert.equal(d.querySelectorAll('link[rel="canonical"]').length, 1);
  assert.equal(d.querySelector('link[rel="canonical"]').href, home);
  assert.match(d.title, /BRACU Routine Planner.*Class Schedule Builder/);
  assert.match(d.querySelector('meta[name="description"]').content, /unofficial BRACU planner/);
  for (const meta of d.querySelectorAll('meta[name="robots"],meta[name="googlebot"]')) {
    assert.doesNotMatch(meta.content, /noindex|none/i);
  }
  assert.equal(d.querySelector('.planner-intro'), null, 'no SEO introduction in planner');
  assert.ok(d.querySelector('main').firstElementChild.classList.contains('columns'), 'course controls stay first');
  assert.equal(d.querySelector('#calWarn'), null, 'removed calendar banner stays absent');
  assert.doesNotMatch(html, /calMixHtml|These courses run on/);
  assert.ok(d.querySelector('footer a[href="./about.html"]'), 'About page linked in existing footer');
  assert.equal(d.querySelector('meta[property="og:url"]').content, home);
  dom.window.close();
}
const robots = fs.readFileSync(path.join(root, 'robots.txt'), 'utf8');
assert.match(robots, /^User-agent: \*$/m);
assert.match(robots, /^Allow: \/$/m);
assert.ok(robots.includes('Sitemap: ' + home + 'sitemap.xml'));
assert.doesNotMatch(robots, /^Disallow:\s*\/\s*$/m);
const sitemap = new JSDOM(fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8'), { contentType: 'text/xml' });
assert.equal(sitemap.window.document.documentElement.namespaceURI, 'http://www.sitemaps.org/schemas/sitemap/0.9');
assert.deepEqual([...sitemap.window.document.querySelectorAll('loc')].map(el => el.textContent), [home, home + 'about.html']);
sitemap.window.close();
const about = new JSDOM(fs.readFileSync(path.join(root, 'about.html'), 'utf8'), { url: home + 'about.html' });
assert.equal(about.window.document.querySelector('link[rel="canonical"]').href, home + 'about.html');
assert.equal(about.window.document.querySelectorAll('h1').length, 1);
assert.match(about.window.document.querySelector('main').textContent, /BRAC University/);
assert.match(about.window.document.querySelector('main').textContent, /unofficial/i);
assert.equal(about.window.document.querySelector('script'), null, 'About content requires no JavaScript');
assert.ok(about.window.document.querySelector('a[href="./"]'), 'return link to planner');
about.window.close();
console.log('SEO STATIC CHECKS PASSED: metadata, canonical variants, separate About page, unchanged planner entry, removed banner, robots and two-page sitemap');
