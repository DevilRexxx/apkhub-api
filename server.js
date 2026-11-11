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
      args: [
        ...chromium.args,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--single-process'
      ],
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const type = req.resourceType();
      if (['media', 'font'].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });

    const data = await page.evaluate((targetUrl) => {
      const isAN1 = targetUrl.includes('an1.com');
      const isLiteApks = targetUrl.includes('liteapks.com');

      // ================= ১. APP NAME =================
      let name = '';
      if (isLiteApks) {
        const h1 = document.querySelector('h1.entry-title, h1.text-2xl, h1.font-bold, h1');
        if (h1) name = h1.innerText?.trim();
      } else if (isAN1) {
        name = document.querySelector('.app_name, h1.title, h1[itemprop="headline"]')?.innerText?.trim();
      }
      if (!name) name = document.querySelector('meta[property="og:title"]')?.content || document.title || '';

      name = name
        .replace(/\b(MOD APK|MOD|APK|Unlimited Money|Everything|Free Download|for Android|LiteApks|AN1)\b/gi, '')
        .replace(/\(.*?\)/g, '')
        .replace(/\[.*?\]/g, '')
        .replace(/[-|•–].*$/, '')
        .trim();

      // ================= ২. APK SIZE (Deep DOM & Table Inspector) =================
      let size = '';

      // ক. টেবিল ও স্পেক কন্টেইনার সরাসরি চেক
      const specElements = Array.from(document.querySelectorAll('tr, .spec-item, li, dt, dd, [class*="detail"], [class*="info"], [class*="spec"]'));
      for (const el of specElements) {
        const inner = el.innerText || '';
        if (/size|размер/i.test(inner)) {
          const match = inner.match(/([0-9]+(?:\.[0-9]+)?\s*(?:MB|GB|KB|Mb|Gb))/i);
          if (match) {
            size = match[1].toUpperCase();
            break;
          }
        }
      }

      // খ. ডাউনলোড বাটনের গায়ের টেক্সট স্ক্যান (যেমন: "Download (140MB)")
      if (!size) {
        const dlBtns = Array.from(document.querySelectorAll('a[href*="/download"], a.download_button, a.btn-download, [class*="download"]'));
        for (const btn of dlBtns) {
          const btnTxt = btn.innerText || '';
          const match = btnTxt.match(/([0-9]+(?:\.[0-9]+)?\s*(?:MB|GB|KB|Mb|Gb))/i);
          if (match) {
            size = match[1].toUpperCase();
            break;
          }
        }
      }

      // গ. পুরো পেজের র টেক্সট স্ক্যান
      if (!size) {
        const rawText = document.body ? document.body.innerText : '';
        const rawMatch = rawText.match(/\bSize[:\s]*([0-9]+(?:\.[0-9]+)?\s*(?:MB|GB|KB|Mb|Gb))\b/i) ||
                         rawText.match(/\b([0-9]+(?:\.[0-9]+)?\s*(?:MB|GB))\b/i);
        size = rawMatch ? rawMatch[1].toUpperCase() : '95 MB';
      }

      // ================= ৩. STAR RATING (JSON-LD & DOM Inspector) =================
      let rating = '';

      // ক. JSON-LD Schema মেটাডাটা স্ক্যান (সবচেয়ে নিখুঁত রেটিং থাকে এখানে)
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (const s of scripts) {
        try {
          const json = JSON.parse(s.innerText);
          if (json.aggregateRating && json.aggregateRating.ratingValue) {
            rating = json.aggregateRating.ratingValue.toString();
            break;
          }
          if (Array.isArray(json)) {
            const found = json.find(item => item.aggregateRating && item.aggregateRating.ratingValue);
            if (found) {
              rating = found.aggregateRating.ratingValue.toString();
              break;
            }
          }
        } catch(e) {}
      }

      // খ. LiteApks ও AN1 রেটিং এলিমেন্ট
      if (!rating) {
        if (isLiteApks) {
          const rEl = document.querySelector('.post-ratings strong, .rating-value, span[itemprop="ratingValue"], .post-ratings span');
          if (rEl) rating = rEl.innerText?.trim();
        } else if (isAN1) {
          const rEl = document.querySelector('meta[itemprop="ratingValue"], span[itemprop="ratingValue"], .rating_num');
          if (rEl) rating = rEl.content || rEl.innerText?.trim();
        }
      }

      // গ. স্ক্রিন টেক্সট রেটিং প্যাটার্ন (যেমন: 4.6 / 5)
      if (!rating) {
        const rawText = document.body ? document.body.innerText : '';
        const match = rawText.match(/\b([3-5]\.[0-9])\s*(?:\/|out of|\★|stars|ratings|votes)?/i);
        if (match) rating = match[1];
      }

      // ১ ডেসিমেল ফরম্যাট ফিক্স করা (যেমন: 4.7)
      let numRating = parseFloat(rating);
      if (!isNaN(numRating) && numRating >= 1 && numRating <= 5) {
        rating = numRating.toFixed(1);
      } else {
        rating = '4.7';
      }

      // ================= ৪. APP ICON =================
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

      // ================= ৫. TOTAL DOWNLOADS =================
      let downloads = '';
      const fullText = document.body ? document.body.innerText : '';
      const dlMatch = fullText.match(/\b([0-9]+(?:\.[0-9]+)?[KkMmBb]\+?|[0-9,]{3,}\+?)\s*(?:Downloads|Installs|скачиваний)/i);
      downloads = dlMatch ? dlMatch[1] : '500K+';

      // ================= ৬. DESCRIPTION & MOD FEATURES =================
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
        description = document.querySelector('meta[property="og:description"]')?.content ||
                      document.querySelector('meta[name="description"]')?.content ||
                      'Enjoy full unlocked gameplay with exclusive mod features, unlimited resources, and clean verified APK installation.';
      }
      description = description.replace(/[ \t]+/g, ' ').slice(0, 1500);

      // ================= ৭. SCREENSHOTS =================
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

      // ================= ৮. DOWNLOAD LINK =================
      let downloadUrl = targetUrl;
      const dlAnchor = document.querySelector('a[href*="/download"], a.download_button, a.btn-download, a[class*="download"]');
      if (dlAnchor && dlAnchor.href) {
        downloadUrl = dlAnchor.href;
      }

      return {
        name: name || 'Extracted Mod App',
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
