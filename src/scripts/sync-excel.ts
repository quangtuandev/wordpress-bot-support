import path from 'path';
import { importHsFromExcel } from '../services/hs-importer.js';
import { dbService } from '../services/database.js';

async function main() {
  console.log('====================================================');
  console.log('📦 HS Code Biểu Thuế Importer (Excel -> PostgreSQL)');
  console.log('====================================================');

  const defaultFile = path.resolve(process.cwd(), 'docs/BIEU THUE XNK 2026.04.05.xlsx');
  const filePath = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : defaultFile;
  const noEmbeddings = process.argv.includes('--no-embeddings');

  console.log(`📁 File nguồn: ${filePath}`);
  console.log(`🧠 Tạo Vector Embedding: ${noEmbeddings ? 'TẮT (--no-embeddings)' : 'BẬT'}`);

  const testConn = await dbService.testConnection();
  if (!testConn.success) {
    console.error('❌ Không thể kết nối Database:', testConn.message);
    process.exit(1);
  }
  console.log(`🐘 Database: ${testConn.message}`);

  const summary = await importHsFromExcel(filePath, {
    batchSize: 100,
    generateEmbeddings: !noEmbeddings,
    onProgress: (info) => {
      process.stdout.write(`\r⏳ Tiến độ: [${info.percent}%] ${info.current.toLocaleString()}/${info.total.toLocaleString()} mã HS...`);
    },
  });

  console.log('\n\n🎉 ĐỒNG BỘ HOÀN TẤT!');
  console.log(`- Tổng số dòng Excel: ${summary.totalRows.toLocaleString()}`);
  console.log(`- Mã HS đã nạp vào Database: ${summary.importedRecords.toLocaleString()}`);
  console.log(`- Vector Embedding đã tạo: ${summary.withEmbeddings.toLocaleString()}`);
  console.log(`- Thời gian xử lý: ${(summary.durationMs / 1000).toFixed(1)}s`);

  const stats = await dbService.getStats();
  console.log('\n📊 Thống kê hiện tại trong DB:');
  console.log(`- Tổng số mã HS: ${stats.total.toLocaleString()}`);
  console.log(`- Số chương: ${stats.chapters}`);
  console.log(`- Số vector: ${stats.with_embeddings.toLocaleString()}`);

  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ Lỗi khi import:', err);
  process.exit(1);
});
