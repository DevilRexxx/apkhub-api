const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json());

app.get('/ping', (req, res) => res.send('pong'));

app.post('/extract', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ success: false, error: 'URL is required' });

  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      timeout: 10000
    });

    const html = response.data;
    const $ = cheerio.load(html);
    const bodyText = $('body').text();

    // ১. JSON-LD SCHEMA রিড করা
    let schemaData = {};
    $('script[type="application/ld+json"]').each((i, el) => {
      try {
        const parsed = JSON.parse($(el).html());
        if (parsed['@type'] === 'SoftwareApplication' || parsed.applicationCategory) {
          schemaData = parsed;
        } else if (Array.isArray(parsed)) {
          const found = parsed.find(item => item['@type'] === 'SoftwareApplication' || item.applicationCategory);
          if (found) schemaData = found;
        }
      } catch (e) {}
    });

    // ২. APP NAME
    let name = schemaData.name || $('h1.entry-title, h1.text-2xl, h1.font-bold, h1').first().text().trim();
    if (!name) name = $('meta[property="og:title"]').attr('content') || '';

    name = name
      .replace(/\b(liteapks\.com|liteapks|an1\.com|an1|\.com)\b/gi, '')
      .replace(/\b(MOD APK|MOD|APK|Unlimited Money|Everything|Free Download|for Android)\b/gi, '')
      .replace(/\bv?[0-9]+(?:\.[0-9]+)+(?:[a-zA-Z0-9.-]*)\b/gi, '')
      .replace(/\(.*?\)/g, '')
      .replace(/\[.*?\]/g, '')
      .replace(/[-|•–].*$/, '')
      .trim();

    if (!name) {
      try {
        const seg = new URL(url).pathname.split('/').filter(Boolean).pop() || '';
        name = seg.replace(/^[0-9]+-/, '').replace(/(-mod|\.html|\.apk)/gi, '').replace(/[-_]/g, ' ').trim();
        name = name.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      } catch(e) {}
    }

    // ৩. APP ICON
    let icon = '';
    if (schemaData.image) {
      icon = typeof schemaData.image === 'string' ? schemaData.image : (schemaData.image.url || '');
    }
    if (!icon) {
      const imgEl = $('.app-icon img, .post-thumbnail img, .app-detail img, [class*="icon"] img').first();
      icon = imgEl.attr('data-src') || imgEl.attr('data-lazy-src') || imgEl.attr('src') || '';
    }
    if (!icon || icon.includes('data:image')) {
      icon = $('meta[property="og:image"]').attr('content') || $('meta[name="twitter:image"]').attr('content') || '';
    }
    if (icon && !icon.startsWith('http')) {
      try { icon = new URL(icon, url).href; } catch(e) {}
    }

    // ৪. VERSION & SIZE
    let version = schemaData.softwareVersion || '';
    let size = schemaData.fileSize || '';

    $('tr, li, div, span, .spec-item').each((i, el) => {
      const txt = $(el).text().trim();
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
    });

    if (!version) {
      const vMatch = bodyText.match(/\b(?:v|Version)[:\s]*([0-9]+(?:\.[0-9]+)+(?:[a-zA-Z0-9.-]*))\b/i);
      version = vMatch ? vMatch[1].trim() : '1.0.0';
    }
    version = version.startsWith('v') ? version : `v${version}`;

    if (!size) {
      const sm = bodyText.match(/\bSize[:\s]*([0-9]+(?:\.[0-9]+)?\s*(?:MB|GB|KB|Mb|Gb|M|G)\b)/i);
      size = sm ? sm[1].toUpperCase() : '120 MB';
      if (size.endsWith('M')) size += 'B';
    }

    // ৫. DEVELOPER (উন্নত পার্সিং)
    let developer = schemaData.author?.name || '';
    if (!developer) {
      $('.post-info span, .app-info li, tr, .infotable li').each((i, el) => {
        const t = $(el).text();
        if (/developer|publisher|offered by/i.test(t)) {
          const val = t.replace(/developer|publisher|offered by/gi, '').replace(/[:\n\r]/g, '').trim();
          if (val && val.length < 30) developer = val;
        }
      });
    }
    if (!developer) {
      const devM = bodyText.match(/(?:Developer|Offered by|Publisher)[:\s]*([A-Za-z0-9\s.,&'-]{2,30})/i);
      if (devM) developer = devM[1].trim();
    }
    if (!developer || developer.toLowerCase().includes('top android')) developer = 'Verified Studio';

    // ৬. CATEGORY
    let category = schemaData.applicationCategory || '';
    if (!category) {
      const crumbs = [];
      $('.breadcrumb a, nav[class*="bread"] a, .breadcrumbs a').each((i, el) => crumbs.push($(el).text().trim()));
      if (crumbs.length >= 2) category = crumbs[crumbs.length - 2];
    }
    if (!category || ['home', 'apps', 'games'].includes(category.toLowerCase())) {
      category = 'Action Games';
    }

    // ৭. MOD TYPE
    const titleLower = ($('title').text() || '').toLowerCase();
    const modType = titleLower.includes('premium') ? 'PREMIUM' : (titleLower.includes('pro') ? 'PRO' : 'MOD');

    // ৮. SCREENSHOTS (LiteApks ও AN1 গ্যালারি ফিক্স)
    const screenshots = [];
    $('img').each((i, el) => {
      let src = $(el).attr('data-src') || $(el).attr('data-lazy-src') || $(el).attr('src');
      const cls = $(el).attr('class') || '';
      const parentCls = $(el).parent().attr('class') || '';
      
      if (
        src && 
        !src.includes('data:image') && 
        !src.includes('logo') && 
        !src.includes('icon') &&
        !src.includes('avatar') &&
        (cls.includes('screen') || cls.includes('gallery') || parentCls.includes('screen') || parentCls.includes('gallery') || parentCls.includes('owl') || src.includes('/uploads/posts/'))
      ) {
        try {
          const abs = new URL(src, url).href;
          if (!screenshots.includes(abs) && screenshots.length < 6) {
            screenshots.push(abs);
          }
        } catch(e) {}
      }
    });

    // ৯. DESCRIPTION & MOD FEATURES
    let description = '';
    const contentBox = $('.entry-content, article, .post-content, #description, .content').first();
    if (contentBox.length) {
      contentBox.find('script, style, ins, form, iframe, header, footer').remove();
      const lines = [];
      contentBox.find('p, li, span').each((i, el) => {
        const t = $(el).text().trim();
        if (t && t.length > 15 && !t.includes('LiteApks') && !t.includes('AN1') && !lines.includes(t)) {
          lines.push(t);
        }
      });
      description = lines.slice(0, 12).join('\n\n');
    }
    if (!description) {
      description = $('meta[property="og:description"]').attr('content') || 'Tested and clean Android MOD APK release with full features unlocked.';
    }

    // ১০. DIRECT DOWNLOAD LINK (মধ্যবর্তী পেজ ও ফাইনাল ফাইল লিংক ফিক্স)
    let downloadUrl = url;
    let intermediateUrl = '';

    $('a').each((i, el) => {
      const href = $(el).attr('href') || '';
      const text = $(el).text().toLowerCase();
      if (href.includes('/download/') || href.includes('file_get') || text.includes('download') || text.includes('apk')) {
        try {
          intermediateUrl = new URL(href, url).href;
          return false;
        } catch (e) {}
      }
    });

    if (intermediateUrl) {
      downloadUrl = intermediateUrl;
      try {
        const dlPageRes = await axios.get(intermediateUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Referer': url
          },
          timeout: 6000
        });

        const $dl = cheerio.load(dlPageRes.data);
        $dl('a').each((i, el) => {
          const finalHref = $dl(el).attr('href') || '';
          if (
            finalHref.endsWith('.apk') ||
            finalHref.endsWith('.xapk') ||
            finalHref.includes('.apk?') ||
            finalHref.includes('dl.') ||
            finalHref.includes('files.')
          ) {
            downloadUrl = new URL(finalHref, intermediateUrl).href;
            return false;
          }
        });
      } catch (subErr) {}
    }

    res.json({
      success: true,
      data: {
        name: name || 'Android Game',
        modType,
        developer: developer || 'Verified Publisher',
        category,
        lastUpdated: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        version,
        size,
        rating: schemaData.aggregateRating?.ratingValue?.toString() || '4.5',
        icon: icon || 'https://upload.wikimedia.org/wikipedia/commons/d/d7/Android_robot.svg',
        description: description.slice(0, 1500),
        download: downloadUrl,
        downloadUrl,
        screenshots: screenshots.length > 0 ? screenshots : ['https://placehold.co/400x225/111b33/10b981?text=Preview+1', 'https://placehold.co/400x225/111b33/06b6d4?text=Preview+2']
      }
    });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Superfast Light-Scraper active on port ${PORT}`));
