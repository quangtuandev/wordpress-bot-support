import { InlineKeyboard } from 'grammy';

export function createPostActionsKeyboard(postId: number, previewUrl: string): InlineKeyboard {
  return new InlineKeyboard()
    .url('👁 Xem bài viết', previewUrl)
    .text('🚀 Xuất bản ngay', `publish:${postId}`)
    .row()
    .text('🗑 Xóa bài nháp', `delete:${postId}`);
}

export function createPublishedKeyboard(postUrl: string): InlineKeyboard {
  return new InlineKeyboard().url('🌐 Mở bài viết trên web', postUrl);
}
