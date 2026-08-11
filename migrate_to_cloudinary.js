import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || 'https://vrrbqykaowhebmlxawhc.supabase.co',
  process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZycmJxeWthb3doZWJtbHhhd2hjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzMTg5NDcsImV4cCI6MjA4OTg5NDk0N30.YbDqPA4L_KbxkDymgp064gu0FUW06Jm_7FSMjVrQhnA'
);

const cloudName = process.env.VITE_CLOUDINARY_CLOUD_NAME;
const uploadPreset = process.env.VITE_CLOUDINARY_UPLOAD_PRESET;

if (!cloudName || !uploadPreset) {
  console.error("Vui lòng thiết lập VITE_CLOUDINARY_CLOUD_NAME và VITE_CLOUDINARY_UPLOAD_PRESET trong file .env");
  process.exit(1);
}

async function uploadUrlToCloudinary(imageUrl) {
  // Cloudinary API supports fetching a remote URL and uploading it directly!
  // BUT the URL must be publicly accessible. Since Supabase is locked, Cloudinary's servers might get blocked (400/404)
  // Let's download it to memory first, then upload it.
  try {
    const res = await fetch(imageUrl);
    if (!res.ok) throw new Error(`Lỗi tải ảnh từ Supabase: ${res.status} ${res.statusText}`);
    const blob = await res.blob();
    
    const formData = new FormData();
    formData.append('file', blob);
    formData.append('upload_preset', uploadPreset);
    
    const uploadRes = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
      method: 'POST',
      body: formData
    });
    
    if (!uploadRes.ok) {
      const errData = await uploadRes.json();
      throw new Error(`Lỗi upload Cloudinary: ${errData.error?.message}`);
    }
    const data = await uploadRes.json();
    return data.secure_url;
  } catch (error) {
    console.error(`Lỗi xử lý URL ${imageUrl}:`, error.message);
    return null; // Return null if failed
  }
}

async function main() {
  console.log("Bắt đầu quá trình migration ảnh từ Supabase sang Cloudinary...");
  
  // Lấy tất cả đơn hàng có link ảnh Supabase
  const { data: orders, error } = await supabase
    .from('orders')
    .select('id, bill_image_url')
    .like('bill_image_url', '%supabase.co%');
    
  if (error) {
    console.error("Lỗi lấy danh sách orders:", error);
    return;
  }
  
  if (!orders || orders.length === 0) {
    console.log("Không tìm thấy ảnh Supabase nào cần migrate trong database.");
    return;
  }
  
  console.log(`Tìm thấy ${orders.length} đơn hàng chứa link Supabase. Đang tiến hành xử lý...`);
  
  let successCount = 0;
  let failCount = 0;
  
  for (const order of orders) {
    const urls = order.bill_image_url.split(',');
    const newUrls = [];
    let hasError = false;
    
    for (const url of urls) {
      if (url.includes('supabase.co')) {
        const newUrl = await uploadUrlToCloudinary(url);
        if (newUrl) {
          newUrls.push(newUrl);
        } else {
          hasError = true;
          newUrls.push(url); // Keep old URL if failed
        }
      } else {
        newUrls.push(url); // Already not Supabase
      }
    }
    
    const newBillImageUrl = newUrls.join(',');
    
    if (newBillImageUrl !== order.bill_image_url && !hasError) {
      // Update database
      const { error: updateError } = await supabase
        .from('orders')
        .update({ bill_image_url: newBillImageUrl })
        .eq('id', order.id);
        
      if (updateError) {
        console.error(`Lỗi cập nhật order ${order.id}:`, updateError);
        failCount++;
      } else {
        console.log(`✅ Cập nhật thành công order ${order.id}`);
        successCount++;
      }
    } else if (hasError) {
      failCount++;
      console.log(`❌ Bỏ qua order ${order.id} do lỗi tải/upload ảnh.`);
    }
  }
  
  console.log(`\nHoàn tất migration! Thành công: ${successCount}, Thất bại: ${failCount}`);
}

main();
