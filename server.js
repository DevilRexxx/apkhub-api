const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const chromium = require('@sparticuz/chromium');

puppeteer.use(StealthPlugin());

const app = express();
app.use(cors());
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
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--single-process'
      ],
      defaultViewport: { width: 1280, height: 800 },
      executablePath: await chromium.executablePath(),
      headless: chromium.headless
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({
      'accept-language': 'en-US,en;q=0.9',
      'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"'
    });

    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    // ফাস্ট লোডিং
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    
    // পেজ রেন্ডার ও চ্যালেঞ্জ পার হওয়ার জন্য ব্যালেন্সড ৩ সেকেন্ড
    await new Promise(r => setTimeout(r, 3000));

    const data = await page.evaluate((targetUrl) => {
      const isAN1 = targetUrl.includes('an1.com');
      const isLiteApks = targetUrl.includes('liteapks.com');
      const bodyText = document.body ? document.body.innerText : '';

      // ================= ১. JSON-LD SCHEMA থেকে নিখুঁত ডেটা সংগ্রহ =================
      let schemaData = {};
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (const s of scripts) {
        try {
          const parsed = JSON.parse(s.innerText);
          if (parsed['@type'] === 'SoftwareApplication' || parsed.applicationCategory) {
            schemaData = parsed;
            break;
          }
          if (Array.isArray(parsed)) {
            const found = parsed.find(item => item['@type'] === 'SoftwareApplication' || item.applicationCategory);
            if (found) { schemaData = found; break; }
          }
        } catch(e) {}
      }

      // ================= ২. APP NAME =================
      let name = schemaData.name || '';
      if (!name) {
        if (isLiteApks) {
          const h1 = document.querySelector('h1.entry-title, h1.text-2xl, h1.font-bold, h1');
          if (h1 && !h1.innerText.includes('Just a moment')) name = h1.innerText?.trim();
        } else if (isAN1) {
          name = document.querySelector('.app_name, h1.title, h1[itemprop="headline"]')?.innerText?.trim();
        }
      }

      if (!name || name.includes('Just a moment')) {
        name = document.querySelector('meta[property="og:title"]')?.content || document.title || '';
      }

      // ক্লিন নাম
      name = name
        .replace(/\b(liteapks\.com|liteapks|an1\.com|an1|\.com)\b/gi, '')
        .replace(/\b(MOD APK|MOD|APK|Unlimited Money|Everything|Free Download|for Android)\b/gi, '')
        .replace(/\bv?[0-9]+(?:\.[0-9]+)+(?:[a-zA-Z0-9.-]*)\b/gi, '')
        .replace(/\(.*?\)/g, '')
        .replace(/\[.*?\]/g, '')
        .replace(/[-|•–].*$/, '')
        .trim();

      if (!name || name.length < 2 || name.toLowerCase().includes('just a moment')) {
        try {
          const seg = new URL(targetUrl).pathname.split('/').filter(Boolean).pop() || '';
          name = seg.replace(/^[0-9]+-/, '').replace(/(-mod|\.html|\.apk)/gi, '').replace(/[-_]/g, ' ').trim();
          name = name.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        } catch(e) {}
      }

      // ================= ৩. MOD TYPE BADGE =================
      const badgeList = [];
      const titleLower = (document.title || '').toLowerCase();
      const pageLower = bodyText.toLowerCase();

      if (titleLower.includes('premium') || pageLower.includes('premium unlocked')) badgeList.push('PREMIUM');
      if (titleLower.includes('pro') || pageLower.includes('pro unlocked')) badgeList.push('PRO');
      if (titleLower.includes('mod') || badgeList.length === 0) badgeList.push('MOD');
      const modType = Array.from(new Set(badgeList)).join(' • ');

      // ================= ৪. APP ICON =================
      let icon = '';
      if (schemaData.image) {
        icon = typeof schemaData.image === 'string' ? schemaData.image : (schemaData.image.url || '');
      }

      if (!icon) {
        const iconEl = document.querySelector('.app-icon img, .flex-shrink-0 img, .post-thumbnail img, [class*="icon"] img, .app_view .img img');
        if (iconEl) icon = iconEl.getAttribute('data-src') || iconEl.getAttribute('data-lazy-src') || iconEl.getAttribute('src');
      }

      if (!icon || icon.includes('data:image')) {
        icon = document.querySelector('meta[property="og:image"]')?.content ||
               document.querySelector('meta[name="twitter:image"]')?.content ||
               document.querySelector('link[rel="apple-touch-icon"]')?.href || '';
      }

      if (icon && !icon.startsWith('http')) {
        try { icon = new URL(icon, targetUrl).href; } catch(e) {}
      }

      // ================= ৫. VERSION & SIZE =================
      let version = schemaData.softwareVersion || '';
      let size = schemaData.fileSize || '';

      // DOM থেকে Version ও Size
      const allTextBlocks = Array.from(document.querySelectorAll('tr, li, div, .spec-item'));
      for (const el of allTextBlocks) {
        const txt = el.innerText?.trim() || '';
        
        // Version
        if (!version && /\b(version|версия)\b/i.test(txt) && txt.length < 40) {
          const vm = txt.match(/([0-9]+(?:\.[0-9]+)+(?:[a-zA-Z0-9.-]*))/);
          if (vm) version = vm[1].trim();
        }

        // Size
        if (!size && /\b(size|размер)\b/i.test(txt) && txt.length < 40) {
          const sm = txt.match(/([0-9]+(?:\.[0-9]+)?\s*(?:MB|GB|KB|Mb|Gb|M|G)\b)/i);
          if (sm) {
            let sVal = sm[1].toUpperCase();
            if (sVal.endsWith('M')) sVal += 'B';
            if (sVal.endsWith('G')) sVal += 'B';
            size = sVal;
          }
        }
      }

      if (!version) {
        const vMatch = bodyText.match(/\b(?:v|Version)[:\s]*([0-9]+(?:\.[0-9]+)+(?:[a-zA-Z0-9.-]*))\b/i);
        version = vMatch ? vMatch[1].trim() : '1.0.0';
      }
      version = version.startsWith('v') ? version : `v${version}`;

      if (!size) {
        const sm = bodyText.match(/\bSize[:\s]*([0-9]+(?:\.[0-9]+)?\s*(?:MB|GB|KB|Mb|Gb|M|G)\b)/i) ||
                   bodyText.match(/([0-9]+(?:\.[0-9]+)?\s*(?:MB|GB))\b/i);
        if (sm) {
          let sVal = sm[1].toUpperCase();
          if (sVal.endsWith('M')) sVal += 'B';
          if (sVal.endsWith('G')) sVal += 'B';
          size = sVal;
        } else {
          size = '95 MB';
        }
      }

      // ================= ৬. DEVELOPER & CATEGORY =================
      let developer = '';
      if (schemaData.author && schemaData.author.name) {
        developer = schemaData.author.name;
      }
      if (!developer) {
        const devEl = document.querySelector('a[href*="/developer/"], a[href*="/author/"], .app-author, .developer, [itemprop="publisher"]');
        if (devEl) developer = devEl.innerText?.trim();
      }
      if (!developer) {
        const devM = bodyText.match(/(?:Developer|Offered by)[:\s]*([A-Za-z0-9\s.,&'-]+)/i);
        if (devM && devM[1].trim().length < 35) developer = devM[1].trim();
      }
      if (!developer) developer = 'Verified Studio';

      let category = schemaData.applicationCategory || '';
      if (!category) {
        const crumbs = Array.from(document.querySelectorAll('.breadcrumb a, nav[class*="bread"] a, .breadcrumbs a'));
        if (crumbs.length >= 2) category = crumbs[crumbs.length - 2]?.innerText?.trim();
      }
      if (!category || ['home', 'apps', 'games'].includes(category.toLowerCase())) {
        const catM = bodyText.match(/(?:Category|Genre)[:\s]*([A-Za-z &]+)/i);
        if (catM) category = catM[1].trim();
      }
      if (!category) category = 'Action Games';

      // ================= ৭. STAR RATING =================
      let rating = '';
      if (schemaData.aggregateRating && schemaData.aggregateRating.ratingValue) {
        rating = schemaData.aggregateRating.ratingValue.toString();
      }
      if (!rating) {
        const rEl = document.querySelector('.post-ratings strong, .rating-value, span[itemprop="ratingValue"], .rating_num');
        if (rEl) rating = rEl.innerText?.trim();
      }
      if (!rating) {
        const m = bodyText.match(/\b([3-5]\.[0-9])\s*(?:\/|out of|\★|stars)?/i);
        if (m) rating = m[1];
      }
      let numRating = parseFloat(rating);
      rating = (!isNaN(numRating) && numRating >= 1 && numRating <= 5) ? numRating.toFixed(1) : '4.8';

      // ================= ৮. SCREENSHOTS =================
      const screenshots = [];
      const imgElements = document.querySelectorAll('.app_screens img, .screenshots img, .gallery img, [class*="screenshot"] img, [class*="screen"] img');
      imgElements.forEach(img => {
        let src = img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('src');
        if (src && !src.includes('data:image') && !src.includes('logo') && !src.includes('icon')) {
          try {
            const abs = new URL(src, targetUrl).href;
            if (!screenshots.includes(abs)) screenshots.push(abs);
          } catch(e) {}
        }
      });

      // ================= ৯. DESCRIPTION =================
      let description = '';
      const contentBox = document.querySelector('.entry-content, article, .post-content, #description, .app_view .description');
      if (contentBox) {
        const clone = contentBox.cloneNode(true);
        clone.querySelectorAll('script, style, ins, .adsbygoogle, .download-btn, form').forEach(el => el.remove());
        const lines = [];
        clone.querySelectorAll('p, li, h2, h3').forEach(el => {
          const txt = el.innerText?.trim();
          if (txt && txt.length > 8 && !txt.includes('LiteApks') && !txt.includes('Download APK')) {
            lines.push(txt);
          }
        });
        description = lines.length > 0 ? lines.slice(0, 10).join('\n\n') : clone.innerText?.trim();
      }

      if (!description || description.length < 20) {
        description = document.querySelector('meta[property="og:description"]')?.content ||
                      document.querySelector('meta[name="description"]')?.content ||
                      'Enjoy clean verified Android gameplay with unlocked exclusive features and full package installation.';
      }

      // ================= ১০. DOWNLOAD LINK =================
      let downloadUrl = targetUrl;
      const dlAnchor = document.querySelector('a[href*="/download"], a.download_button, a.btn-download');
      if (dlAnchor && dlAnchor.href) downloadUrl = dlAnchor.href;

      return {
        name,
        modType,
        developer,
        category,
        lastUpdated: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        version,
        size,
        rating,
        downloads: '100K+',
        icon: icon || 'https://upload.wikimedia.org/wikipedia/commons/d/d7/Android_robot.svg',
        description: description.replace(/[ \t]+/g, ' ').slice(0, 1500),
        download: downloadUrl,
        downloadUrl,
        screenshots: screenshots.slice(0, 6)
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
app.listen(PORT, () => console.log(`Scraper active on port ${PORT}`));
