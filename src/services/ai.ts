import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import slugify from 'slugify';
import { config } from '../config.js';
import { CrawledArticle } from './crawler.js';

export interface ProcessedArticle {
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  tags: string[];
  category: string;
}

const SYSTEM_PROMPT = `Bạn là chuyên gia biên tập nội dung số và chuyên gia SEO hàng đầu cho website tin tức & dịch vụ.
Nhiệm vụ của bạn là đọc một bài viết được cào về, hiểu rõ ý chính, và VIẾT LẠI HOÀN TOÀN THÀNH MỘT BÀI VIẾT MỚI:
1. Độc bản 100%, không bị trùng lặp nội dung (tránh thuật toán phạt duplicate content của Google).
2. Giữ nguyên tính chính xác của các số liệu, tên riêng, sự kiện cốt lõi.
3. Nếu bài viết gốc là tiếng nước ngoài, hãy dịch và bản địa hóa mượt mà sang tiếng Việt.
4. Hành văn mạch lạc, hấp dẫn, chuẩn phong cách chuyên nghiệp.
5. Định dạng nội dung bài viết dưới dạng HTML hợp lệ dùng cho WordPress (dùng thẻ <h2>, <h3>, <p>, <ul>, <li>, <blockquote>, <strong>). KHÔNG bọc thẻ <html> hay <body>.
6. Luôn phản hồi duy nhất dưới định dạng JSON với cấu trúc sau:
{
  "title": "Tiêu đề mới hấp dẫn chuẩn SEO (< 70 ký tự)",
  "slug": "tieu-de-khong-dau-ngan-gon",
  "excerpt": "Đoạn tóm tắt meta description thu hút người đọc (120-160 ký tự)",
  "content": "<p>Nội dung bài viết mới dạng HTML...</p>",
  "tags": ["Tag1", "Tag2", "Tag3"],
  "category": "Tên chuyên mục phù hợp"
}`;

export async function processArticleWithAI(article: CrawledArticle): Promise<ProcessedArticle> {
  const customInstruction = config.ai.customPrompt
    ? `\nLưu ý thêm từ quản trị viên: ${config.ai.customPrompt}`
    : '';

  const prompt = `${SYSTEM_PROMPT}${customInstruction}

--- BÀI VIẾT GỐC ---
Tiêu đề gốc: ${article.title}
Nguồn gốc: ${article.sourceDomain} (${article.url})
Nội dung gốc:
${article.textContent.slice(0, 12000)}

Hãy viết lại bài viết và trả về duy nhất chuỗi JSON hợp lệ.`;

  let rawResponse = '';

  if (config.ai.provider === 'openai') {
    const openai = new OpenAI({ apiKey: config.ai.openaiApiKey });
    const completion = await openai.chat.completions.create({
      model: config.ai.openaiModel,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.7,
    });
    rawResponse = completion.choices[0]?.message?.content || '{}';
  } else {
    // Default: Gemini
    const genAI = new GoogleGenerativeAI(config.ai.geminiApiKey);
    const model = genAI.getGenerativeModel({
      model: config.ai.geminiModel,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.7,
      },
    });

    const result = await model.generateContent(prompt);
    rawResponse = result.response.text();
  }

  return parseAIResponse(rawResponse, article);
}

function parseAIResponse(rawJson: string, original: CrawledArticle): ProcessedArticle {
  try {
    const clean = rawJson.replace(/```json/gi, '').replace(/```/g, '').trim();
    const data = JSON.parse(clean);

    return {
      title: data.title || original.title,
      slug:
        data.slug ||
        slugify(data.title || original.title, {
          lower: true,
          strict: true,
          locale: 'vi',
        }),
      excerpt: data.excerpt || '',
      content: data.content || original.content,
      tags: Array.isArray(data.tags) ? data.tags : [],
      category: data.category || 'Tin tức',
    };
  } catch (err) {
    console.error('[AI] Error parsing JSON output from AI:', err, rawJson);
    return {
      title: original.title,
      slug: slugify(original.title, { lower: true, strict: true, locale: 'vi' }),
      excerpt: original.textContent.slice(0, 150),
      content: original.content,
      tags: ['Tin tức'],
      category: 'Tin tức',
    };
  }
}

export async function chatWithAI(userMessage: string): Promise<string> {
  const prompt = `Bạn là trợ lý AI thông minh hỗ trợ quản trị viên website ${config.wordpress.url || ''}.
Hãy trả lời ngắn gọn, thân thiện, hữu ích và tự nhiên bằng tiếng Việt:
Người dùng nhắn: "${userMessage}"`;

  try {
    if (config.ai.provider === 'openai') {
      const openai = new OpenAI({ apiKey: config.ai.openaiApiKey });
      const completion = await openai.chat.completions.create({
        model: config.ai.openaiModel,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
      });
      return completion.choices[0]?.message?.content || 'Xin chào! Tôi có thể giúp gì cho bạn?';
    } else {
      const genAI = new GoogleGenerativeAI(config.ai.geminiApiKey);
      const model = genAI.getGenerativeModel({ model: config.ai.geminiModel });
      const result = await model.generateContent(prompt);
      return result.response.text();
    }
  } catch (error: any) {
    console.error('[AI Chat] Error:', error);
    return 'Xin chào! Tôi là AI Bot hỗ trợ website. Bạn có thể gửi cho tôi một link bài viết để tôi tự động cào và đăng lên WordPress, hoặc hỏi tôi bất cứ điều gì!';
  }
}

export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    if (config.ai.provider === 'openai') {
      if (!config.ai.openaiApiKey) return [];
      const openai = new OpenAI({ apiKey: config.ai.openaiApiKey });
      const res = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: text,
        dimensions: 768,
      });
      return res.data[0].embedding;
    } else {
      if (!config.ai.geminiApiKey) return [];
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${config.ai.geminiApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'models/gemini-embedding-001',
            content: { parts: [{ text }] },
            outputDimensionality: 768,
          }),
        }
      );
      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`[${res.status}] ${errBody}`);
      }
      const data: any = await res.json();
      return data.embedding?.values || [];
    }
  } catch (err: any) {
    console.error('[AI Embedding Error]:', err.message);
    return [];
  }
}

export async function generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  try {
    if (config.ai.provider === 'openai') {
      if (!config.ai.openaiApiKey) return [];
      const openai = new OpenAI({ apiKey: config.ai.openaiApiKey });
      const res = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: texts,
        dimensions: 768,
      });
      return res.data.map((d) => d.embedding);
    } else {
      if (!config.ai.geminiApiKey) return [];
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents?key=${config.ai.geminiApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requests: texts.map((t) => ({
              model: 'models/gemini-embedding-001',
              content: { parts: [{ text: t }] },
              outputDimensionality: 768,
            })),
          }),
        }
      );
      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`[${res.status}] ${errBody}`);
      }
      const data: any = await res.json();
      return (data.embeddings || []).map((e: any) => e.values || []);
    }
  } catch (err: any) {
    console.error('[AI Batch Embedding Error]:', err.message);
    return [];
  }
}


