import { extract } from '@extractus/article-extractor';
import axios from 'axios';
import * as cheerio from 'cheerio';

export interface CrawledArticle {
  url: string;
  title: string;
  content: string;
  textContent: string;
  image?: string;
  author?: string;
  published?: string;
  sourceDomain: string;
}

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

export async function crawlArticle(url: string): Promise<CrawledArticle> {
  const domain = new URL(url).hostname;

  // 1. Try standardized extraction with @extractus/article-extractor
  try {
    const data = await extract(url, undefined, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'vi,en-US;q=0.9,en;q=0.8',
      },
    });

    if (data && data.content && data.content.length > 100) {
      const $ = cheerio.load(data.content);
      const textContent = $('body').text().trim().replace(/\s+/g, ' ');

      return {
        url,
        title: data.title || '',
        content: data.content,
        textContent,
        image: data.image,
        author: data.author,
        published: data.published,
        sourceDomain: domain,
      };
    }
  } catch (error) {
    console.warn(`[Crawler] Article extractor standard failed for ${url}, trying fallback parser...`, error);
  }

  // 2. Fallback with Cheerio
  return await fallbackCheerioCrawler(url, domain);
}

async function fallbackCheerioCrawler(url: string, domain: string): Promise<CrawledArticle> {
  const response = await axios.get(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
    },
    timeout: 15000,
  });

  const $ = cheerio.load(response.data);

  // Extract Title
  const title =
    $('meta[property="og:title"]').attr('content') ||
    $('h1').first().text().trim() ||
    $('title').text().trim();

  // Extract Image
  const image =
    $('meta[property="og:image"]').attr('content') ||
    $('meta[name="twitter:image"]').attr('content') ||
    $('article img').first().attr('src') ||
    $('.post-content img').first().attr('src');

  // Remove junk elements before reading content
  $('script, style, noscript, iframe, svg, nav, header, footer, .ads, .advertisement, .sidebar, .comments').remove();

  // Common content containers
  const contentSelectors = [
    'article',
    '.entry-content',
    '.post-content',
    '.detail-content',
    '.fck_detail',
    '.singular-content',
    '.content-detail',
    '#main-content',
    'main',
  ];

  let contentHtml = '';
  for (const selector of contentSelectors) {
    const el = $(selector);
    if (el.length > 0 && el.text().trim().length > 150) {
      contentHtml = el.html() || '';
      break;
    }
  }

  if (!contentHtml) {
    contentHtml = $('body').html() || '';
  }

  const $cleaned = cheerio.load(contentHtml);
  $cleaned('script, style, noscript, nav, footer, header').remove();

  return {
    url,
    title: title.trim(),
    content: contentHtml,
    textContent: $cleaned.text().trim().replace(/\s+/g, ' '),
    image,
    sourceDomain: domain,
  };
}
