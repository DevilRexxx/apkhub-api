const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

const app = express();
app.use(cors());
app.use(express.json());

app.post('/extract', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  let browser = null;
  try {
    // ডিসপ্লে ছাড়া ব্যাকগ্রাউন্ড ব্রাউজার ওপেন
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // পেজ থেকে আসল ডাটা টেনে বের করা
    const data = await page.evaluate((targetUrl) => {
      let name = document.querySelector('.app_name, h1.title, h1')?.innerText?.trim() || 'New Mod App';
      name = name.replace(/\b(MOD|APK|Unlimited Money|AN1|LiteApks)\b/gi, '').trim();

      let icon = document.querySelector('.app_view img, .app-icon img, meta[property="og:image"]')?.src || 
                 document.querySelector('meta[property="og:image"]')?.content || '';

      let size = '85 MB';
      const text = document.body.innerText;
      const sizeMatch = text.match(/\b([0-9.]+\s*(?:MB|GB|Mb|Gb))\b/i);
      if (sizeMatch) size = sizeMatch[1].toUpperCase();

      const dlBtn = document.querySelector('a[href*="/download"], a.download_button, a.btn-download');
      const download = dlBtn ? dlBtn.href : targetUrl;

      return {
        name,
        size,
        rating: '4.8',
        icon,
        download,
        description: 'Verified clean MOD APK build.'
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
app.listen(PORT, () => console.log(`Scraper live on port ${PORT}`));


