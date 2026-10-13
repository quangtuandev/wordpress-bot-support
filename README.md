# WordPress AI Telegram Support Bot 🤖📰

> Bot Telegram thông minh: Tự động cào dữ liệu từ đường dẫn bài viết bất kỳ, dùng AI (Google Gemini / OpenAI) viết lại bài độc bản chuẩn SEO và đẩy thẳng vào WordPress dưới dạng bản nháp kèm ảnh đại diện & tags tự động.

---

## 🌟 Tính năng chính

- 🚀 **Cào bài viết bằng 1 chạm:** Chỉ cần gửi link bài viết (báo chí, blog trong nước & quốc tế) vào khung chat Telegram.
- 🧹 **Tự động làm sạch dữ liệu:** Loại bỏ quảng cáo, rác, bình luận, trích xuất chính xác tiêu đề, nội dung và ảnh đại diện bài viết.
- ✍️ **AI Rewriter & SEO Expert (Gemini / OpenAI):**
  - Viết lại bài mới 100% độc bản (tránh trùng lặp nội dung gây phạt SEO).
  - Giữ vững các số liệu, dữ kiện, tên người/địa điểm.
  - Tự động dịch và bản địa hóa nếu nguồn là tiếng nước ngoài.
  - Tạo thẻ tiêu đề hấp dẫn, meta description (excerpt), slug thân thiện và gợi ý category/tags.
- 🖼 **Tự động đồng bộ ảnh vào Media Library:** Tải ảnh đại diện về và re-upload lên WordPress để không bị lỗi chết link ảnh (hotlink block).
- 🔐 **Bảo mật tuyệt đối:** Chỉ Telegram User ID của Admin (được cấu hình trong `.env`) mới có thể gửi lệnh cho bot.
- 📱 **Tương tác trực quan:** Nút bấm xem trước (Preview), Xuất bản ngay (Publish) hoặc Xóa bản nháp (Delete) trực tiếp từ Telegram.

---

## 🛠 Hướng dẫn lấy các thông tin cấu hình (.env)

Mở file `.env` và điền các thông tin sau:

### 1. Telegram Bot Token & Admin ID
1. Mở Telegram, tìm kiếm **`@BotFather`** -> Gõ `/newbot` và làm theo hướng dẫn để lấy **Token** (Dạng: `123456789:ABCdefGHI...`).
2. Tìm kiếm **`@userinfobot`** trên Telegram -> Gõ bất kỳ tin nhắn nào để lấy **ID** của bạn (Dạng số: `123456789`). Điền vào `TELEGRAM_ADMIN_IDS`.

### 2. Google Gemini API Key (Khuyên dùng)
- Truy cập [Google AI Studio](https://aistudio.google.com/app/apikey).
- Bấm **Create API Key** -> Copy key và dán vào `GEMINI_API_KEY`. (Gemini 2.5 Flash vừa rất nhanh vừa có gói miễn phí thoải mái sử dụng).

### 3. WordPress REST API (Application Password)
- Đăng nhập vào trang quản trị **WordPress Admin**.
- Vào **Thành viên (Users)** > **Hồ sơ của bạn (Profile)**.
- Cuộn xuống phần **Mật khẩu ứng dụng (Application Passwords)**.
- Đặt tên cho ứng dụng (ví dụ: `TelegramBot`) -> Bấm **Thêm mật khẩu ứng dụng mới**.
- WordPress sẽ tạo chuỗi mật khẩu dạng `xxxx xxxx xxxx xxxx`.
- Copy chuỗi đó dán vào `WP_APP_PASSWORD`.
- Điền tên đăng nhập WordPress vào `WP_USERNAME` và đường dẫn website vào `WP_URL` (ví dụ: `https://tenmiencuaban.com`).

---

## 🚀 Cài đặt & Chạy ứng dụng

### Chạy trực tiếp (Local / VPS với Node.js 20+)

```bash
# 1. Cài đặt thư viện
npm install

# 2. Biên dịch TypeScript
npm run build

# 3. Chạy môi trường phát triển
npm run dev

# 4. Hoặc chạy môi trường Production
npm run prod
```

### Chạy bằng PM2 (Khuyên dùng trên VPS)

```bash
# Cài PM2 nếu chưa có
npm install -g pm2

# Build source
npm run build

# Khởi động với ecosystem
pm2 start ecosystem.config.cjs

# Xem log
pm2 logs wordpress-bot-support

# Lưu lại tiến trình khởi động cùng hệ thống
pm2 save
pm2 startup
```

### Chạy bằng Docker & Docker Compose

```bash
# Khởi động container chạy ngầm
docker compose up -d --build

# Xem log bot
docker compose logs -f
```

---

## 📋 Lệnh điều khiển Bot trên Telegram

- `/start` - Khởi động và kiểm tra quyền sử dụng.
- `/status` - Kiểm tra tình trạng kết nối tới WordPress và AI.
- `/help` - Xem hướng dẫn chi tiết cách thức cào và duyệt bài.
- `[Gửi link URL]` - Bắt đầu tự động cào bài, viết lại và đăng lên WordPress.

---

## 📄 License
MIT © [quangtuandev](https://github.com/quangtuandev)
