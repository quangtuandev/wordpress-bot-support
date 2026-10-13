import { Context } from 'grammy';
import { config } from '../config.js';
import { crawlArticle } from '../services/crawler.js';
import { processArticleWithAI, chatWithAI } from '../services/ai.js';
import { wpService } from '../services/wordpress.js';
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
    `👋 **Chào mừng bạn đến với WordPress AI Bot!**\n\n` +
      `Tôi là trợ lý tự động hóa nội dung cho website: **${config.wordpress.url || 'chưa cấu hình'}**.\n\n` +
      `📌 **Cách sử dụng:**\n` +
      `• Chỉ cần gửi bất kỳ link bài viết nào (VnExpress, Cafebiz, báo quốc tế...).\n` +
      `• Bot sẽ tự động cào bài, viết lại 100% chuẩn SEO, tải ảnh lên WordPress và tạo bài nháp.\n\n` +
      `🛠 **Lệnh hữu ích:**\n` +
      `• /status - Kiểm tra trạng thái kết nối WordPress & AI\n` +
      `• /help - Hướng dẫn sử dụng chi tiết`,
    { parse_mode: 'Markdown' }
  );
}

export async function handleHelp(ctx: Context) {
  if (!isAuthorized(ctx)) return;

  await ctx.reply(
    `📖 **HƯỚNG DẪN SỬ DỤNG**\n\n` +
      `1️⃣ **Chuyển bài viết tự động:**\n` +
      `Dán link bài viết trực tiếp vào khung chat (ví dụ: \`https://vnexpress.net/...\`).\n\n` +
      `2️⃣ **Quy trình xử lý của Bot:**\n` +
      `• Bóc tách tiêu đề, nội dung và ảnh đại diện bài gốc.\n` +
      `• AI (${config.ai.provider.toUpperCase()} - ${config.ai.provider === 'gemini' ? config.ai.geminiModel : config.ai.openaiModel}) viết lại toàn bộ nội dung theo văn phong chuyên nghiệp, chuẩn SEO.\n` +
      `• Tự động tải ảnh đại diện lên WordPress Media Library.\n` +
      `• Tạo bài viết nháp trên WordPress kèm danh mục & thẻ tag tự động.\n\n` +
      `3️⃣ **Duyệt bài:**\n` +
      `• Bấm "👁 Xem bài viết" để xem trước trên website.\n` +
      `• Bấm "🚀 Xuất bản ngay" để public bài viết ngay lập tức.`,
    { parse_mode: 'Markdown' }
  );
}

export async function handleStatus(ctx: Context) {
  if (!isAuthorized(ctx)) return;

  const waitMsg = await ctx.reply('⏳ Đang kiểm tra hệ thống...');

  const wpStatus = await wpService.testConnection();

  const statusText =
    `📊 **TRẠNG THÁI HỆ THỐNG**\n\n` +
    `🌐 **WordPress Site:** ${config.wordpress.url || 'Chưa cấu hình'}\n` +
    `🔐 **Kết nối WordPress:** ${wpStatus.success ? '✅ ' + wpStatus.message + ` (${wpStatus.user})` : '❌ ' + wpStatus.message}\n` +
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
