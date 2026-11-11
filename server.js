const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const chromium = require('@sparticuz/chromium');

puppeteer.use(StealthPlugin());

const app = express();

// সমস্ত ডোমেইন ও ক্লাউডফ্লেয়ার পেজেস থেকে CORS অনুমোদন
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

app.get('/ping', (req, res) => res.send('pong'));

app.post('/extract', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ success: false, error: 'URL is required' });

  let browser = null;
  try {
    browser = await puppeteer.launch({
      args: [
        ...chromium.args,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process'
      ],
      defaultViewport: { width: 1280, height: 800 },
      executablePath: await chromium.executablePath(),
      headless: chromium.headless
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

    // দ্রুত লোড ও ক্লাউডফ্লেয়ার চ্যালেঞ্জ পার হওয়া
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await new Promise(r => setTimeout(r, 2800));

    const data = await page.evaluate((targetUrl) => {
      const isLiteApks = targetUrl.includes('liteapks.com');
      const bodyText = document.body ? document.body.innerText : '';

      // ১. JSON-LD স্কিমা রিড
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

      // ২. টাইটেল
      let name = schemaData.name || '';
      if (!name) {
        const h1 = document.querySelector('h1.entry-title, h1.text-2xl, h1.font-bold, h1');
        if (h1 && !h1.innerText.includes('Just a moment')) name = h1.innerText.trim();
      }
      if (!name) name = document.querySelector('meta[property="og:title"]')?.content || '';

      name = name
        .replace(/\b(liteapks\.com|liteapks|an1\.com|an1|\.com)\b/gi, '')
        .replace(/\b(MOD APK|MOD|APK|Unlimited Money|Everything|Free Download|for Android)\b/gi, '')
        .replace(/\bv?[0-9]+(?:\.[0-9]+)+(?:[a-zA-Z0-9.-]*)\b/gi, '')
        .replace(/\(.*?\)/g, '')
        .replace(/\[.*?\]/g, '')
        .replace(/[-|•–].*$/, '')
        .trim();

      // ৩. আইকন
      let icon = '';
      if (schemaData.image) {
        icon = typeof schemaData.image === 'string' ? schemaData.image : (schemaData.image.url || '');
      }
      if (!icon) {
        const img = document.querySelector('.app-icon img, .post-thumbnail img, [class*="icon"] img');
        if (img) icon = img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('src');
      }
      if (!icon || icon.includes('data:image')) {
        icon = document.querySelector('meta[property="og:image"]')?.content || '';
      }
      if (icon && !icon.startsWith('http')) {
        try { icon = new URL(icon, targetUrl).href; } catch(e) {}
      }

      // ৪. ভার্সন ও সাইজ
      let version = schemaData.softwareVersion || '';
      let size = schemaData.fileSize || '';

      const specs = Array.from(document.querySelectorAll('tr, li, div, .spec-item'));
      for (const el of specs) {
        const txt = el.innerText?.trim() || '';
        if (!version && /\b(version)\b/i.test(txt) && txt.length < 40) {
          const vm = txt.match(/([0-9]+(?:\.[0-9]+)+(?:[a-zA-Z0-9.-]*))/);
          if (vm) version = vm[1].trim();
        }
        if (!size && /\b(size)\b/i.test(txt) && txt.length < 40) {
          const sm = txt.match(/([0-9]+(?:\.[0-9]+)?\s*(?:MB|GB|KB|Mb|Gb|M|G)\b)/i);
          if (sm) {
            let sVal = sm[1].toUpperCase();
            if (sVal.endsWith('M')) sVal += 'B';
            if (sVal.endsWith('G')) sVal += 'B';
            size = sVal;
          }
        }
      }

      if (!size) {
        const sm = bodyText.match(/\bSize[:\s]*([0-9]+(?:\.[0-9]+)?\s*(?:MB|GB|KB|Mb|Gb|M|G)\b)/i);
        size = sm ? sm[1].toUpperCase() : '85 MB';
        if (size.endsWith('M')) size += 'B';
      }

      // ৫. স্ক্রিনশট
      const screenshots = [];
      document.querySelectorAll('.app_screens img, .screenshots img, .gallery img, [class*="screenshot"] img').forEach(img => {
        let src = img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('src');
        if (src && !src.includes('data:image') && !src.includes('logo') && !src.includes('icon')) {
          try {
            const abs = new URL(src, targetUrl).href;
            if (!screenshots.includes(abs)) screenshots.push(abs);
          } catch(e) {}
        }
      });

      // ৬. ডেসক্রিপশন
      let description = '';
      const cBox = document.querySelector('.entry-content, article, .post-content, #description');
      if (cBox) {
        const clone = cBox.cloneNode(true);
        clone.querySelectorAll('script, style, ins, form').forEach(el => el.remove());
        const lines = [];
        clone.querySelectorAll('p, li').forEach(el => {
          const t = el.innerText?.trim();
          if (t && t.length > 10 && !t.includes('LiteApks')) lines.push(t);
        });
        description = lines.slice(0, 10).join('\n\n');
      }
      if (!description) description = document.querySelector('meta[property="og:description"]')?.content || 'Clean verified Android package.';

      // ৭. মোড টাইপ
      const modType = (document.title.toLowerCase().includes('premium')) ? 'PREMIUM' : (document.title.toLowerCase().includes('pro') ? 'PRO' : 'MOD');

      return {
        name: name || 'Contra Native',
        modType,
        developer: schemaData.author?.name || 'Verified Studio',
        category: schemaData.applicationCategory || 'Action Games',
        lastUpdated: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        version: version.startsWith('v') ? version : `v${version || '1.0.0'}`,
        size: size || '85 MB',
        rating: schemaData.aggregateRating?.ratingValue?.toString() || '4.8',
        icon: icon || 'https://upload.wikimedia.org/wikipedia/commons/d/d7/Android_robot.svg',
        description: description.slice(0, 1500),
        download: targetUrl,
        downloadUrl: targetUrl,
        screenshots: screenshots.slice(0, 6)
      };
    }, url);

    await browser.close();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({ success: true, data });
  } catch (err) {
    if (browser) await browser.close();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Active on port ${PORT}`));
