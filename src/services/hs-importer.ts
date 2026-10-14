import { createRequire } from 'module';
import { dbService, HsCodeRecord } from './database.js';
import { generateEmbeddingsBatch } from './ai.js';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

export interface ImportOptions {
  batchSize?: number;
  generateEmbeddings?: boolean;
  onProgress?: (info: { current: number; total: number; percent: number; message: string }) => Promise<void> | void;
}

export interface ImportSummary {
  totalRows: number;
  importedRecords: number;
  withEmbeddings: number;
  durationMs: number;
}

export async function importHsFromExcel(
  fileInput: string | Buffer,
  options: ImportOptions = {}
): Promise<ImportSummary> {
  const startTime = Date.now();
  const batchSize = options.batchSize || 50;
  const generateEmbeddings = options.generateEmbeddings !== false;

  console.log('[HS Importer] Bắt đầu đọc file Excel...');
  const wb = typeof fileInput === 'string'
    ? XLSX.readFile(fileInput)
    : XLSX.read(fileInput, { type: 'buffer' });

  // Tìm sheet Biểu thuế (ưu tiên 'BT2026' hoặc sheet đầu tiên)
  let sheetName = wb.SheetNames.find((s: string) => s.toUpperCase().includes('BT202') || s.toUpperCase() === 'BT');
  if (!sheetName) sheetName = wb.SheetNames[0];

  console.log(`[HS Importer] Sử dụng Sheet: "${sheetName}"`);
  const ws = wb.Sheets[sheetName];
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });

  let headerRowIdx = -1;
  let colCode = 5;
  let colNameVi = 6;
  let colNameEn = 7;
  let colUnitVi = 8;
  let colUnitEn = 9;
  let colStandard = 10;
  let colMfn = 13;
  let colVat = 16;
  let colAcfta = 19;
  let colAtiga = 22;
  let colAjcep = 25;
  let colVjepa = 28;
  let colAkfta = 31;
  let colAanzfta = 34;
  let colAifta = 37;
  let colVkfta = 40;
  let colCptpp = 49;
  let colEvfta = 58;
  let colUkvfta = 61;
  let colRcep = 73;
  let colSpecialConsumption = 84;
  let colExport = 87;
  let colEnvironmental = 99;
  let colPolicy = 102;
  let colVatReduction = 103;

  // Tự động nhận diện dòng header
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const row = rows[i];
    if (row && Array.isArray(row)) {
      const rowStr = row.join(' ').toLowerCase();
      if (rowStr.includes('mã hàng') || rowStr.includes('mô tả hàng')) {
        headerRowIdx = i;
        row.forEach((cell, idx) => {
          if (!cell) return;
          const c = String(cell).toLowerCase().replace(/\s+/g, ' ').trim();
          if (c === 'mã hàng') colCode = idx;
          else if (c.includes('mô tả') && c.includes('việt')) colNameVi = idx;
          else if (c.includes('mô tả') && c.includes('anh')) colNameEn = idx;
          else if (c.includes('đơn vị')) colUnitVi = idx;
          else if (c.includes('unit of quantity')) colUnitEn = idx;
          else if (c === 'nk tt' || c.includes('thông thường')) colStandard = idx;
          else if (c === 'nk ưu đãi' || c.includes('mfn')) colMfn = idx;
          else if (c === 'vat') colVat = idx;
          else if (c === 'acfta') colAcfta = idx;
          else if (c === 'atiga') colAtiga = idx;
          else if (c === 'ajcep') colAjcep = idx;
          else if (c === 'vjepa') colVjepa = idx;
          else if (c === 'akfta') colAkfta = idx;
          else if (c === 'aanzfta') colAanzfta = idx;
          else if (c === 'aifta') colAifta = idx;
          else if (c === 'vkfta') colVkfta = idx;
          else if (c === 'cptpp') colCptpp = idx;
          else if (c === 'evfta') colEvfta = idx;
          else if (c === 'ukvfta') colUkvfta = idx;
          else if (c.startsWith('rcep')) colRcep = idx;
          else if (c === 'tt đb') colSpecialConsumption = idx;
          else if (c === 'xk') colExport = idx;
          else if (c.includes('thuế bv mt')) colEnvironmental = idx;
          else if (c.includes('chính sách')) colPolicy = idx;
          else if (c.includes('giảm vat')) colVatReduction = idx;
        });
        break;
      }
    }
  }

  const startRow = headerRowIdx >= 0 ? headerRowIdx + 1 : 4;
  console.log(`[HS Importer] Header ở dòng ${headerRowIdx}, bắt đầu duyệt từ dòng ${startRow}`);

  let currentChapter = '01';
  let currentHeading = '0101';
  let currentHeadingNameVi = '';
  let currentSubheadingNameVi = '';
  const recordsToInsert: HsCodeRecord[] = [];

  const cleanVal = (val: any): string | undefined => {
    if (val === undefined || val === null) return undefined;
    const s = String(val).trim();
    return s.length > 0 ? s : undefined;
  };

  for (let i = startRow; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    // Kiểm tra dòng chương
    const rowText = row.slice(0, 10).join(' ');
    const chapterMatch = rowText.match(/chương\s*([0-9]{1,2})/i);
    if (chapterMatch) {
      currentChapter = chapterMatch[1].padStart(2, '0');
    }

    const rawCode = row[colCode];
    const rawNameVi = String(row[colNameVi] || '').trim();

    // Nếu là dòng tiêu đề phân nhóm không có mã HS nhưng có mô tả bắt đầu bằng '-'
    if (!rawCode && rawNameVi.startsWith('-')) {
      const cleanSub = rawNameVi.replace(/^[-+\s]+/, '').replace(/:$/, '').trim();
      if (cleanSub && !cleanSub.toLowerCase().startsWith('loại khác')) {
        currentSubheadingNameVi = cleanSub;
      }
      continue;
    }

    if (!rawCode) continue;

    const cleanCode = String(rawCode).replace(/[^0-9]/g, '').trim();
    if (!cleanCode || cleanCode.length < 2) continue;
    if (!rawNameVi) continue;

    const chapter = cleanCode.slice(0, 2) || currentChapter;
    const heading = cleanCode.length >= 4 ? cleanCode.slice(0, 4) : currentHeading;

    if (cleanCode.length === 4) {
      currentHeading = cleanCode;
      currentHeadingNameVi = rawNameVi.replace(/^[-+\s]+/, '').replace(/:$/, '').trim();
      currentSubheadingNameVi = '';
    } else if (cleanCode.length === 6) {
      const cleanSub = rawNameVi.replace(/^[-+\s]+/, '').replace(/:$/, '').trim();
      if (!cleanSub.toLowerCase().startsWith('loại khác')) {
        currentSubheadingNameVi = cleanSub;
      }
    }

    // Làm giàu ngữ cảnh cho các dòng mô tả chung chung (như "- - Loại khác")
    let enrichedNameVi = rawNameVi;
    const strippedName = rawNameVi.replace(/^[-+\s]+/, '').toLowerCase();
    if (
      cleanCode.length >= 6 &&
      (strippedName.startsWith('loại khác') || strippedName.length < 18)
    ) {
      const parentContext = currentSubheadingNameVi || currentHeadingNameVi;
      if (parentContext) {
        const shortParent = parentContext.length > 120 ? parentContext.slice(0, 120) + '...' : parentContext;
        enrichedNameVi = `${rawNameVi} (${shortParent})`;
      }
    }

    const record: HsCodeRecord = {
      hs_code: cleanCode,
      chapter,
      heading,
      subheading: cleanCode.length >= 6 ? cleanCode.slice(0, 6) : undefined,
      name_vi: enrichedNameVi,
      name_en: cleanVal(row[colNameEn]),
      unit_vi: cleanVal(row[colUnitVi]),
      unit_en: cleanVal(row[colUnitEn]),
      tax_standard: cleanVal(row[colStandard]),
      tax_mfn: cleanVal(row[colMfn]),
      tax_vat: cleanVal(row[colVat]),
      tax_acfta: cleanVal(row[colAcfta]),
      tax_atiga: cleanVal(row[colAtiga]),
      tax_ajcep: cleanVal(row[colAjcep]),
      tax_vjepa: cleanVal(row[colVjepa]),
      tax_akfta: cleanVal(row[colAkfta]),
      tax_aanzfta: cleanVal(row[colAanzfta]),
      tax_aifta: cleanVal(row[colAifta]),
      tax_vkfta: cleanVal(row[colVkfta]),
      tax_cptpp: cleanVal(row[colCptpp]),
      tax_evfta: cleanVal(row[colEvfta]),
      tax_ukvfta: cleanVal(row[colUkvfta]),
      tax_rcep: cleanVal(row[colRcep]),
      tax_special_consumption: cleanVal(row[colSpecialConsumption]),
      tax_export: cleanVal(row[colExport]),
      tax_environmental: cleanVal(row[colEnvironmental]),
      policy_note: cleanVal(row[colPolicy]),
      vat_reduction_note: cleanVal(row[colVatReduction]),
    };

    recordsToInsert.push(record);
  }

  const total = recordsToInsert.length;
  console.log(`[HS Importer] Đã lọc được ${total} mã HS hợp lệ. Bắt đầu nạp vào Database...`);

  let importedCount = 0;
  let withEmbeddingsCount = 0;

  for (let i = 0; i < total; i += batchSize) {
    const chunk = recordsToInsert.slice(i, i + batchSize);

    // Tạo vector embedding cho batch (chỉ ưu tiên mã 4 số, 6 số và 8 số)
    if (generateEmbeddings) {
      const textsToEmbed = chunk.map(
        (r) => `Mã HS ${r.hs_code}: ${r.name_vi}${r.name_en ? ' - ' + r.name_en : ''}`
      );

      try {
        const embeddings = await generateEmbeddingsBatch(textsToEmbed);
        chunk.forEach((r, idx) => {
          if (embeddings[idx] && embeddings[idx].length > 0) {
            r.embedding = embeddings[idx];
            withEmbeddingsCount++;
          }
        });
      } catch (err: any) {
        console.warn(`[HS Importer] Lỗi tạo vector ở batch ${i}: ${err.message}`);
      }
    }

    // Lưu batch vào PostgreSQL pgvector
    await dbService.upsertBatch(chunk);
    importedCount += chunk.length;

    const percent = Math.min(100, Math.round((importedCount / total) * 100));
    const msg = `Đã đồng bộ ${importedCount}/${total} mã HS (${percent}%)...`;

    if (options.onProgress) {
      await options.onProgress({
        current: importedCount,
        total,
        percent,
        message: msg,
      });
    }

    if (importedCount % 500 === 0 || importedCount === total) {
      console.log(`[HS Importer] ${msg}`);
    }
  }

  const durationMs = Date.now() - startTime;
  console.log(`✅ [HS Importer] Hoàn tất nạp ${importedCount} mã HS trong ${(durationMs / 1000).toFixed(1)}s!`);

  return {
    totalRows: rows.length,
    importedRecords: importedCount,
    withEmbeddings: withEmbeddingsCount,
    durationMs,
  };
}
