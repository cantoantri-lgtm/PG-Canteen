import { supabase } from '../lib/supabase';
import Fuse from 'fuse.js';

/**
 * Bước 1 & 2: Tra cứu và so khớp mờ sản phẩm từ tên trích xuất trên hóa đơn
 * @param extracted_name Chuỗi văn bản trích xuất từ bill
 * @param products Danh sách sản phẩm chuẩn từ bảng products
 * @returns Object chứa kết quả match (matchType, product_id, suggestions)
 */
export const matchProduct = (extracted_name: string, products: any[], aliases: any[]) => {
  try {
    // Tiền xử lý chuỗi: Xóa khoảng trắng thừa, chuyển về chữ thường để so sánh tốt hơn
    const normalizedExtractedName = extracted_name.trim().toLowerCase();

    // ==========================================
    // BƯỚC 1: Tra cứu chính xác (Exact Match) từ RAM
    // ==========================================
    const exactMatch = aliases.find(
      a => a.alias_name.toLowerCase() === normalizedExtractedName && a.confirmed_count >= 2
    );

    if (exactMatch) {
      return {
        matchType: 'exact',
        product_id: exactMatch.product_id,
        suggestions: []
      };
    }

    // ==========================================
    // BƯỚC 2: So khớp mờ (Fuzzy Matching với Fuse.js)
    // ==========================================
    
    // Chuẩn bị dữ liệu cho Fuse.js: Gộp products chuẩn và các aliases đã được xác nhận
    const fuseData = [
      ...products.map(p => ({
        product_id: p.product_id,
        search_term: p.product_name
      })),
      ...(aliases || []).filter(a => a.confirmed_count >= 2).map(a => ({
        product_id: a.product_id,
        search_term: a.alias_name
      }))
    ];

    // Cấu hình Fuse.js hợp lý cho tiếng Việt
    const fuseOptions = {
      includeScore: true,
      threshold: 0.5, // Ngưỡng 0.5: Loại bỏ các sản phẩm hoàn toàn không liên quan (như Nước ngọt, Đá ly)
      keys: ['search_term'],
      ignoreLocation: true, // Tìm kiếm ở bất kỳ vị trí nào trong chuỗi
      useExtendedSearch: true,
    };

    const fuse = new Fuse(fuseData, fuseOptions);
    
    // Thực hiện tìm kiếm
    const searchResult = fuse.search(normalizedExtractedName);

    if (searchResult.length > 0) {
      const bestMatch = searchResult[0];
      
      // Phân tích điểm (Score của Fuse.js: 0 là khớp hoàn toàn, 1 là không khớp)
      // Điểm <= 0.15 tương đương độ khớp >= 85%
      if (bestMatch.score !== undefined && bestMatch.score <= 0.15) {
        return {
          matchType: 'fuzzy_high',
          product_id: bestMatch.item.product_id,
          suggestions: []
        };
      } else {
        // Nếu độ khớp < 85%, trả về danh sách Top 10 sản phẩm có điểm số cao nhất (gần đúng nhất)
        // Lọc bỏ các product_id trùng lặp để suggestions đa dạng
        const uniqueProductIds = Array.from(
          new Set(searchResult.map(r => r.item.product_id))
        ).slice(0, 10); // Chỉ lấy top 10 để PG đỡ rối
        
        const uniqueSuggestions = uniqueProductIds
          .map(id => products.find(p => p.product_id === id))
          .filter(Boolean);

        return {
          matchType: 'fuzzy_low',
          product_id: null,
          suggestions: uniqueSuggestions
        };
      }
    }

    // Nếu rỗng (không khớp tí nào - tức là sản phẩm rác/không bán)
    return {
      matchType: 'none',
      product_id: null,
      suggestions: [] 
    };

  } catch (error) {
    console.error('Lỗi không xác định trong matchProduct:', error);
    return {
      matchType: 'error',
      product_id: null,
      suggestions: []
    };
  }
};

/**
 * Bước 3: Ghi nhận học tập (Xử lý khi User chốt sản phẩm cuối cùng)
 * @param extracted_name Chuỗi văn bản trích xuất từ bill ban đầu
 * @param final_product_id ID sản phẩm cuối cùng do PG xác nhận
 */
export const learnAlias = async (extracted_name: string, final_product_id: string) => {
  try {
    const normalizedExtractedName = extracted_name.trim().toLowerCase();

    // Kiểm tra xem cặp (final_product_id, alias_name) đã tồn tại chưa
    const { data: existingAlias, error: checkError } = await supabase
      .from('product_aliases')
      .select('id, confirmed_count')
      .eq('product_id', final_product_id)
      .ilike('alias_name', normalizedExtractedName)
      .maybeSingle();

    if (checkError) {
      console.error('Lỗi khi kiểm tra alias tồn tại:', checkError);
      throw checkError;
    }

    if (existingAlias) {
      // Nếu ĐÃ tồn tại -> UPDATE tăng confirmed_count = confirmed_count + 1
      const { error: updateError } = await supabase
        .from('product_aliases')
        .update({ confirmed_count: existingAlias.confirmed_count + 1 })
        .eq('id', existingAlias.id);
        
      if (updateError) {
        console.error('Lỗi khi cập nhật confirmed_count:', updateError);
        throw updateError;
      }
    } else {
      // Nếu CHƯA tồn tại -> INSERT mới với confirmed_count = 1
      const { error: insertError } = await supabase
        .from('product_aliases')
        .insert({
          product_id: final_product_id,
          alias_name: normalizedExtractedName,
          confirmed_count: 1
        });
        
      if (insertError) {
        console.error('Lỗi khi thêm mới alias:', insertError);
        throw insertError;
      }
    }
    
    return true;
  } catch (error) {
    console.error('Lỗi khi ghi nhận học tập (learnAlias):', error);
    return false;
  }
};
