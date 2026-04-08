import { supabase } from '../lib/supabase';
import Fuse from 'fuse.js';

// --- ĐỊNH NGHĨA KIỂU DỮ LIỆU ---
interface Product {
  id: string;
  name: string;
  category?: string; // Tùy chọn: giúp lọc chính xác hơn nếu có
}

interface ProductAlias {
  id: string;
  product_id: string;
  alias_name: string;
  confirmed_count: number;
}

interface MatchResult {
  status: 'EXACT_MATCH' | 'HIGH_CONFIDENCE' | 'NEEDS_REVIEW' | 'NOT_FOUND';
  productId?: string;
  suggestions?: Product[];
}

/**
 * BƯỚC 1 & BƯỚC 2: XỬ LÝ SO KHỚP (MATCHING)
 * @param extractedName Chuỗi văn bản AI đọc được từ Bill (VD: "BVS D.Sensi B.Quan M-L")
 * @param allProducts Danh sách toàn bộ sản phẩm công ty
 * @param validAliases Danh sách các Alias đã được confirm >= 2 lần
 */
export async function matchProduct(
  extractedName: string, 
  allProducts: Product[], 
  validAliases: ProductAlias[]
): Promise<MatchResult> {
  
  const cleanExtractedName = extractedName.trim().toLowerCase();

  // ==========================================
  // BƯỚC 1: TRA CỨU CHÍNH XÁC (EXACT MATCH) TRONG TỪ ĐIỂN ALIAS
  // ==========================================
  const exactAliasMatch = validAliases.find(
    alias => alias.alias_name.toLowerCase() === cleanExtractedName && alias.confirmed_count >= 2
  );

  if (exactAliasMatch) {
    return { status: 'EXACT_MATCH', productId: exactAliasMatch.product_id };
  }

  // ==========================================
  // BƯỚC 2: SO KHỚP MỜ (FUZZY MATCHING BẰNG FUSE.JS)
  // ==========================================
  
  // Trộn Data: Tạo một list gộp cả tên gốc (Product) và tên gọi khác (Alias) để quét
  const searchPool = [
    ...allProducts.map(p => ({ id: p.id, textToSearch: p.name, type: 'original' })),
    ...validAliases.map(a => ({ id: a.product_id, textToSearch: a.alias_name, type: 'alias' }))
  ];

  // Cấu hình Fuse.js tối ưu cho tiếng Việt và tên sản phẩm viết tắt
  const fuseOptions = {
    keys: ['textToSearch'],
    includeScore: true,
    threshold: 0.4,       // Ngưỡng 0.4 để mở rộng vòng tìm kiếm ban đầu
    ignoreLocation: true, // Không quan trọng chữ xuất hiện ở đầu hay cuối chuỗi
    useExtendedSearch: true
  };

  const fuse = new Fuse(searchPool, fuseOptions);
  const results = fuse.search(cleanExtractedName);

  if (results.length === 0) {
    // Không khớp tí nào -> Đề xuất 3 sản phẩm mặc định hoặc rỗng
    return { status: 'NOT_FOUND', suggestions: allProducts.slice(0, 3) };
  }

  // Điểm của Fuse.js: 0 là hoàn hảo khớp 100%. 1 là sai hoàn toàn.
  // Yêu cầu của bạn: Khớp >= 85% -> Tương đương score <= 0.15 của Fuse.
  const bestMatch = results[0];

  if (bestMatch.score !== undefined && bestMatch.score <= 0.15) {
    // Khớp cao -> Tự động chốt
    return { status: 'HIGH_CONFIDENCE', productId: bestMatch.item.id };
  } else {
    // Khớp dưới 85% -> Lấy Top 3 ID duy nhất để PG tự chọn
    const uniqueProductIds = new Set<string>();
    const topSuggestions: Product[] = [];

    for (const result of results) {
      if (uniqueProductIds.has(result.item.id)) continue;
      
      const productObj = allProducts.find(p => p.id === result.item.id);
      if (productObj) {
        uniqueProductIds.add(productObj.id);
        topSuggestions.push(productObj);
      }

      if (topSuggestions.length === 3) break; // Chỉ lấy Top 3
    }

    return { status: 'NEEDS_REVIEW', suggestions: topSuggestions };
  }
}

/**
 * BƯỚC 3: GHI NHẬN HỌC TẬP (SELF-LEARNING OCR)
 * Gọi hàm này khi PG bấm nút "Xác nhận & Thêm vào giỏ"
 * @param extractedName Tên gốc AI đọc từ hóa đơn
 * @param finalProductId ID sản phẩm chuẩn PG đã chốt
 */
export async function learnAlias(extractedName: string, finalProductId: string): Promise<void> {
  const cleanAliasName = extractedName.trim().toLowerCase();

  try {
    // 1. Kiểm tra xem cặp (alias_name, product_id) này đã tồn tại chưa
    const { data: existingAlias, error: fetchError } = await supabase
      .from('product_aliases')
      .select('id, confirmed_count')
      .eq('alias_name', cleanAliasName)
      .eq('product_id', finalProductId)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') { // PGRST116 là mã lỗi 'Không tìm thấy dòng nào'
      throw fetchError;
    }

    if (existingAlias) {
      // 2. Đã tồn tại -> Tăng biến đếm (Củng cố độ tin cậy)
      const { error: updateError } = await supabase
        .from('product_aliases')
        .update({ confirmed_count: existingAlias.confirmed_count + 1 })
        .eq('id', existingAlias.id);
        
      if (updateError) throw updateError;
      console.log(`[OCR Learning] Tăng độ tin cậy cho: ${cleanAliasName}`);

    } else {
      // 3. Chưa tồn tại -> Tạo mới với confirmed_count = 1 (Chờ lần sau xác nhận tiếp mới thành chuẩn)
      const { error: insertError } = await supabase
        .from('product_aliases')
        .insert([{
          alias_name: cleanAliasName,
          product_id: finalProductId,
          confirmed_count: 1
        }]);

      if (insertError) throw insertError;
      console.log(`[OCR Learning] Học từ vựng mới: ${cleanAliasName}`);
    }

  } catch (error) {
    console.error('[OCR Learning Error] Lỗi khi cập nhật từ điển:', error);
    // Không nên throw error làm gián đoạn luồng bán hàng của PG
    // Việc học thất bại không quan trọng bằng việc tạo xong đơn hàng.
  }
}