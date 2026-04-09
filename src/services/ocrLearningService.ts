import { supabase } from '../lib/supabase';
import Fuse from 'fuse.js';

/**
 * Bước 1 & 2: Tra cứu và so khớp sản phẩm từ tên và giá trích xuất trên hóa đơn
 * @param extracted_name Chuỗi văn bản trích xuất từ bill (raw_name)
 * @param unit_price Đơn giá của sản phẩm trên bill
 * @param products Danh sách sản phẩm chuẩn từ bảng products
 * @param aliases Danh sách alias từ bảng product_aliases
 */
export const matchProduct = (extracted_name: string, unit_price: number, products: any[], aliases: any[]) => {
  try {
    if (!extracted_name) {
      return {
        matchType: 'none',
        product_id: null,
        suggestions: []
      };
    }
    const normalizedExtractedName = extracted_name.trim().toLowerCase();
    const billPrice = unit_price || 0;

    // ==========================================
    // BƯỚC 1: TRA CỨU TỪ LỊCH SỬ HỌC MÁY (ALIAS)
    // ==========================================
    // So khớp tên và đảm bảo giá trên bill không lệch quá 15% so với giá đã học
    const exactMatch = aliases.find(a => {
      const isNameMatch = a.alias_name.toLowerCase() === normalizedExtractedName;
      const isApproved = a.confirmed_count >= 2;
      
      // Nếu alias có lưu giá, kiểm tra xem giá bill có sát với giá học không (lệch tối đa 15%)
      let isPriceAcceptable = true;
      if (a.price && billPrice > 0) {
        const diffRatio = Math.abs(a.price - billPrice) / a.price;
        isPriceAcceptable = diffRatio <= 0.15;
      }

      return isNameMatch && isApproved && isPriceAcceptable;
    });

    if (exactMatch) {
      return {
        matchType: 'exact',
        product_id: exactMatch.product_id,
        suggestions: []
      };
    }

    // ==========================================
    // BƯỚC 2: TÌM KIẾM THEO CHỮ (FUZZY MATCH)
    // ==========================================
    // Ghép Brand + Group + Name để Fuse.js dễ tìm chữ "Diana" hoặc "BVS"
    const productFuseData = products.map(p => ({
      ...p,
      search_term: `${p.brand_name || ''} ${p.product_group_name || ''} ${p.product_name || ''}`.trim()
    }));

    const productFuse = new Fuse(productFuseData, {
      includeScore: true,
      threshold: 0.6, // Ngưỡng 0.6: Lọc ra tất cả những thằng có "vẻ" giống chữ trên bill
      keys: ['search_term'],
      ignoreLocation: true
    });

    const textResults = productFuse.search(normalizedExtractedName);

    if (textResults.length > 0) {
      // ==========================================
      // BƯỚC 3: PHÂN LỌC THEO PHÂN KHÚC GIÁ (PRICE SEGMENTING)
      // ==========================================
      const scoredCandidates = textResults.map(result => {
        const product = result.item;
        const textScore = result.score || 0; // Điểm chữ (càng nhỏ càng giống)
        const dbPrice = product.value || 0;
        
        // Tính độ lệch giá tuyệt đối (VND)
        const priceDiff = Math.abs(dbPrice - billPrice);

        return {
          ...product,
          textScore,
          priceDiff
        };
      });

      // Thuật toán sắp xếp: Ưu tiên ĐỘ LỆCH GIÁ NHỎ NHẤT lên Top 1
      scoredCandidates.sort((a, b) => {
        // Nếu giá của 2 sản phẩm chênh nhau không đáng kể (dưới 5000đ), thì ai khớp chữ hơn sẽ lên trên
        if (Math.abs(a.priceDiff - b.priceDiff) < 5000) {
          return a.textScore - b.textScore;
        }
        // Còn lại, thằng nào có giá sát với giá Bill nhất sẽ trồi lên
        return a.priceDiff - b.priceDiff;
      });

      const bestCandidate = scoredCandidates[0];

      // Đánh giá kết quả cuối cùng
      // Nếu lệch giá rất thấp (< 10%) VÀ chữ khá giống (< 0.3) -> Chốt luôn
      const priceDiffRatio = bestCandidate.value ? bestCandidate.priceDiff / bestCandidate.value : 1;
      
      if (priceDiffRatio <= 0.1 && bestCandidate.textScore <= 0.3) {
        return {
          matchType: 'fuzzy_high',
          product_id: bestCandidate.product_id,
          suggestions: []
        };
      } else {
        // Nếu không quá chắc chắn, trả về Top 5 phân khúc giá gần nhất cho PG chọn
        const uniqueSuggestions = scoredCandidates
          .slice(0, 5)
          .map(c => products.find(p => p.product_id === c.product_id))
          .filter(Boolean);

        return {
          matchType: 'fuzzy_low',
          product_id: null,
          suggestions: uniqueSuggestions
        };
      }
    }

    // Không tìm thấy gì
    return {
      matchType: 'none',
      product_id: null,
      suggestions: [] 
    };

  } catch (error) {
    console.error('Lỗi trong matchProduct:', error);
    return {
      matchType: 'error',
      product_id: null,
      suggestions: []
    };
  }
};


/**
 * Bước 4: Ghi nhận học tập (Xử lý khi PG chốt sản phẩm cuối cùng)
 * @param extracted_name Chuỗi văn bản trích xuất từ bill ban đầu
 * @param final_product_id ID sản phẩm cuối cùng do PG xác nhận
 * @param unit_price Đơn giá trên hóa đơn để lưu làm cơ sở phân khúc
 */
export const learnAlias = async (extracted_name: string, final_product_id: string, unit_price: number) => {
  try {
    const normalizedExtractedName = extracted_name.trim().toLowerCase();

    // Tìm xem PG đã từng map tên này với ID sản phẩm này chưa
    const { data: existingAlias, error: checkError } = await supabase
      .from('product_aliases')
      .select('id, confirmed_count')
      .eq('product_id', final_product_id)
      .ilike('alias_name', normalizedExtractedName)
      .maybeSingle();

    if (checkError) throw checkError;

    if (existingAlias) {
      // Đã từng map -> Tăng uy tín (confirmed_count) và cập nhật lại giá mới nhất
      const { error: updateError } = await supabase
        .from('product_aliases')
        .update({ 
          confirmed_count: existingAlias.confirmed_count + 1,
          price: unit_price // Cập nhật giá mới nhất từ hóa đơn
        })
        .eq('id', existingAlias.id);
        
      if (updateError) throw updateError;
    } else {
      // Chưa từng map -> Lưu mới
      const { error: insertError } = await supabase
        .from('product_aliases')
        .insert({
          product_id: final_product_id,
          alias_name: normalizedExtractedName,
          price: unit_price || 0, // Lưu giá vào Database
          confirmed_count: 1
        });
        
      if (insertError) throw insertError;
    }
    
    return true;
  } catch (error) {
    console.error('Lỗi khi ghi nhận học tập (learnAlias):', error);
    return false;
  }
};