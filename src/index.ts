import { Bot } from 'grammy';
import { config, validateConfig } from './config.js';
import {
  handleStart,
  handleHelp,
  handleStatus,
  handleUrlMessage,
  handleCallbackQuery,
  handleHsCommand,
  handleHsStatsCommand,
  handleDocumentMessage,
} from './bot/handlers.js';
import { startApiServer } from './api/server.js';

async function bootstrap() {
  console.log('----------------------------------------------------');
  console.log('🤖 WordPress & HS Code AI Bot (Crawling & pgvector)');
  console.log('----------------------------------------------------');

  const { valid, missing } = validateConfig();

  if (!valid) {
    console.error('⚠️  CẤU HÌNH CHƯA ĐẦY ĐỦ TRONG FILE .env:');
    missing.forEach((key) => console.error(`   - ${key}`));
    console.error('\n👉 Vui lòng mở file .env và điền đầy đủ các thông tin cần thiết trước khi khởi động bot.');
    console.error('   Xem file .env.example để biết định dạng chi tiết.\n');
    process.exit(1);
  }

  // Khởi động HTTP REST API Server cho Website & Tra cứu
  await startApiServer();

  const bot = new Bot(config.telegram.token);

  // Register commands
  bot.command('start', handleStart);
  bot.command('help', handleHelp);
  bot.command('status', handleStatus);
  bot.command('hs', handleHsCommand);
  bot.command('hs_stats', handleHsStatsCommand);

  // Register document handler (upload Excel/CSV biểu thuế)
  bot.on('message:document', handleDocumentMessage);

  // Register text handler (auto detect URLs / chat)
  bot.on('message:text', handleUrlMessage);

  // Register inline button callbacks
  bot.on('callback_query:data', handleCallbackQuery);

  // Global error handler
  bot.catch((err) => {
    console.error(`[Telegram Error] in update ${err.ctx.update.update_id}:`, err.error);
  });

  console.log(`🚀 Bot đang chạy... Đã cấp quyền cho ${config.telegram.adminIds.length} admin.`);
  console.log(`🌐 Website WordPress: ${config.wordpress.url}`);
  console.log(`🤖 AI Engine: ${config.ai.provider.toUpperCase()}`);

  bot.start({
    onStart: (botInfo) => {
      console.log(`✅ Kết nối Telegram thành công! Username: @${botInfo.username}`);
    },
  });
}

bootstrap().catch((err) => {
  console.error('Lỗi khởi động Bot:', err);
  process.exit(1);
});
