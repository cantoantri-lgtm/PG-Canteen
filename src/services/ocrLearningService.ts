import { supabase } from '../lib/supabase';
import Fuse from 'fuse.js';

/**
 * Bước 1 & 2: Tra cứu và so khớp mờ sản phẩm từ tên trích xuất trên hóa đơn
 * @param extracted_name Chuỗi văn bản trích xuất từ bill
 * @param products Danh sách sản phẩm chuẩn từ bảng products
 * @param aliases Danh sách alias từ bảng product_aliases
 * @returns Object chứa kết quả match (matchType, product_id, suggestions)
 */
export const matchProduct = (extracted_name: string, products: any[], aliases: any[]) => {
  try {
    const normalizedExtractedName = extracted_name.trim().toLowerCase();

    // ==========================================
    // BƯỚC 1: Tra cứu chính xác (Exact Match) từ RAM (Alias đã được duyệt)
    // ==========================================
    // Giả lập status 'APPROVED' bằng confirmed_count >= 2
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
    // BƯỚC 2: So khớp mờ (Fuzzy Matching với Fuse.js) - 2 Lớp
    // ==========================================
    
    // Lớp 1: Tìm Top 5 Nhóm sản phẩm gần giống nhất
    const uniqueGroups = Array.from(new Set(products.map(p => p.product_group_name).filter(Boolean)));
    const groupFuseData = uniqueGroups.map(name => ({ name }));
    
    const groupFuse = new Fuse(groupFuseData, {
      includeScore: true,
      threshold: 0.8, // Ngưỡng lỏng hơn để bắt nhóm
      keys: ['name']
    });

    const groupResults = groupFuse.search(normalizedExtractedName);
    const top5Groups = groupResults.slice(0, 5).map(r => r.item.name);

    // Nếu không tìm thấy nhóm nào, lấy tất cả sản phẩm để fallback
    let candidateProducts = products;
    if (top5Groups.length > 0) {
      candidateProducts = products.filter(p => top5Groups.includes(p.product_group_name));
    }

    // Lớp 2: Tìm Top 3 Sản phẩm sát nghĩa nhất trong các nhóm đã lọc
    const productFuseData = candidateProducts.map(p => ({
      product_id: p.product_id,
      search_term: p.product_name ? `${p.product_group_name} ${p.product_name}` : p.product_group_name,
      original_product: p
    }));

    const productFuse = new Fuse(productFuseData, {
      includeScore: true,
      threshold: 0.8, // Ngưỡng tìm kiếm
      keys: ['search_term'],
      ignoreLocation: true
    });

    const productResults = productFuse.search(normalizedExtractedName);

    if (productResults.length > 0) {
      const bestMatch = productResults[0];
      
      // Phân tích điểm (Score của Fuse.js: 0 là khớp hoàn toàn, 1 là không khớp)
      // Score < 0.1 tương đương độ khớp > 90%
      if (bestMatch.score !== undefined && bestMatch.score < 0.1) {
        return {
          matchType: 'fuzzy_high',
          product_id: bestMatch.item.product_id,
          suggestions: []
        };
      } else {
        // Nếu độ khớp < 90%, trả về danh sách Top 3 sản phẩm gợi ý
        const uniqueProductIds = Array.from(
          new Set(productResults.map(r => r.item.product_id))
        ).slice(0, 3);
        
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

    // Nếu rỗng (không khớp tí nào)
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
      // (Tương đương với việc update status = 'APPROVED' khi count >= 2)
      const { error: updateError } = await supabase
        .from('product_aliases')
        .update({ confirmed_count: existingAlias.confirmed_count + 1 })
        .eq('id', existingAlias.id);
        
      if (updateError) {
        console.error('Lỗi khi cập nhật confirmed_count:', updateError);
        throw updateError;
      }
    } else {
      // Nếu CHƯA tồn tại -> INSERT mới với confirmed_count = 1 (Tương đương status = 'PENDING')
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
