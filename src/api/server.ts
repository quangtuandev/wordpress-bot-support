import fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { config } from '../config.js';
import { dbService } from '../services/database.js';
import { generateEmbedding } from '../services/ai.js';

export function createApiServer(): FastifyInstance {
  const app = fastify({
    logger: false,
  });

  // Kích hoạt CORS để theme WordPress hoặc client có thể gọi vào
  app.register(cors, {
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
  });

  // Health check
  app.get('/health', async () => {
    const dbTest = await dbService.testConnection();
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: dbTest.success ? 'connected' : 'error',
    };
  });

  // API 1: Tìm kiếm Hybrid (Exact Code, Prefix hoặc Semantic Vector Search)
  // GET /api/hs/search?q=tai+nghe+bluetooth&limit=10
  app.get<{
    Querystring: { q?: string; limit?: string };
  }>('/api/hs/search', async (req, reply) => {
    const query = req.query.q?.trim();
    if (!query) {
      return reply.status(400).send({ error: 'Tham số tìm kiếm "q" là bắt buộc.' });
    }

    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '10', 10)));
    const isCodeLike = /^[0-9.]+$/.test(query);

    let queryEmbedding: number[] | undefined;
    // Nếu là dạng chữ (ngôn ngữ tự nhiên), sinh vector để tìm ngữ nghĩa
    if (!isCodeLike && query.length >= 2) {
      try {
        queryEmbedding = await generateEmbedding(query);
      } catch (err) {
        console.warn('[API Search] Không thể tạo vector cho query, dùng text fallback:', err);
      }
    }

    const results = await dbService.searchHybrid(query, queryEmbedding, limit);
    return {
      query,
      is_code_search: isCodeLike,
      total: results.length,
      results,
    };
  });

  // API 2: Chi tiết một mã HS (dùng cho trang SEO chi tiết /ma-hs/:code)
  // GET /api/hs/detail/85183010
  app.get<{
    Params: { code: string };
  }>('/api/hs/detail/:code', async (req, reply) => {
    const code = req.params.code;
    const detail = await dbService.getDetail(code);

    if (!detail) {
      return reply.status(404).send({ error: `Không tìm thấy mã HS ${code}` });
    }

    // Lấy cây phân cấp cha (4 số, 6 số) và các mã liên quan cùng nhóm để làm internal linking SEO
    const [hierarchy, related] = await Promise.all([
      dbService.getHierarchy(detail.hs_code),
      dbService.getRelated(detail.heading, detail.hs_code, 8),
    ]);

    return {
      item: detail,
      hierarchy,
      related,
    };
  });

  // API 3: Thống kê cơ sở dữ liệu
  // GET /api/hs/stats
  app.get('/api/hs/stats', async () => {
    const stats = await dbService.getStats();
    return {
      success: true,
      stats,
    };
  });

  return app;
}

export async function startApiServer(): Promise<void> {
  const app = createApiServer();
  const port = config.api.port || 3001;

  try {
    await app.listen({ port, host: '0.0.0.0' });
    console.log(`🌐 HS Code REST API Server đang lắng nghe tại: http://0.0.0.0:${port}`);
  } catch (err) {
    console.error('❌ Lỗi khởi động API Server:', err);
  }
}
