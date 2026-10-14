import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

export interface HsCodeRecord {
  hs_code: string;
  chapter: string;
  heading: string;
  subheading?: string;
  name_vi: string;
  name_en?: string;
  unit_vi?: string;
  unit_en?: string;
  tax_standard?: string;
  tax_mfn?: string;
  tax_vat?: string;
  tax_acfta?: string; // Form E
  tax_atiga?: string; // Form D
  tax_ajcep?: string;
  tax_vjepa?: string;
  tax_akfta?: string;
  tax_aanzfta?: string;
  tax_aifta?: string;
  tax_vkfta?: string;
  tax_cptpp?: string;
  tax_evfta?: string;
  tax_ukvfta?: string;
  tax_rcep?: string;
  tax_special_consumption?: string;
  tax_export?: string;
  tax_environmental?: string;
  policy_note?: string;
  vat_reduction_note?: string;
  embedding?: number[];
}

export interface HsSearchResult {
  hs_code: string;
  chapter?: string;
  heading?: string;
  name_vi: string;
  name_en?: string;
  unit_vi?: string;
  tax_mfn?: string;
  tax_vat?: string;
  tax_acfta?: string;
  tax_atiga?: string;
  tax_evfta?: string;
  tax_cptpp?: string;
  tax_rcep?: string;
  policy_note?: string;
  vat_reduction_note?: string;
  similarity?: number;
  match_type: 'exact' | 'prefix' | 'semantic' | 'keyword';
}

class DatabaseService {
  private pool: pg.Pool | null = null;
  private isInitialized = false;

  getPool(): pg.Pool {
    if (!this.pool) {
      this.pool = new Pool({
        connectionString: config.database.url,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
      });

      this.pool.on('error', (err) => {
        console.error('[DB Pool Error]', err);
      });
    }
    return this.pool;
  }

  async testConnection(): Promise<{ success: boolean; message: string; count?: number }> {
    try {
      const client = await this.getPool().connect();
      try {
        const res = await client.query('SELECT current_database(), now();');
        await this.initSchema();
        const countRes = await client.query('SELECT count(*) FROM hs_codes;');
        const count = parseInt(countRes.rows[0].count, 10);
        return {
          success: true,
          message: `Kết nối thành công Database "${res.rows[0].current_database}"`,
          count,
        };
      } finally {
        client.release();
      }
    } catch (err: any) {
      return {
        success: false,
        message: `Lỗi kết nối DB: ${err.message}`,
      };
    }
  }

  async initSchema(): Promise<void> {
    if (this.isInitialized) return;
    const client = await this.getPool().connect();
    try {
      // 1. Kích hoạt extension vector
      await client.query('CREATE EXTENSION IF NOT EXISTS vector;');

      // 2. Tạo bảng hs_codes
      await client.query(`
        CREATE TABLE IF NOT EXISTS hs_codes (
          hs_code VARCHAR(30) PRIMARY KEY,
          chapter VARCHAR(10) NOT NULL,
          heading VARCHAR(10),
          subheading VARCHAR(10),
          name_vi TEXT NOT NULL,
          name_en TEXT,
          unit_vi TEXT,
          unit_en TEXT,
          tax_standard TEXT,
          tax_mfn TEXT,
          tax_vat TEXT,
          tax_acfta TEXT,
          tax_atiga TEXT,
          tax_ajcep TEXT,
          tax_vjepa TEXT,
          tax_akfta TEXT,
          tax_aanzfta TEXT,
          tax_aifta TEXT,
          tax_vkfta TEXT,
          tax_cptpp TEXT,
          tax_evfta TEXT,
          tax_ukvfta TEXT,
          tax_rcep TEXT,
          tax_special_consumption TEXT,
          tax_export TEXT,
          tax_environmental TEXT,
          policy_note TEXT,
          vat_reduction_note TEXT,
          embedding vector(768),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Đảm bảo các cột thuế và đơn vị đều là TEXT
      await client.query(`
        ALTER TABLE hs_codes 
          ALTER COLUMN unit_vi TYPE TEXT,
          ALTER COLUMN unit_en TYPE TEXT,
          ALTER COLUMN tax_standard TYPE TEXT,
          ALTER COLUMN tax_mfn TYPE TEXT,
          ALTER COLUMN tax_vat TYPE TEXT,
          ALTER COLUMN tax_acfta TYPE TEXT,
          ALTER COLUMN tax_atiga TYPE TEXT,
          ALTER COLUMN tax_ajcep TYPE TEXT,
          ALTER COLUMN tax_vjepa TYPE TEXT,
          ALTER COLUMN tax_akfta TYPE TEXT,
          ALTER COLUMN tax_aanzfta TYPE TEXT,
          ALTER COLUMN tax_aifta TYPE TEXT,
          ALTER COLUMN tax_vkfta TYPE TEXT,
          ALTER COLUMN tax_cptpp TYPE TEXT,
          ALTER COLUMN tax_evfta TYPE TEXT,
          ALTER COLUMN tax_ukvfta TYPE TEXT,
          ALTER COLUMN tax_rcep TYPE TEXT,
          ALTER COLUMN tax_special_consumption TYPE TEXT,
          ALTER COLUMN tax_export TYPE TEXT,
          ALTER COLUMN tax_environmental TYPE TEXT;
      `).catch(() => {});

      // 3. Tạo chỉ mục tối ưu tìm kiếm
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_hs_code_prefix ON hs_codes(hs_code text_pattern_ops);
        CREATE INDEX IF NOT EXISTS idx_hs_code_chapter ON hs_codes(chapter);
        CREATE INDEX IF NOT EXISTS idx_hs_code_heading ON hs_codes(heading);
        CREATE INDEX IF NOT EXISTS idx_hs_name_vi_gin ON hs_codes USING gin(to_tsvector('simple', name_vi));
      `);

      // HNSW index cho vector similarity search
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_hs_codes_hnsw ON hs_codes 
        USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64);
      `).catch(() => {
        // Nếu chưa đủ bộ nhớ hoặc bản ghi trống, có thể tạo sau
      });

      this.isInitialized = true;
      console.log('✅ PostgreSQL schema & pgvector đã được khởi tạo thành công.');
    } finally {
      client.release();
    }
  }

  async upsertBatch(records: HsCodeRecord[]): Promise<number> {
    if (records.length === 0) return 0;
    await this.initSchema();
    const client = await this.getPool().connect();

    try {
      await client.query('BEGIN');

      const query = `
        INSERT INTO hs_codes (
          hs_code, chapter, heading, subheading, name_vi, name_en,
          unit_vi, unit_en, tax_standard, tax_mfn, tax_vat,
          tax_acfta, tax_atiga, tax_ajcep, tax_vjepa, tax_akfta,
          tax_aanzfta, tax_aifta, tax_vkfta, tax_cptpp, tax_evfta,
          tax_ukvfta, tax_rcep, tax_special_consumption, tax_export,
          tax_environmental, policy_note, vat_reduction_note, embedding, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11,
          $12, $13, $14, $15, $16,
          $17, $18, $19, $20, $21,
          $22, $23, $24, $25,
          $26, $27, $28, $29, CURRENT_TIMESTAMP
        )
        ON CONFLICT (hs_code) DO UPDATE SET
          chapter = EXCLUDED.chapter,
          heading = EXCLUDED.heading,
          subheading = EXCLUDED.subheading,
          name_vi = EXCLUDED.name_vi,
          name_en = EXCLUDED.name_en,
          unit_vi = EXCLUDED.unit_vi,
          unit_en = EXCLUDED.unit_en,
          tax_standard = EXCLUDED.tax_standard,
          tax_mfn = EXCLUDED.tax_mfn,
          tax_vat = EXCLUDED.tax_vat,
          tax_acfta = EXCLUDED.tax_acfta,
          tax_atiga = EXCLUDED.tax_atiga,
          tax_ajcep = EXCLUDED.tax_ajcep,
          tax_vjepa = EXCLUDED.tax_vjepa,
          tax_akfta = EXCLUDED.tax_akfta,
          tax_aanzfta = EXCLUDED.tax_aanzfta,
          tax_aifta = EXCLUDED.tax_aifta,
          tax_vkfta = EXCLUDED.tax_vkfta,
          tax_cptpp = EXCLUDED.tax_cptpp,
          tax_evfta = EXCLUDED.tax_evfta,
          tax_ukvfta = EXCLUDED.tax_ukvfta,
          tax_rcep = EXCLUDED.tax_rcep,
          tax_special_consumption = EXCLUDED.tax_special_consumption,
          tax_export = EXCLUDED.tax_export,
          tax_environmental = EXCLUDED.tax_environmental,
          policy_note = EXCLUDED.policy_note,
          vat_reduction_note = EXCLUDED.vat_reduction_note,
          embedding = COALESCE(EXCLUDED.embedding, hs_codes.embedding),
          updated_at = CURRENT_TIMESTAMP;
      `;

      for (const r of records) {
        const embeddingStr = r.embedding ? `[${r.embedding.join(',')}]` : null;
        await client.query(query, [
          r.hs_code,
          r.chapter,
          r.heading || null,
          r.subheading || null,
          r.name_vi,
          r.name_en || null,
          r.unit_vi || null,
          r.unit_en || null,
          r.tax_standard || null,
          r.tax_mfn || null,
          r.tax_vat || null,
          r.tax_acfta || null,
          r.tax_atiga || null,
          r.tax_ajcep || null,
          r.tax_vjepa || null,
          r.tax_akfta || null,
          r.tax_aanzfta || null,
          r.tax_aifta || null,
          r.tax_vkfta || null,
          r.tax_cptpp || null,
          r.tax_evfta || null,
          r.tax_ukvfta || null,
          r.tax_rcep || null,
          r.tax_special_consumption || null,
          r.tax_export || null,
          r.tax_environmental || null,
          r.policy_note || null,
          r.vat_reduction_note || null,
          embeddingStr,
        ]);
      }

      await client.query('COMMIT');
      return records.length;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async searchHybrid(
    rawQuery: string,
    queryEmbedding?: number[],
    limit = 10
  ): Promise<HsSearchResult[]> {
    await this.initSchema();
    const client = await this.getPool().connect();

    try {
      const q = rawQuery.trim();
      const isCodeLike = /^[0-9.]+$/.test(q);
      const cleanCode = q.replace(/\./g, '');

      // 1. Nếu là dạng mã số: Tìm chính xác hoặc theo tiền tố
      if (isCodeLike) {
        const prefixRes = await client.query(
          `
          SELECT hs_code, chapter, heading, name_vi, name_en, unit_vi,
                 tax_mfn, tax_vat, tax_acfta, tax_atiga, tax_evfta, tax_cptpp, tax_rcep,
                 policy_note, vat_reduction_note
          FROM hs_codes
          WHERE hs_code = $1 OR hs_code LIKE $2
          ORDER BY CASE WHEN hs_code = $1 THEN 0 WHEN length(hs_code) = 8 THEN 1 ELSE 2 END, hs_code ASC
          LIMIT $3;
        `,
          [cleanCode, `${cleanCode}%`, limit]
        );

        if (prefixRes.rows.length > 0) {
          return prefixRes.rows.map((row) => ({
            ...row,
            match_type: row.hs_code === cleanCode ? 'exact' : 'prefix',
          }));
        }
      }

      // 2. Nếu có Vector Embedding trong DB: Tìm kiếm Ngữ nghĩa qua Cosine Distance
      let semanticResults: HsSearchResult[] = [];
      if (queryEmbedding && queryEmbedding.length > 0) {
        const embeddingStr = `[${queryEmbedding.join(',')}]`;
        const vectorRes = await client.query(
          `
          SELECT hs_code, chapter, heading, name_vi, name_en, unit_vi,
                 tax_mfn, tax_vat, tax_acfta, tax_atiga, tax_evfta, tax_cptpp, tax_rcep,
                 policy_note, vat_reduction_note,
                 1 - (embedding <=> $1) AS similarity
          FROM hs_codes
          WHERE embedding IS NOT NULL
          ORDER BY embedding <=> $1 ASC
          LIMIT $2;
        `,
          [embeddingStr, limit]
        );

        if (vectorRes.rows.length > 0) {
          semanticResults = vectorRes.rows.map((row) => ({
            ...row,
            similarity: parseFloat(row.similarity) || 0,
            match_type: 'semantic' as const,
          }));
        }
      }

      // 3. Tìm kiếm Kết hợp Cụm từ (Bigram) & Từ khóa thông minh (Smart Multi-word Search)
      const words = q
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 2);

      const bigrams: string[] = [];
      for (let i = 0; i < words.length - 1; i++) {
        bigrams.push(`${words[i]} ${words[i + 1]}`);
      }

      const params: any[] = [`%${q}%`];
      const scoreParts: string[] = [
        `CASE WHEN name_vi ILIKE $1 OR COALESCE(name_en, '') ILIKE $1 THEN 100 ELSE 0 END`,
      ];
      const whereParts: string[] = [
        `name_vi ILIKE $1`,
        `COALESCE(name_en, '') ILIKE $1`,
      ];

      // Cộng điểm cao cho các cụm 2 từ liên tiếp (ví dụ: "tai nghe", "bình giữ", "giữ nhiệt")
      for (const bg of bigrams) {
        params.push(`%${bg}%`);
        const pIdx = params.length;
        scoreParts.push(
          `CASE WHEN name_vi ILIKE $${pIdx} OR COALESCE(name_en, '') ILIKE $${pIdx} THEN 40 ELSE 0 END`
        );
        whereParts.push(`name_vi ILIKE $${pIdx}`);
        whereParts.push(`COALESCE(name_en, '') ILIKE $${pIdx}`);
      }

      // Cộng điểm cho từng từ đơn
      for (const w of words) {
        params.push(`%${w}%`);
        const pIdx = params.length;
        scoreParts.push(
          `CASE WHEN name_vi ILIKE $${pIdx} OR COALESCE(name_en, '') ILIKE $${pIdx} THEN 10 ELSE 0 END`
        );
        if (words.length === 1) {
          whereParts.push(`name_vi ILIKE $${pIdx}`);
          whereParts.push(`COALESCE(name_en, '') ILIKE $${pIdx}`);
        }
      }

      // Ưu tiên các mã 8 số có đầy đủ biểu thuế
      scoreParts.push(`CASE WHEN length(hs_code) = 8 THEN 6 ELSE 0 END`);

      params.push(limit);
      const limitIdx = params.length;

      const textSql = `
        SELECT hs_code, chapter, heading, name_vi, name_en, unit_vi,
               tax_mfn, tax_vat, tax_acfta, tax_atiga, tax_evfta, tax_cptpp, tax_rcep,
               policy_note, vat_reduction_note,
               (${scoreParts.join(' + ')}) AS text_score
        FROM hs_codes
        WHERE ${whereParts.join(' OR ')}
        ORDER BY text_score DESC, length(hs_code) DESC, hs_code ASC
        LIMIT $${limitIdx};
      `;

      const textRes = await client.query(textSql, params);
      const keywordResults: HsSearchResult[] = textRes.rows.map((row) => ({
        hs_code: row.hs_code,
        chapter: row.chapter,
        heading: row.heading,
        name_vi: row.name_vi,
        name_en: row.name_en,
        unit_vi: row.unit_vi,
        tax_mfn: row.tax_mfn,
        tax_vat: row.tax_vat,
        tax_acfta: row.tax_acfta,
        tax_atiga: row.tax_atiga,
        tax_evfta: row.tax_evfta,
        tax_cptpp: row.tax_cptpp,
        tax_rcep: row.tax_rcep,
        policy_note: row.policy_note,
        vat_reduction_note: row.vat_reduction_note,
        similarity: Math.min(0.99, (parseInt(row.text_score, 10) || 10) / 100),
        match_type: 'keyword' as const,
      }));

      // Gộp kết quả Semantic Vector và Keyword (loại bỏ trùng mã HS)
      if (semanticResults.length === 0) {
        return keywordResults;
      }

      const mergedMap = new Map<string, HsSearchResult>();
      for (const item of keywordResults) {
        mergedMap.set(item.hs_code, item);
      }
      for (const item of semanticResults) {
        if (!mergedMap.has(item.hs_code)) {
          mergedMap.set(item.hs_code, item);
        }
      }

      return Array.from(mergedMap.values()).slice(0, limit);
    } finally {
      client.release();
    }
  }

  async getDetail(hsCode: string): Promise<HsCodeRecord | null> {
    await this.initSchema();
    const client = await this.getPool().connect();
    try {
      const cleanCode = hsCode.replace(/\./g, '').trim();
      const res = await client.query('SELECT * FROM hs_codes WHERE hs_code = $1', [cleanCode]);
      if (res.rows.length === 0) return null;
      return res.rows[0];
    } finally {
      client.release();
    }
  }

  async getHierarchy(hsCode: string): Promise<Array<{ hs_code: string; name_vi: string; name_en?: string }>> {
    await this.initSchema();
    const client = await this.getPool().connect();
    try {
      const cleanCode = hsCode.replace(/\./g, '').trim();
      const prefixes: string[] = [];
      if (cleanCode.length >= 4) prefixes.push(cleanCode.substring(0, 4));
      if (cleanCode.length >= 6) prefixes.push(cleanCode.substring(0, 6));
      if (!prefixes.includes(cleanCode)) prefixes.push(cleanCode);

      const res = await client.query(
        `
        SELECT hs_code, name_vi, name_en
        FROM hs_codes
        WHERE hs_code = ANY($1::text[])
        ORDER BY length(hs_code) ASC;
      `,
        [prefixes]
      );
      return res.rows;
    } finally {
      client.release();
    }
  }

  async getRelated(heading: string, excludeCode: string, limit = 8): Promise<HsCodeRecord[]> {
    await this.initSchema();
    const client = await this.getPool().connect();
    try {
      const res = await client.query(
        `
        SELECT hs_code, name_vi, name_en, unit_vi, tax_mfn, tax_vat, tax_acfta, tax_atiga, tax_evfta
        FROM hs_codes
        WHERE heading = $1 AND hs_code != $2
        ORDER BY CASE WHEN length(hs_code) = 8 THEN 0 ELSE 1 END, hs_code ASC
        LIMIT $3;
      `,
        [heading, excludeCode, limit]
      );
      return res.rows;
    } finally {
      client.release();
    }
  }

  async getStats(): Promise<{ total: number; chapters: number; with_embeddings: number }> {
    await this.initSchema();
    const client = await this.getPool().connect();
    try {
      const res = await client.query(`
        SELECT 
          count(*) AS total,
          count(DISTINCT chapter) AS chapters,
          count(embedding) AS with_embeddings
        FROM hs_codes;
      `);
      return {
        total: parseInt(res.rows[0].total, 10),
        chapters: parseInt(res.rows[0].chapters, 10),
        with_embeddings: parseInt(res.rows[0].with_embeddings, 10),
      };
    } finally {
      client.release();
    }
  }
}

export const dbService = new DatabaseService();
