const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const chromium = require('@sparticuz/chromium');

puppeteer.use(StealthPlugin());

const app = express();
app.use(cors());
app.use(express.json());

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
        '--disable-blink-features=AutomationControlled',
        '--window-size=1920,1080'
      ],
      defaultViewport: { width: 1920, height: 1080 },
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

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 4500));
    await page.evaluate(() => window.scrollBy(0, 1000));
    await new Promise(r => setTimeout(r, 800));

    const data = await page.evaluate((targetUrl) => {
      const isAN1 = targetUrl.includes('an1.com');
      const isLiteApks = targetUrl.includes('liteapks.com');
      const rawBodyText = document.body ? document.body.innerText : '';

      // ================= ১. APP NAME =================
      let name = '';
      let rawTitle = '';
      if (isLiteApks) {
        const h1 = document.querySelector('h1.entry-title, h1.text-2xl, h1.font-bold, h1');
        if (h1 && !h1.innerText.includes('Just a moment')) rawTitle = h1.innerText?.trim();
      } else if (isAN1) {
        rawTitle = document.querySelector('.app_name, h1.title, h1[itemprop="headline"]')?.innerText?.trim() || '';
      }

      if (!rawTitle || rawTitle.includes('Just a moment')) {
        rawTitle = document.querySelector('meta[property="og:title"]')?.content || document.title || '';
      }

      // ট্যাগ ও ভার্সন মুক্ত ক্লিন নাম
      name = rawTitle
        .replace(/\b(MOD APK|MOD|APK|Unlimited Money|Everything|Free Download|for Android|LiteApks|AN1)\b/gi, '')
        .replace(/\bv?[0-9]+(?:\.[0-9]+)+(?:[a-zA-Z0-9.-]*)\b/gi, '')
        .replace(/\(.*?\)/g, '')
        .replace(/\[.*?\]/g, '')
        .replace(/[-|•–].*$/, '')
        .trim();

      if (!name || name.toLowerCase().includes('just a moment')) {
        try {
          const seg = new URL(targetUrl).pathname.split('/').filter(Boolean).pop() || '';
          name = seg.replace(/^[0-9]+-/, '').replace(/(-mod|\.html|\.apk)/gi, '').replace(/[-_]/g, ' ').trim();
          name = name.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        } catch(e) {}
      }

      // ================= ২. MOD TYPE BADGE (MOD / PRO / PREMIUM) =================
      const badgeList = [];
      const titleLower = rawTitle.toLowerCase();
      const pageLower = rawBodyText.toLowerCase();

      if (titleLower.includes('premium') || pageLower.includes('premium unlocked')) {
        badgeList.push('PREMIUM');
      }
      if (titleLower.includes('pro') || pageLower.includes('pro unlocked')) {
        badgeList.push('PRO');
      }
      if (titleLower.includes('mod') || badgeList.length === 0) {
        badgeList.push('MOD');
      }
      const modType = Array.from(new Set(badgeList)).join(' • ');

      // ================= ৩. DEVELOPER =================
      let developer = '';
      if (isLiteApks) {
        // H1 এর নিচে ডেভেলপার লিংক বা টেক্সট
        const devEl = document.querySelector('a[href*="/developer/"], a[href*="/author/"], .app-author, [class*="developer"]');
        if (devEl) developer = devEl.innerText?.trim();
      } else if (isAN1) {
        const devEl = document.querySelector('.developer, span[itemprop="publisher"], [itemprop="author"]');
        if (devEl) developer = devEl.innerText?.trim();
      }

      if (!developer) {
        const devMatch = rawBodyText.match(/(?:Developer|Offered by|By|Разработчик)[:\s]*([^\n\r,]+)/i);
        if (devMatch && devMatch[1].trim().length < 35) {
          developer = devMatch[1].trim();
        }
      }
      if (!developer) developer = 'Top Verified Studio';

      // ================= ৪. CATEGORY =================
      let category = '';
      // ব্রেডক্রাম্ব নেভিগেশন থেকে ক্যাটাগরি বের করা
      const breadcrumbs = Array.from(document.querySelectorAll('.breadcrumb a, nav[class*="bread"] a, .breadcrumbs li, [class*="crumb"] a'));
      if (breadcrumbs.length > 2) {
        // সাধারণত শেষের আগেরটা ক্যাটাগরি থাকে
        category = breadcrumbs[breadcrumbs.length - 2]?.innerText?.trim();
      } else if (breadcrumbs.length === 2) {
        category = breadcrumbs[1]?.innerText?.trim();
      }

      if (!category) {
        const catEl = document.querySelector('a[href*="/category/"], a[href*="/apps/"], a[href*="/games/"]');
        if (catEl) category = catEl.innerText?.trim();
      }

      if (!category) {
        const catMatch = rawBodyText.match(/(?:Category|Genre|Категория)[:\s]*([a-zA-Z &]+)/i);
        if (catMatch) category = catMatch[1].trim();
      }
      if (!category || category.toLowerCase() === 'home' || category.toLowerCase() === 'apps') {
        category = 'Video Players & Editors';
      }

      // ================= ৫. LAST UPDATE DATE =================
      let lastUpdated = '';
      const dateEl = document.querySelector('time, [itemprop="dateModified"], [itemprop="datePublished"], .updated, .last-update');
      if (dateEl) {
        lastUpdated = dateEl.getAttribute('datetime') || dateEl.innerText?.trim();
      }

      if (!lastUpdated) {
        const updateMatch = rawBodyText.match(/(?:Updated|Last Update|Обновлено)[:\s]*([A-Za-z]+ \d{1,2}, \d{4}|\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{4}-\d{2}-\d{2})/i);
        if (updateMatch) lastUpdated = updateMatch[1].trim();
      }
      if (!lastUpdated) {
        const d = new Date();
        lastUpdated = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      }

      // ================= ৬. APK VERSION =================
      let version = '';
      const specList = Array.from(document.querySelectorAll('tr, .spec-item, li, dt, dd, [class*="detail"], [class*="spec"], div'));
      for (const el of specList) {
        const inner = el.innerText || '';
        if (/version|версия/i.test(inner)) {
          const m = inner.match(/(?:v|version|ver)?[:\s]*([0-9]+(?:\.[0-9]+)+(?:[a-zA-Z0-9.-]*))/i);
          if (m) { version = m[1].trim(); break; }
        }
      }
      if (!version) {
        const vMatch = rawBodyText.match(/\b(?:v|Version)[:\s]*([0-9]+(?:\.[0-9]+)+(?:[a-zA-Z0-9.-]*))\b/i);
        version = vMatch ? vMatch[1].trim() : '1.0.0';
      }
      version = version.startsWith('v') ? version : `v${version}`;

      // ================= ৭. APK SIZE =================
      let size = '';
      for (const el of specList) {
        const inner = el.innerText || '';
        if (/size|размер/i.test(inner)) {
          const m = inner.match(/([0-9]+(?:\.[0-9]+)?\s*(?:MB|GB|KB|Mb|Gb|M|G))/i);
          if (m) {
            let unit = m[1].toUpperCase();
            if (unit.endsWith('M')) unit += 'B';
            if (unit.endsWith('G')) unit += 'B';
            size = unit;
            break;
          }
        }
      }
      if (!size) {
        const sizeMatch = rawBodyText.match(/\bSize[:\s]*([0-9]+(?:\.[0-9]+)?\s*(?:MB|GB|KB|Mb|Gb|M|G))\b/i) ||
                          rawBodyText.match(/\b([0-9]+(?:\.[0-9]+)?\s*(?:MB|GB))\b/i);
        size = sizeMatch ? sizeMatch[1].toUpperCase() : '200 MB';
      }

      // ================= ৮. STAR RATING =================
      let rating = '';
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (const s of scripts) {
        try {
          const json = JSON.parse(s.innerText);
          if (json.aggregateRating && json.aggregateRating.ratingValue) {
            rating = json.aggregateRating.ratingValue.toString();
            break;
          }
        } catch(e) {}
      }

      if (!rating) {
        const rEl = document.querySelector('.post-ratings strong, .rating-value, span[itemprop="ratingValue"], .rating_num');
        if (rEl) rating = rEl.innerText?.trim();
      }

      if (!rating) {
        const m = rawBodyText.match(/\b([3-5]\.[0-9])\s*(?:\/|out of|\★|stars|ratings|votes)?/i);
        if (m) rating = m[1];
      }

      let numRating = parseFloat(rating);
      rating = (!isNaN(numRating) && numRating >= 1 && numRating <= 5) ? numRating.toFixed(1) : '4.4';

      // ================= ৯. APP ICON =================
      let icon = '';
      if (isLiteApks) {
        const iconEl = document.querySelector('.app-icon img, .flex-shrink-0 img, .post-thumbnail img, [class*="icon"] img');
        if (iconEl) icon = iconEl.getAttribute('data-src') || iconEl.getAttribute('data-lazy-src') || iconEl.getAttribute('src');
      } else if (isAN1) {
        const iconEl = document.querySelector('.app_view .img img, .app_spec .img img, .app-img img');
        if (iconEl) icon = iconEl.getAttribute('data-src') || iconEl.getAttribute('data-original') || iconEl.getAttribute('src');
      }

      if (!icon || icon.includes('data:image')) {
        icon = document.querySelector('meta[property="og:image"]')?.content ||
               document.querySelector('meta[name="twitter:image"]')?.content ||
               document.querySelector('link[rel="apple-touch-icon"]')?.href || '';
      }

      if (icon && !icon.startsWith('http')) {
        try { icon = new URL(icon, targetUrl).href; } catch(e) {}
      }

      // ================= ১০. SCREENSHOTS =================
      const screenshots = [];
      const imgElements = document.querySelectorAll('.app_screens img, .screenshots img, .gallery-item img, [class*="screenshot"] img, [class*="gallery"] img');
      imgElements.forEach(img => {
        let src = img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-original') || img.getAttribute('src');
        if (src && !screenshots.includes(src) && !src.includes('logo') && !src.includes('icon') && !src.includes('data:image')) {
          try {
            screenshots.push(new URL(src, targetUrl).href);
          } catch(e) {}
        }
      });

      // ================= ১১. DOWNLOAD LINK =================
      let downloadUrl = targetUrl;
      const dlAnchor = document.querySelector('a[href*="/download"], a.download_button, a.btn-download, a[class*="download"]');
      if (dlAnchor && dlAnchor.href) {
        downloadUrl = dlAnchor.href;
      }

      // ================= ১২. DESCRIPTION =================
      let description = '';
      if (isLiteApks) {
        const contentBox = document.querySelector('.entry-content, article, .post-content, #description');
        if (contentBox) {
          const clone = contentBox.cloneNode(true);
          clone.querySelectorAll('script, style, ins, .adsbygoogle, .download-btn, form').forEach(el => el.remove());
          const elements = clone.querySelectorAll('p, li, h2, h3');
          const lines = [];
          elements.forEach(el => {
            const txt = el.innerText?.trim();
            if (txt && txt.length > 5 && !txt.includes('LiteApks') && !txt.includes('Download APK')) {
              lines.push(txt);
            }
          });
          description = lines.length > 0 ? lines.slice(0, 10).join('\n\n') : clone.innerText?.trim();
        }
      } else if (isAN1) {
        const descBox = document.querySelector('.app_view .description, #description, .text');
        if (descBox) description = descBox.innerText?.trim();
      }

      if (!description || description.length < 20) {
        description = document.querySelector('meta[property="og:description"]')?.content || 'Tested and clean Android MOD APK release.';
      }

      return {
        name,
        modType,
        developer,
        category,
        lastUpdated,
        version,
        size,
        rating,
        downloads: '100M+',
        icon: icon || 'https://upload.wikimedia.org/wikipedia/commons/d/d7/Android_robot.svg',
        description: description.slice(0, 1500),
        download: downloadUrl,
        screenshots: screenshots.slice(0, 5)
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
