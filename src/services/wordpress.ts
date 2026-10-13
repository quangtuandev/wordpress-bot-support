import axios, { AxiosInstance } from 'axios';
import path from 'path';
import { config } from '../config.js';

export interface WordPressPostResult {
  id: number;
  title: string;
  link: string;
  status: string;
}

class WordPressService {
  private client: AxiosInstance;
  private apiBase: string;

  constructor() {
    this.apiBase = `${config.wordpress.url}/wp-json/wp/v2`;
    const token = Buffer.from(
      `${config.wordpress.username}:${config.wordpress.appPassword}`
    ).toString('base64');

    this.client = axios.create({
      baseURL: this.apiBase,
      headers: {
        Authorization: `Basic ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
  }

  async testConnection(): Promise<{ success: boolean; message: string; user?: string }> {
    try {
      const res = await this.client.get('/users/me');
      return {
        success: true,
        message: 'Kết nối WordPress thành công!',
        user: res.data.name || res.data.slug,
      };
    } catch (error: any) {
      const msg = error.response?.data?.message || error.message;
      return {
        success: false,
        message: `Lỗi kết nối WordPress: ${msg}`,
      };
    }
  }

  async uploadMedia(imageUrl: string, altText: string): Promise<number | undefined> {
    try {
      // 1. Download image
      const imageRes = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 20000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; WordPressBot/1.0)',
        },
      });

      const rawContentType = imageRes.headers['content-type'];
      const contentType = String(rawContentType || 'image/jpeg');
      let extension = '.jpg';
      if (contentType.includes('png')) extension = '.png';
      else if (contentType.includes('webp')) extension = '.webp';
      else if (contentType.includes('gif')) extension = '.gif';

      const filename = `article-${Date.now()}${extension}`;

      // 2. Upload to WordPress
      const uploadRes = await this.client.post('/media', imageRes.data, {
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      });

      const mediaId = uploadRes.data.id;

      // Update alt text
      if (mediaId && altText) {
        await this.client.post(`/media/${mediaId}`, {
          alt_text: altText,
          description: altText,
        }).catch(() => {});
      }

      return mediaId;
    } catch (err: any) {
      console.warn('[WordPress] Failed to upload featured image:', err.response?.data || err.message);
      return undefined;
    }
  }

  async ensureCategory(categoryName: string): Promise<number | undefined> {
    if (!categoryName) return undefined;
    try {
      // Search existing
      const searchRes = await this.client.get(`/categories?search=${encodeURIComponent(categoryName)}`);
      if (searchRes.data && searchRes.data.length > 0) {
        return searchRes.data[0].id;
      }

      // Create new
      const createRes = await this.client.post('/categories', { name: categoryName });
      return createRes.data.id;
    } catch {
      return undefined;
    }
  }

  async ensureTags(tagNames: string[]): Promise<number[]> {
    const tagIds: number[] = [];
    for (const name of tagNames) {
      if (!name) continue;
      try {
        const searchRes = await this.client.get(`/tags?search=${encodeURIComponent(name)}`);
        if (searchRes.data && searchRes.data.length > 0) {
          tagIds.push(searchRes.data[0].id);
        } else {
          const createRes = await this.client.post('/tags', { name });
          tagIds.push(createRes.data.id);
        }
      } catch {
        // Skip tag if fails
      }
    }
    return tagIds;
  }

  async createPost(params: {
    title: string;
    content: string;
    excerpt?: string;
    slug?: string;
    status?: 'draft' | 'publish';
    featuredMediaId?: number;
    categoryName?: string;
    tags?: string[];
  }): Promise<WordPressPostResult> {
    let categoryId: number | undefined;
    if (params.categoryName) {
      categoryId = await this.ensureCategory(params.categoryName);
    }

    let tagIds: number[] = [];
    if (params.tags && params.tags.length > 0) {
      tagIds = await this.ensureTags(params.tags);
    }

    const payload: Record<string, any> = {
      title: params.title,
      content: params.content,
      excerpt: params.excerpt || '',
      slug: params.slug || '',
      status: params.status || config.wordpress.defaultStatus,
    };

    if (params.featuredMediaId) {
      payload.featured_media = params.featuredMediaId;
    }
    if (categoryId) {
      payload.categories = [categoryId];
    }
    if (tagIds.length > 0) {
      payload.tags = tagIds;
    }
    if (config.wordpress.defaultAuthorId) {
      payload.author = config.wordpress.defaultAuthorId;
    }

    const res = await this.client.post('/posts', payload);
    return {
      id: res.data.id,
      title: res.data.title.rendered,
      link: res.data.link,
      status: res.data.status,
    };
  }

  async publishPost(postId: number): Promise<string> {
    const res = await this.client.post(`/posts/${postId}`, {
      status: 'publish',
    });
    return res.data.link;
  }

  async deletePost(postId: number): Promise<boolean> {
    await this.client.delete(`/posts/${postId}?force=true`);
    return true;
  }
}

export const wpService = new WordPressService();
