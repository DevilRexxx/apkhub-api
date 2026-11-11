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

    // ক্লাউডফ্লেয়ার চ্যালেঞ্জ ও পেজ লোডের জন্য পূর্ণ লোডিং
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35000 });
    
    // ক্লাউডফ্লেয়ার পার হতে ৩.৫ সেকেন্ড অপেক্ষা
    await new Promise(r => setTimeout(r, 3500));

    // লেজি-লোডিং ইমেজ ও স্ক্রিনশট ট্রিগার করতে স্ক্রোল ডাউন
    await page.evaluate(() => window.scrollBy(0, 1200));
    await new Promise(r => setTimeout(r, 1000));

    const data = await page.evaluate((targetUrl) => {
      const isAN1 = targetUrl.includes('an1.com');
      const isLiteApks = targetUrl.includes('liteapks.com');
      const rawBodyText = document.body ? document.body.innerText : '';

      // ================= ১. APP NAME & MOD BADGE =================
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

      // MOD / PRO / PREMIUM ব্যাজ
      const badgeList = [];
      const titleLower = rawTitle.toLowerCase();
      const pageLower = rawBodyText.toLowerCase();

      if (titleLower.includes('premium') || pageLower.includes('premium unlocked')) badgeList.push('PREMIUM');
      if (titleLower.includes('pro') || pageLower.includes('pro unlocked')) badgeList.push('PRO');
      if (titleLower.includes('mod') || badgeList.length === 0) badgeList.push('MOD');
      const modType = Array.from(new Set(badgeList)).join(' • ');

      // ক্লিন নাম
      name = rawTitle
        .replace(/\b(liteapks\.com|liteapks|an1\.com|an1|\.com)\b/gi, '')
        .replace(/\b(MOD APK|MOD|APK|Unlimited Money|Everything|Free Download|for Android)\b/gi, '')
        .replace(/\bv?[0-9]+(?:\.[0-9]+)+(?:[a-zA-Z0-9.-]*)\b/gi, '')
        .replace(/\(.*?\)/g, '')
        .replace(/\[.*?\]/g, '')
        .replace(/[-|•–].*$/, '')
        .trim();

      if (!name || name === '.com' || name.length < 2 || name.toLowerCase().includes('just a moment')) {
        try {
          const seg = new URL(targetUrl).pathname.split('/').filter(Boolean).pop() || '';
          name = seg.replace(/^[0-9]+-/, '').replace(/(-mod|\.html|\.apk)/gi, '').replace(/[-_]/g, ' ').trim();
          name = name.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        } catch(e) {}
      }

      // ================= ২. APP ICON (গ্যারান্টিড ইমেজ পার্সিং) =================
      let icon = '';

      // ক. সরাসরি LiteApks ও AN1 নির্দিষ্ট আইকন কনটেইনার
      const iconSelectors = [
        '.app-icon img',
        '.post-thumbnail img',
        '.flex-shrink-0 img',
        '[class*="icon"] img',
        '.app_view .img img',
        '.app_spec .img img'
      ];

      for (const sel of iconSelectors) {
        const el = document.querySelector(sel);
        if (el) {
          const src = el.getAttribute('data-src') || el.getAttribute('data-lazy-src') || el.getAttribute('data-original') || el.getAttribute('src');
          if (src && !src.includes('data:image') && !src.includes('default') && src.length > 10) {
            icon = src;
            break;
          }
        }
      }

      // খ. মেটা ট্যাগ ব্যাকআপ (og:image সবসময় হাই-রেজোলিউশন আসল আইকন দেয়)
      if (!icon || icon.includes('data:image')) {
        icon = document.querySelector('meta[property="og:image"]')?.content ||
               document.querySelector('meta[name="twitter:image"]')?.content ||
               document.querySelector('link[rel="apple-touch-icon"]')?.href || '';
      }

      if (icon && !icon.startsWith('http')) {
        try { icon = new URL(icon, targetUrl).href; } catch(e) {}
      }

      // ================= ৩. PREVIEW SCREENSHOTS =================
      const screenshots = [];
      const imgElements = document.querySelectorAll('.app_screens img, .screenshots img, .gallery img, [class*="screenshot"] img, [class*="screen"] img, [class*="gallery"] img, .swiper-slide img');

      imgElements.forEach(img => {
        let src = img.getAttribute('data-src') || 
                  img.getAttribute('data-lazy-src') || 
                  img.getAttribute('data-original') || 
                  img.getAttribute('srcset')?.split(' ')[0] || 
                  img.getAttribute('src');

        if (src && !src.includes('data:image') && !src.includes('logo') && !src.includes('icon') && !screenshots.includes(src)) {
          try {
            const absoluteUrl = new URL(src, targetUrl).href;
            if (!screenshots.includes(absoluteUrl)) {
              screenshots.push(absoluteUrl);
            }
          } catch(e) {}
        }
      });

      // ================= ৪. DESCRIPTION & MOD FEATURES =================
      let description = '';

      // ক. আর্টিকেলের মূল প্যারাগ্রাফগুলো
      const contentBox = document.querySelector('.entry-content, article, .post-content, #description, .app_view .description, .text');
      if (contentBox) {
        const clone = contentBox.cloneNode(true);
        // অপ্রয়োজনীয় এলিমেন্ট বাদ দেওয়া
        clone.querySelectorAll('script, style, ins, .adsbygoogle, .download-btn, form, iframe').forEach(el => el.remove());
        
        const lines = [];
        const elements = clone.querySelectorAll('p, li, h2, h3');
        elements.forEach(el => {
          const txt = el.innerText?.trim();
          if (txt && txt.length > 5 && !txt.includes('LiteApks') && !txt.includes('Download APK') && !txt.includes('Leave a Reply')) {
            lines.push(txt);
          }
        });

        if (lines.length > 0) {
          description = lines.slice(0, 12).join('\n\n');
        } else {
          description = clone.innerText?.trim();
        }
      }

      // খ. ব্যাকআপ মেটা ডেসক্রিপশন
      if (!description || description.length < 30) {
        description = document.querySelector('meta[property="og:description"]')?.content ||
                      document.querySelector('meta[name="description"]')?.content || '';
      }

      description = description.replace(/[ \t]+/g, ' ').slice(0, 2000);

      // ================= ৫. DEVELOPER =================
      let developer = '';
      const devAnchor = document.querySelector('a[href*="/developer/"], a[href*="/author/"], a[href*="/dev/"], .app-author');
      if (devAnchor && devAnchor.innerText?.trim()) {
        developer = devAnchor.innerText.trim();
      } else {
        const devEl = document.querySelector('.developer, [itemprop="author"], [itemprop="publisher"], .app_spec .dev');
        if (devEl) developer = devEl.innerText?.trim();
      }

      if (!developer) {
        const devM = rawBodyText.match(/(?:Developer|Offered by|Разработчик)[:\s]*([A-Za-z0-9\s.,&'-]+)/i);
        if (devM && devM[1].trim().length < 40) developer = devM[1].trim();
      }
      if (!developer) developer = 'Jafa Studios';

      // ================= ৬. CATEGORY =================
      let category = '';
      const crumbs = Array.from(document.querySelectorAll('.breadcrumb a, nav[class*="bread"] a, .breadcrumbs li a, .breadcrumbs a, [class*="crumb"] a'));
      if (crumbs.length >= 3) {
        category = crumbs[crumbs.length - 2]?.innerText?.trim();
      } else if (crumbs.length === 2) {
        category = crumbs[1]?.innerText?.trim();
      }

      if (!category || ['home', 'apps', 'games'].includes(category.toLowerCase())) {
        const catM = rawBodyText.match(/(?:Category|Genre|Категория)[:\s]*([A-Za-z &]+)/i);
        if (catM) category = catM[1].trim();
      }
      if (!category) category = 'Strategy';

      // ================= ৭. VERSION & SIZE =================
      let version = '';
      let size = '';

      const allDivs = Array.from(document.querySelectorAll('div, li, tr'));
      for (const el of allDivs) {
        const text = el.innerText?.trim() || '';
        
        if (!version && /\bversion\b/i.test(text) && text.length < 50) {
          const vm = text.match(/([0-9]+(?:\.[0-9]+)*(?:[a-zA-Z0-9.-]*))/);
          if (vm) version = vm[1].trim();
        }

        if (!size && /\bsize\b/i.test(text) && text.length < 50) {
          const sm = text.match(/([0-9]+(?:\.[0-9]+)?\s*(?:MB|GB|KB|Mb|Gb|M|G)\b)/i);
          if (sm) {
            let sVal = sm[1].toUpperCase();
            if (sVal.endsWith('M')) sVal += 'B';
            if (sVal.endsWith('G')) sVal += 'B';
            size = sVal;
          }
        }
      }

      if (!version) {
        const vMatch = rawBodyText.match(/\b(?:v|Version)[:\s]*([0-9]+(?:\.[0-9]+)*(?:[a-zA-Z0-9.-]*))\b/i);
        version = vMatch ? vMatch[1].trim() : '3';
      }
      version = version.startsWith('v') ? version : `v${version}`;

      if (!size) {
        const sm = rawBodyText.match(/\bSize[:\s]*([0-9]+(?:\.[0-9]+)?\s*(?:MB|GB|KB|Mb|Gb|M|G)\b)/i) ||
                   rawBodyText.match(/([0-9]+(?:\.[0-9]+)?\s*(?:MB|GB))\b/i);
        if (sm) {
          let sVal = sm[1].toUpperCase();
          if (sVal.endsWith('M')) sVal += 'B';
          if (sVal.endsWith('G')) sVal += 'B';
          size = sVal;
        } else {
          size = '00 MB';
        }
      }

      // ================= ৮. LAST UPDATE & RATING =================
      let lastUpdated = '';
      const dateEl = document.querySelector('time, [itemprop="dateModified"], [itemprop="datePublished"], .updated, .last-update, [class*="date"]');
      if (dateEl) lastUpdated = dateEl.getAttribute('datetime') || dateEl.innerText?.trim();

      if (!lastUpdated) {
        const updateMatch = rawBodyText.match(/(?:Updated|Last Update|Update date|Обновлено)[:\s]*([A-Za-z]+ \d{1,2},? \d{4}|\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{4}-\d{2}-\d{2})/i);
        if (updateMatch) lastUpdated = updateMatch[1].trim();
      }
      if (!lastUpdated || lastUpdated.length > 25) {
        const today = new Date();
        lastUpdated = today.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      }

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

      let numRating = parseFloat(rating);
      rating = (!isNaN(numRating) && numRating >= 1 && numRating <= 5) ? numRating.toFixed(1) : '5.0';

      // ================= ৯. DOWNLOAD LINK =================
      let downloadUrl = targetUrl;
      const dlAnchor = document.querySelector('a[href*="/download"], a.download_button, a.btn-download, a[class*="download"]');
      if (dlAnchor && dlAnchor.href) {
        downloadUrl = dlAnchor.href;
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
        downloads: '50K+',
        icon: icon || 'https://upload.wikimedia.org/wikipedia/commons/d/d7/Android_robot.svg',
        description,
        download: downloadUrl,
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
