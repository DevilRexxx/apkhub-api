const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

const app = express();
app.use(cors());
app.use(express.json());

app.post('/extract', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ success: false, error: 'URL is required' });

  let browser = null;
  try {
    browser = await puppeteer.launch({
      args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    
    // পেজ পুরোপুরি লোড ও স্ক্রিপ্ট এক্সিকিউট হওয়া পর্যন্ত অপেক্ষা
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 35000 });

    // লেজি লোড ইমেজ ও ডাইনামিক ডেটা ট্রিগার করতে স্ক্রোল
    await page.evaluate(async () => {
      window.scrollBy(0, 800);
      await new Promise(r => setTimeout(r, 600));
    });

    const data = await page.evaluate((targetUrl) => {
      const isAN1 = targetUrl.includes('an1.com');
      const isLiteApks = targetUrl.includes('liteapks.com');

      // ১. App Name
      let name = '';
      if (isAN1) {
        name = document.querySelector('.app_name, h1.title, h1[itemprop="headline"]')?.innerText?.trim();
      } else if (isLiteApks) {
        name = document.querySelector('h1.entry-title, h1.text-2xl, h1')?.innerText?.trim();
      }
      if (!name) name = document.querySelector('meta[property="og:title"]')?.content || document.querySelector('h1')?.innerText?.trim() || '';
      name = name.replace(/\b(MOD|APK|Unlimited Money|Everything|Free Download|for Android|LiteApks|AN1)\b/gi, '').replace(/[-|•–].*$/, '').trim();
      if (!name) name = "New Mod App";

      // ২. Icon (Lazy-load হ্যান্ডলার)
      let icon = '';
      if (isAN1) {
        const imgEl = document.querySelector('.app_view .img img, .app_spec .img img, .app-img img');
        if (imgEl) icon = imgEl.getAttribute('data-src') || imgEl.getAttribute('data-original') || imgEl.currentSrc || imgEl.src;
      } else if (isLiteApks) {
        const imgEl = document.querySelector('.app-icon img, .entry-content img, .flex-shrink-0 img, .post-thumbnail img');
        if (imgEl) icon = imgEl.getAttribute('data-src') || imgEl.getAttribute('data-lazy-src') || imgEl.currentSrc || imgEl.src;
      }
      if (!icon || icon.includes('data:image')) {
        icon = document.querySelector('meta[property="og:image"]')?.content ||
               document.querySelector('meta[name="twitter:image"]')?.content ||
               document.querySelector('link[rel="apple-touch-icon"]')?.href || '';
      }
      if (icon && !icon.startsWith('http')) {
        try { icon = new URL(icon, targetUrl).href; } catch(e) {}
      }

      // ৩. APK Size
      let size = '';
      if (isAN1) {
        const specElements = Array.from(document.querySelectorAll('.specifications li, .app_spec li, .info-list li, span'));
        for (const el of specElements) {
          const txt = el.innerText || '';
          if (/size|размер/i.test(txt)) {
            const m = txt.match(/([0-9.]+\s*(?:Mb|Gb|Kb|MB|GB|KB))/i);
            if (m) { size = m[1].toUpperCase(); break; }
          }
        }
      } else if (isLiteApks) {
        const rows = Array.from(document.querySelectorAll('tr, .spec-item, .app-detail li'));
        for (const r of rows) {
          const txt = r.innerText || '';
          if (/size/i.test(txt)) {
            const m = txt.match(/([0-9.]+\s*(?:MB|GB|KB|Mb|Gb))/i);
            if (m) { size = m[1].toUpperCase(); break; }
          }
        }
      }
      if (!size) {
        const fullText = document.body ? document.body.innerText : '';
        const sizeMatch = fullText.match(/\bSize[:\s]*([0-9.]+\s*(?:MB|GB|KB|Mb|Gb))\b/i) || fullText.match(/\b([0-9.]+\s*(?:MB|GB))\b/i);
        size = sizeMatch ? sizeMatch[1].toUpperCase() : '85 MB';
      }

      // ৪. Star Rating
      let rating = '';
      if (isAN1) {
        const rMeta = document.querySelector('meta[itemprop="ratingValue"], span[itemprop="ratingValue"], .rating_num');
        if (rMeta) rating = rMeta.content || rMeta.innerText?.trim();
      } else if (isLiteApks) {
        const rEl = document.querySelector('.rating-value, .post-ratings strong, span[itemprop="ratingValue"]');
        if (rEl) rating = rEl.innerText?.trim();
      }
      if (!rating) {
        const fullText = document.body ? document.body.innerText : '';
        const rMatch = fullText.match(/\b([3-5]\.[0-9])\s*(?:\/|out of|\★|stars|ratings)?/i);
        rating = rMatch ? rMatch[1] : '4.8';
      }
      const numRating = parseFloat(rating);
      rating = (!isNaN(numRating) && numRating >= 1 && numRating <= 5) ? numRating.toFixed(1) : '4.8';

      // ৫. Total Downloads
      let downloads = '';
      const text = document.body ? document.body.innerText : '';
      const dlMatch = text.match(/\b([0-9]+(?:\.[0-9]+)?[KkMmBb]\+?|[0-9,]{3,}\+?)\s*(?:Downloads|Installs|скачиваний)/i);
      if (dlMatch) {
        downloads = dlMatch[1];
      } else {
        downloads = '500K+';
      }

      // ৬. Description & Mod Features
      let description = '';
      if (isAN1) {
        description = document.querySelector('.app_view .description, #description, .text')?.innerText?.trim();
      } else if (isLiteApks) {
        description = document.querySelector('.entry-content, .description, #description')?.innerText?.trim();
      }
      if (!description) description = document.querySelector('meta[property="og:description"]')?.content || 'Tested and clean Android MOD APK release.';
      description = description.replace(/\s+/g, ' ').slice(0, 800);

      // ৭. Screenshots
      const screenshots = [];
      const imgElements = document.querySelectorAll('.app_screens img, .screenshots img, .gallery-item img, [class*="screenshot"] img');
      imgElements.forEach(img => {
        let src = img.getAttribute('data-src') || img.getAttribute('data-original') || img.currentSrc || img.src;
        if (src && !screenshots.includes(src) && !src.includes('logo') && !src.includes('icon') && !src.includes('data:image')) {
          try {
            screenshots.push(new URL(src, targetUrl).href);
          } catch(e) {}
        }
      });

      // ৮. Target Download Link
      let downloadUrl = targetUrl;
      const dlAnchor = document.querySelector('a[href*="/download"], a.download_button, a.btn-download');
      if (dlAnchor && dlAnchor.href) {
        downloadUrl = dlAnchor.href;
      }

      return {
        name,
        icon: icon || 'https://upload.wikimedia.org/wikipedia/commons/d/d7/Android_robot.svg',
        size,
        rating,
        downloads,
        description,
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
