import axios from 'axios';
import { Context } from 'grammy';
import { config } from '../config.js';
import { crawlArticle } from '../services/crawler.js';
import { processArticleWithAI, chatWithAI, generateEmbedding } from '../services/ai.js';
import { wpService } from '../services/wordpress.js';
import { dbService } from '../services/database.js';
import { importHsFromExcel } from '../services/hs-importer.js';
import { createPostActionsKeyboard, createPublishedKeyboard } from './keyboards.js';

export function isAuthorized(ctx: Context): boolean {
  const userId = ctx.from?.id;
  if (!userId) return false;
  return config.telegram.adminIds.includes(userId);
}

export async function handleStart(ctx: Context) {
  const userId = ctx.from?.id;
  const authorized = isAuthorized(ctx);

  if (!authorized) {
    await ctx.reply(
      `⛔ **Truy cập bị từ chối**\n\nBạn chưa được cấp quyền sử dụng bot này.\n\n🆔 **Telegram ID của bạn:** \`${userId}\`\n\nHãy thêm ID trên vào biến \`TELEGRAM_ADMIN_IDS\` trong file \`.env\` của máy chủ.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  await ctx.reply(
    `👋 **Chào mừng bạn đến với WordPress & HS Code AI Bot!**\n\n` +
      `Tôi hỗ trợ quản trị nội dung website **${config.wordpress.url || 'chưa cấu hình'}** và hệ thống Tra cứu Mã HS (pgvector).\n\n` +
      `📌 **Tính năng chính:**\n` +
      `• 🔗 **Gửi link bài viết:** Tự động cào, viết lại chuẩn SEO và tạo bài nháp lên WordPress.\n` +
      `• 🔍 **Tra cứu mã HS:** Gõ \`/hs <từ khóa hoặc mã số>\` (ví dụ: \`/hs tai nghe bluetooth\` hoặc \`/hs 8518\`).\n` +
      `• 📂 **Cập nhật Biểu thuế:** Kéo thả trực tiếp file Excel (\`.xlsx\`, \`.csv\`) vào chat để đồng bộ dữ liệu & Vector vào Database!\n\n` +
      `🛠 **Lệnh hữu ích:**\n` +
      `• /hs <từ khóa> - Tra cứu mã HS & thuế suất\n` +
      `• /hs_stats - Xem thống kê mã HS trong hệ thống\n` +
      `• /status - Kiểm tra trạng thái hệ thống (WP, AI, Database)\n` +
      `• /help - Hướng dẫn chi tiết`,
    { parse_mode: 'Markdown' }
  );
}

export async function handleHelp(ctx: Context) {
  if (!isAuthorized(ctx)) return;

  await ctx.reply(
    `📖 **HƯỚNG DẪN SỬ DỤNG BOT**\n\n` +
      `1️⃣ **Đăng bài tự động lên WordPress:**\n` +
      `Dán link bài viết trực tiếp vào khung chat (ví dụ: \`https://vnexpress.net/...\`).\n\n` +
      `2️⃣ **Tra cứu Mã HS & Thuế XNK:**\n` +
      `• Dùng lệnh: \`/hs <tên hàng hóa hoặc mã>\`\n` +
      `• Ví dụ:\n` +
      `  - \`/hs bình giữ nhiệt inox\`\n` +
      `  - \`/hs 85183010\`\n` +
      `Bot sẽ phân tích ngữ nghĩa AI và trả về biểu thuế (MFN, Form E, ATIGA, EVFTA, VAT).\n\n` +
      `3️⃣ **Cập nhật Biểu thuế Hải quan:**\n` +
      `• Gửi file Excel (\`.xlsx\`, \`.csv\`) biểu thuế vào đây.\n` +
      `• Bot sẽ tự động bóc tách, sinh Vector và cập nhật vào PostgreSQL pgvector.\n\n` +
      `4️⃣ **Lệnh hệ thống:**\n` +
      `• \`/status\` - Kiểm tra WordPress, AI, Database\n` +
      `• \`/hs_stats\` - Thống kê số lượng mã HS đã index`,
    { parse_mode: 'Markdown' }
  );
}

export async function handleStatus(ctx: Context) {
  if (!isAuthorized(ctx)) return;

  const waitMsg = await ctx.reply('⏳ Đang kiểm tra hệ thống...');

  const [wpStatus, dbStatus, stats] = await Promise.all([
    wpService.testConnection(),
    dbService.testConnection(),
    dbService.getStats().catch(() => ({ total: 0, chapters: 0, with_embeddings: 0 })),
  ]);

  const statusText =
    `📊 **TRẠNG THÁI HỆ THỐNG**\n\n` +
    `🌐 **WordPress Site:** ${config.wordpress.url || 'Chưa cấu hình'}\n` +
    `🔐 **Kết nối WordPress:** ${wpStatus.success ? '✅ ' + wpStatus.message + ` (${wpStatus.user})` : '❌ ' + wpStatus.message}\n` +
    `🐘 **PostgreSQL (pgvector):** ${dbStatus.success ? '✅ Sẵn sàng' : '❌ ' + dbStatus.message}\n` +
    `📦 **Dữ liệu Mã HS:** ${stats.total.toLocaleString()} mã (${stats.chapters} chương, ${stats.with_embeddings.toLocaleString()} vector AI)\n` +
    `🤖 **AI Provider:** ${config.ai.provider.toUpperCase()} (${config.ai.provider === 'gemini' ? config.ai.geminiModel : config.ai.openaiModel})\n` +
    `👥 **Quản trị viên được phép:** ${config.telegram.adminIds.length} người dùng\n` +
    `📑 **Trạng thái bài mặc định:** ${config.wordpress.defaultStatus.toUpperCase()}`;

  await ctx.api.editMessageText(ctx.chat!.id, waitMsg.message_id, statusText, {
    parse_mode: 'Markdown',
  });
}

export async function handleUrlMessage(ctx: Context) {
  if (!isAuthorized(ctx)) {
    await ctx.reply(
      `⛔ Bạn không có quyền sử dụng bot này. Telegram ID: \`${ctx.from?.id}\``,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const text = ctx.message?.text || '';
  const urlMatch = text.match(/https?:\/\/[^\s]+/);

  if (!urlMatch) {
    const lower = text.trim().toLowerCase();
    if (['hello', 'hi', 'alo', 'chào', 'xin chào', 'hey'].includes(lower)) {
      await ctx.reply(
        `👋 Chào bạn! Tôi là AI Bot hỗ trợ website **${config.wordpress.url || 'WordPress'}**.\n\n` +
          `📌 **Bạn có thể:**\n` +
          `• 🔗 **Dán link bài viết bất kỳ** để tôi cào nội dung, viết lại chuẩn SEO và tạo bài nháp trên web.\n` +
          `• 💬 **Trò chuyện / Hỏi đáp:** Hỏi tôi bất kỳ ý tưởng viết bài, SEO, nội dung website.\n` +
          `• 🛠 Gõ /status để kiểm tra kết nối, hoặc /help để xem hướng dẫn.`
      );
      return;
    }

    // Chat with AI
    await ctx.replyWithChatAction('typing');
    const reply = await chatWithAI(text);
    await ctx.reply(reply);
    return;
  }

  const url = urlMatch[0];
  const progressMsg = await ctx.reply(`🔍 **Bước 1/4:** Đang cào dữ liệu từ đường dẫn:\n_${url}_`, {
    parse_mode: 'Markdown',
  });

  try {
    // Step 1: Crawl
    const crawled = await crawlArticle(url);
    if (!crawled.content || crawled.content.length < 50) {
      throw new Error('Không thể trích xuất nội dung từ bài viết này.');
    }

    // Step 2: AI Rewrite
    await ctx.api.editMessageText(
      ctx.chat!.id,
      progressMsg.message_id,
      `✍️ **Bước 2/4:** AI đang viết lại bài viết & tối ưu SEO...`
    );

    const processed = await processArticleWithAI(crawled);

    // Step 3: Media Upload
    let featuredMediaId: number | undefined;
    if (crawled.image) {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        progressMsg.message_id,
        `🖼 **Bước 3/4:** Đang tải ảnh đại diện lên thư viện WordPress...`
      );
      featuredMediaId = await wpService.uploadMedia(crawled.image, processed.title);
    }

    // Step 4: Create WordPress Post
    await ctx.api.editMessageText(
      ctx.chat!.id,
      progressMsg.message_id,
      `📝 **Bước 4/4:** Đang tạo bài viết trên WordPress...`
    );

    const post = await wpService.createPost({
      title: processed.title,
      content: processed.content,
      excerpt: processed.excerpt,
      slug: processed.slug,
      status: config.wordpress.defaultStatus,
      featuredMediaId,
      categoryName: processed.category,
      tags: processed.tags,
    });

    // Remove progress message
    await ctx.api.deleteMessage(ctx.chat!.id, progressMsg.message_id).catch(() => {});

    // Send final result
    const caption =
      `🎉 **ĐÃ TẠO BÀI VIẾT THÀNH CÔNG!**\n\n` +
      `📌 **Tiêu đề mới:**\n*${processed.title}*\n\n` +
      `📂 **Chuyên mục:** ${processed.category}\n` +
      `🏷 **Thẻ (Tags):** ${processed.tags.join(', ') || 'Không có'}\n` +
      `📝 **Trạng thái:** ${post.status === 'publish' ? 'Đã xuất bản' : 'Bản nháp (Draft)'}\n` +
      `🌐 **Nguồn gốc:** ${crawled.sourceDomain}\n\n` +
      `💬 **Tóm tắt SEO:**\n_${processed.excerpt}_`;

    const keyboard = createPostActionsKeyboard(post.id, post.link);

    if (crawled.image) {
      await ctx.replyWithPhoto(crawled.image, {
        caption,
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
    } else {
      await ctx.reply(caption, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
    }
  } catch (error: any) {
    console.error('[Bot] Error processing article:', error);
    await ctx.api.editMessageText(
      ctx.chat!.id,
      progressMsg.message_id,
      `❌ **Đã xảy ra lỗi:** ${error.message || 'Không thể xử lý bài viết.'}\n\nVui lòng kiểm tra lại link hoặc thử lại sau.`
    );
  }
}

export async function handleCallbackQuery(ctx: Context) {
  if (!isAuthorized(ctx)) {
    await ctx.answerCallbackQuery({ text: '⛔ Bạn không có quyền thực hiện thao tác này!' });
    return;
  }

  const data = ctx.callbackQuery?.data;
  if (!data) return;

  const [action, idStr] = data.split(':');
  const postId = parseInt(idStr, 10);
  if (isNaN(postId)) return;

  if (action === 'publish') {
    try {
      await ctx.answerCallbackQuery({ text: '⏳ Đang xuất bản bài viết...' });
      const link = await wpService.publishPost(postId);

      await ctx.editMessageReplyMarkup({
        reply_markup: createPublishedKeyboard(link),
      });

      await ctx.reply(`🚀 **Bài viết #${postId} đã được xuất bản thành công!**\n🔗 [Xem bài viết](${link})`, {
        parse_mode: 'Markdown',
      });
    } catch (err: any) {
      await ctx.answerCallbackQuery({ text: `❌ Lỗi: ${err.message}` });
    }
  } else if (action === 'delete') {
    try {
      await ctx.answerCallbackQuery({ text: '🗑 Đang xóa bài viết...' });
      await wpService.deletePost(postId);
      await ctx.reply(`🗑 **Đã xóa bài viết nháp #${postId}.**`);
    } catch (err: any) {
      await ctx.answerCallbackQuery({ text: `❌ Lỗi khi xóa: ${err.message}` });
    }
  }
}

export async function handleHsCommand(ctx: Context) {
  if (!isAuthorized(ctx)) {
    await ctx.reply(`⛔ Bạn không có quyền sử dụng bot này.`);
    return;
  }

  const rawText = ctx.message?.text || '';
  const query = rawText.replace(/^\/hs(@\w+)?/i, '').trim();

  if (!query) {
    await ctx.reply(
      `📌 **Cách tra cứu mã HS:**\n` +
        `• Cú pháp: \`/hs <từ khóa hoặc mã số>\`\n` +
        `• Ví dụ:\n` +
        `  \`/hs tai nghe bluetooth\`\n` +
        `  \`/hs 85183010\`\n` +
        `  \`/hs bình chân không bằng inox\``,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const waitMsg = await ctx.reply(`🔍 Đang phân tích ngữ nghĩa & tra cứu: "_${query}_"...`, {
    parse_mode: 'Markdown',
  });

  try {
    const isCodeLike = /^[0-9.]+$/.test(query);
    let queryEmbedding: number[] | undefined;

    if (!isCodeLike && query.length >= 2) {
      try {
        queryEmbedding = await generateEmbedding(query);
      } catch (err) {
        console.warn('[Bot HS] Không tạo được vector, fallback text:', err);
      }
    }

    const results = await dbService.searchHybrid(query, queryEmbedding, 5);

    if (results.length === 0) {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        waitMsg.message_id,
        `❌ Không tìm thấy mã HS nào phù hợp với từ khóa: "*${query}*".\n\n💡 _Gợi ý: Thử tìm bằng từ khóa chung hơn hoặc mã nhóm 4 số._`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    let replyText = `🎯 **KẾT QUẢ TRA CỨU MÃ HS (${results.length})**\nTừ khóa: _"${query}"_\n\n`;

    results.forEach((item, idx) => {
      const matchBadge = item.match_type === 'exact' ? '🎯 Khớp 100%' : (item.match_type === 'semantic' ? `🧠 Ngữ nghĩa AI (${Math.round((item.similarity || 0) * 100)}%)` : '🔍 Từ khóa');
      replyText += `${idx + 1}️⃣ **Mã HS:** \`${item.hs_code}\` [${matchBadge}]\n`;
      replyText += `📋 **Mô tả:** ${item.name_vi}\n`;
      if (item.name_en) replyText += `🌐 **EN:** _${item.name_en}_\n`;
      replyText += `💰 **Thuế suất:**\n`;
      replyText += `   • NK Ưu đãi (MFN): **${item.tax_mfn || '0%'}** | VAT: **${item.tax_vat || '10%'}**\n`;
      if (item.tax_acfta) replyText += `   • Form E (TQ): **${item.tax_acfta}**\n`;
      if (item.tax_atiga) replyText += `   • Form D (ASEAN): **${item.tax_atiga}**\n`;
      if (item.tax_evfta) replyText += `   • EVFTA (EU): **${item.tax_evfta}**\n`;
      replyText += `🔗 [Xem chi tiết trên website](${config.wordpress.url}/ma-hs/${item.hs_code})\n\n`;
    });

    await ctx.api.editMessageText(ctx.chat!.id, waitMsg.message_id, replyText, {
      parse_mode: 'Markdown',
      link_preview_options: { is_disabled: true },
    });
  } catch (err: any) {
    console.error('[Bot HS] Error:', err);
    await ctx.api.editMessageText(
      ctx.chat!.id,
      waitMsg.message_id,
      `❌ Lỗi tra cứu: ${err.message}`
    );
  }
}

export async function handleHsStatsCommand(ctx: Context) {
  if (!isAuthorized(ctx)) return;

  const waitMsg = await ctx.reply('⏳ Đang lấy thống kê...');
  try {
    const stats = await dbService.getStats();
    await ctx.api.editMessageText(
      ctx.chat!.id,
      waitMsg.message_id,
      `📊 **THỐNG KÊ BIỂU THUẾ HẢI QUAN**\n\n` +
        `📦 **Tổng số mã HS:** ${stats.total.toLocaleString()} mã\n` +
        `📚 **Số chương hải quan:** ${stats.chapters} chương\n` +
        `🧠 **Vector Embedding AI:** ${stats.with_embeddings.toLocaleString()} vectors đã index\n` +
        `🐘 **Cơ sở dữ liệu:** PostgreSQL (pgvector HNSW Index)\n\n` +
        `💡 _Để nạp hoặc cập nhật thêm biểu thuế, hãy gửi file Excel (.xlsx) trực tiếp vào khung chat._`,
      { parse_mode: 'Markdown' }
    );
  } catch (err: any) {
    await ctx.api.editMessageText(ctx.chat!.id, waitMsg.message_id, `❌ Lỗi: ${err.message}`);
  }
}

export async function handleDocumentMessage(ctx: Context) {
  if (!isAuthorized(ctx)) {
    await ctx.reply(`⛔ Bạn không có quyền tải file lên bot này.`);
    return;
  }

  const doc = ctx.message?.document;
  if (!doc) return;

  const fileName = doc.file_name || 'unknown.xlsx';
  const isExcel = /\.(xlsx|xls|csv)$/i.test(fileName);

  if (!isExcel) {
    await ctx.reply(`⚠️ Vui lòng chỉ gửi file Excel Biểu thuế định dạng \`.xlsx\`, \`.xls\` hoặc \`.csv\`.`);
    return;
  }

  const statusMsg = await ctx.reply(
    `📥 **Đã nhận file:** \`${fileName}\` (${(doc.file_size ? doc.file_size / (1024 * 1024) : 0).toFixed(2)} MB)\n` +
      `⏳ Đang tải file về máy chủ và phân tích cấu trúc...`,
    { parse_mode: 'Markdown' }
  );

  try {
    // 1. Tải file từ Telegram server
    const file = await ctx.getFile();
    const downloadUrl = `https://api.telegram.org/file/bot${config.telegram.token}/${file.file_path}`;

    const response = await axios.get(downloadUrl, {
      responseType: 'arraybuffer',
      timeout: 120000,
    });
    const fileBuffer = Buffer.from(response.data);

    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      `📂 Đã tải file xong. Bắt đầu đọc dữ liệu & nạp vào PostgreSQL pgvector...`,
      { parse_mode: 'Markdown' }
    );

    // 2. Chạy quá trình import với callback cập nhật tiến trình
    let lastUpdateTime = 0;
    const summary = await importHsFromExcel(fileBuffer, {
      batchSize: 100,
      generateEmbeddings: true,
      onProgress: async (info) => {
        const now = Date.now();
        // Cập nhật Telegram mỗi 3 giây để tránh bị Telegram rate limit
        if (now - lastUpdateTime > 3000) {
          lastUpdateTime = now;
          const barLength = 10;
          const filled = Math.round((info.percent / 100) * barLength);
          const bar = '█'.repeat(filled) + '░'.repeat(barLength - filled);

          await ctx.api.editMessageText(
            ctx.chat!.id,
            statusMsg.message_id,
            `⏳ **Đang đồng bộ Biểu thuế vào pgvector:**\n` +
              `[${bar}] ${info.percent}%\n` +
              `📊 Tiến độ: ${info.current.toLocaleString()} / ${info.total.toLocaleString()} mã HS...`,
            { parse_mode: 'Markdown' }
          ).catch(() => {});
        }
      },
    });

    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      `🎉 **ĐỒNG BỘ BIỂU THUẾ THÀNH CÔNG!**\n\n` +
        `📁 **File nguồn:** \`${fileName}\`\n` +
        `📦 **Mã HS đã nhập:** ${summary.importedRecords.toLocaleString()} mã\n` +
        `🧠 **Vector Embedding:** ${summary.withEmbeddings.toLocaleString()} vectors\n` +
        `⏱ **Thời gian xử lý:** ${(summary.durationMs / 1000).toFixed(1)} giây\n\n` +
        `👉 Giờ đây bạn có thể tra cứu ngay bằng lệnh: \`/hs <từ khóa>\` hoặc qua API website!`,
      { parse_mode: 'Markdown' }
    );
  } catch (err: any) {
    console.error('[Bot File Upload Error]:', err);
    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      `❌ **Lỗi khi xử lý file:** ${err.message || 'Không thể đọc file Excel.'}\n\nVui lòng kiểm tra lại cấu trúc file.`
    );
  }
}
