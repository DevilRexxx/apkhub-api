const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');

const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json());

app.get('/ping', (req, res) => res.send('pong'));

app.post('/extract', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ success: false, error: 'URL is required' });

  let browser = null;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1280,800'
      ]
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2500)); // পেজ রেন্ডার হওয়ার সময় দেওয়া

    const data = await page.evaluate((targetUrl) => {
      // ১. JSON-LD Schema
      let schemaData = {};
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (const s of scripts) {
        try {
          const parsed = JSON.parse(s.innerText);
          if (parsed['@type'] === 'SoftwareApplication' || parsed.applicationCategory) {
            schemaData = parsed;
            break;
          }
        } catch(e) {}
      }

      // ২. Name
      let name = schemaData.name || '';
      if (!name) {
        const h1 = document.querySelector('h1.entry-title, h1');
        if (h1) name = h1.innerText.trim();
      }
      name = name
        .replace(/\b(liteapks\.com|liteapks|an1\.com|an1|\.com)\b/gi, '')
        .replace(/\b(MOD APK|MOD|APK|Unlimited Money|Everything|Free Download|for Android)\b/gi, '')
        .replace(/\bv?[0-9]+(?:\.[0-9]+)+(?:[a-zA-Z0-9.-]*)\b/gi, '')
        .replace(/\(.*?\)/g, '')
        .replace(/\[.*?\]/g, '')
        .replace(/[-|•–].*$/, '')
        .trim();

      if (!name) {
        const seg = new URL(targetUrl).pathname.split('/').filter(Boolean).pop() || 'App';
        name = seg.replace(/^[0-9]+-/, '').replace(/(-mod|\.html|\.apk)/gi, '').replace(/[-_]/g, ' ');
        name = name.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      }

      // ৩. Icon
      let icon = '';
      if (schemaData.image) {
        icon = typeof schemaData.image === 'string' ? schemaData.image : (schemaData.image.url || '');
      }
      if (!icon) {
        const img = document.querySelector('.app-icon img, .post-thumbnail img, [class*="icon"] img');
        if (img) icon = img.getAttribute('data-src') || img.getAttribute('src');
      }
      if (!icon || icon.includes('data:image')) {
        icon = document.querySelector('meta[property="og:image"]')?.content || '';
      }
      if (icon && !icon.startsWith('http')) {
        try { icon = new URL(icon, targetUrl).href; } catch(e) {}
      }

      // ৪. Version & Size
      let version = schemaData.softwareVersion || '';
      let size = schemaData.fileSize || '';

      const bodyText = document.body ? document.body.innerText : '';
      const vMatch = bodyText.match(/\b(?:v|Version)[:\s]*([0-9]+(?:\.[0-9]+)+(?:[a-zA-Z0-9.-]*))\b/i);
      if (!version && vMatch) version = vMatch[1];
      version = version ? (version.startsWith('v') ? version : `v${version}`) : 'v1.0.0';

      const sMatch = bodyText.match(/\bSize[:\s]*([0-9]+(?:\.[0-9]+)?\s*(?:MB|GB|KB|Mb|Gb|M|G)\b)/i);
      if (!size && sMatch) {
        size = sMatch[1].toUpperCase();
        if (size.endsWith('M')) size += 'B';
        if (size.endsWith('G')) size += 'B';
      }
      size = size || '95 MB';

      // ৫. Developer
      let developer = schemaData.author?.name || '';
      if (!developer) {
        const devEl = document.querySelector('.developer, .app-author, [class*="developer"]');
        if (devEl) developer = devEl.innerText.trim();
      }
      developer = developer && developer.length < 30 ? developer : 'Verified Studio';

      // ৬. Category
      let category = schemaData.applicationCategory || 'Action Games';

      // ৭. Screenshots
      const screenshots = [];
      document.querySelectorAll('img').forEach(img => {
        let src = img.getAttribute('data-src') || img.getAttribute('src');
        const cls = img.className || '';
        const parentCls = img.parentElement?.className || '';
        if (
          src && 
          !src.includes('data:image') && 
          !src.includes('logo') && 
          !src.includes('icon') &&
          (cls.includes('screen') || cls.includes('gallery') || parentCls.includes('screen') || parentCls.includes('gallery') || src.includes('/uploads/posts/'))
        ) {
          try {
            const abs = new URL(src, targetUrl).href;
            if (!screenshots.includes(abs) && screenshots.length < 6) screenshots.push(abs);
          } catch(e) {}
        }
      });

      // ৮. Description
      let description = '';
      const descBox = document.querySelector('.entry-content, article, .post-content');
      if (descBox) {
        const lines = [];
        descBox.querySelectorAll('p, li').forEach(el => {
          const t = el.innerText?.trim();
          if (t && t.length > 15 && !t.includes('LiteApks')) lines.push(t);
        });
        description = lines.slice(0, 10).join('\n\n');
      }
      if (!description) description = document.querySelector('meta[property="og:description"]')?.content || 'Tested and clean Android MOD APK release.';

      // ৯. Download Link
      let downloadUrl = targetUrl;
      const dlBtn = document.querySelector('a[href*="/download/"], a.download_button');
      if (dlBtn && dlBtn.href) downloadUrl = dlBtn.href;

      return {
        name,
        modType: document.title.toLowerCase().includes('pro') ? 'PRO' : 'MOD',
        developer,
        category,
        lastUpdated: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        version,
        size,
        rating: schemaData.aggregateRating?.ratingValue?.toString() || '4.8',
        icon: icon || 'https://upload.wikimedia.org/wikipedia/commons/d/d7/Android_robot.svg',
        description: description.slice(0, 1500),
        download: downloadUrl,
        downloadUrl,
        screenshots
      };
    }, url);

    await browser.close();
    res.json({ success: true, data });

  } catch (err) {
    if (browser) await browser.close();
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Puppeteer Extractor active on port ${PORT}`));
