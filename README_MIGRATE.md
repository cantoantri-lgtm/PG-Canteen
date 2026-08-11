# Hướng dẫn di chuyển ảnh từ Supabase sang Cloudinary

Do dự án Supabase bị khóa vì vượt quá dung lượng, quá trình tự động tải ảnh hiện tại bị chặn (gây ra lỗi 404/400).

Để lấy lại và đưa các ảnh này sang Cloudinary, bạn làm theo 2 bước:

**Bước 1: Mở khóa Supabase Storage**
1. Bấm nút **Contact Support** trong Supabase.
2. Nhờ họ mở khóa Storage tạm thời 24h để bạn "backup data and clear storage".
3. (Hoặc nâng cấp tạm gói Pro để mở khóa ngay, tải xong thì hạ cấp).

**Bước 2: Chạy Script tự động migrate**
Ngay khi Supabase mở khóa (link cũ truy cập lại được), mở Terminal/CMD tại thư mục dự án và chạy:
```bash
node migrate_to_cloudinary.js
```
Script sẽ tự động:
- Lấy các đơn hàng còn dùng link `supabase.co`.
- Tải ảnh về và đẩy thẳng lên Cloudinary của bạn.
- Cập nhật Database bằng link Cloudinary mới.
