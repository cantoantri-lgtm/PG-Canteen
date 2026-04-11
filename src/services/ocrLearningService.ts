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
    // BƯỚC 2: TÌM KIẾM THEO TRỌNG SỐ (WEIGHTED MATCHING)
    // ==========================================
    // Trọng số: Nhãn hàng 40%, Nhóm hàng 30%, Tên sản phẩm 30%
    const rawWords = normalizedExtractedName.split(/[\s\-\+]+/);

    const scoredCandidates = products.map(product => {
      let textScore = 0; // Điểm càng cao càng tốt (Max 1.0)

      // 1. Brand (40%)
      if (product.brand_name) {
        const brandLower = product.brand_name.toLowerCase();
        if (normalizedExtractedName.includes(brandLower)) {
          textScore += 0.4;
        } else {
          const brandWords = brandLower.split(/[\s\-\+]+/);
          const matched = brandWords.filter((w: string) => rawWords.includes(w)).length;
          textScore += (matched / brandWords.length) * 0.4;
        }
      }

      // 2. Group (30%)
      if (product.product_group_name) {
        const groupLower = product.product_group_name.toLowerCase();
        if (normalizedExtractedName.includes(groupLower)) {
          textScore += 0.3;
        } else {
          const groupWords = groupLower.split(/[\s\-\+]+/);
          const matched = groupWords.filter((w: string) => rawWords.includes(w)).length;
          textScore += (matched / groupWords.length) * 0.3;
        }
      }

      // 3. Name (30%)
      if (product.product_name) {
        const nameLower = product.product_name.toLowerCase();
        const nameWords = nameLower.split(/[\s\-\+]+/);
        const matched = nameWords.filter((w: string) => rawWords.includes(w)).length;
        textScore += (matched / nameWords.length) * 0.3;
      }

      const dbPrice = product.value || 0;
      const priceDiff = Math.abs(dbPrice - billPrice);

      return {
        ...product,
        textScore,
        priceDiff
      };
    });

    // Lọc bỏ những sản phẩm có điểm textScore quá thấp (ví dụ < 0.1) để tránh nhiễu
    const validCandidates = scoredCandidates.filter(c => c.textScore >= 0.1);

    if (validCandidates.length > 0) {
      // ==========================================
      // BƯỚC 3: PHÂN LỌC VÀ SẮP XẾP
      // ==========================================
      // Sắp xếp: Ưu tiên điểm textScore cao nhất. Nếu điểm bằng nhau, ưu tiên lệch giá ít nhất.
      validCandidates.sort((a, b) => {
        // Nếu điểm textScore chênh lệch rõ rệt (ví dụ > 0.1), ưu tiên textScore
        if (Math.abs(b.textScore - a.textScore) > 0.1) {
          return b.textScore - a.textScore;
        }
        // Nếu điểm textScore tương đương, ưu tiên giá sát nhất
        if (Math.abs(a.priceDiff - b.priceDiff) > 1000) {
          return a.priceDiff - b.priceDiff;
        }
        // Nếu giá cũng tương đương, vẫn ưu tiên textScore
        return b.textScore - a.textScore;
      });

      const bestCandidate = validCandidates[0];

      // Đánh giá kết quả cuối cùng
      // Nếu lệch giá rất thấp (< 15%) VÀ chữ khá giống (>= 0.7) -> Chốt luôn
      const priceDiffRatio = bestCandidate.value ? bestCandidate.priceDiff / bestCandidate.value : 1;
      
      if (priceDiffRatio <= 0.15 && bestCandidate.textScore >= 0.7) {
        return {
          matchType: 'fuzzy_high',
          product_id: bestCandidate.product_id,
          suggestions: []
        };
      } else {
        // Nếu không quá chắc chắn, trả về Top 10 sản phẩm gần đúng nhất cho PG chọn
        const uniqueSuggestions = validCandidates
          .slice(0, 10)
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

/**
 * Ghi nhận các trường hợp OCR sai hoặc PG bác bỏ gợi ý
 * @param raw_name Tên trích xuất từ bill
 * @param suggested_id ID sản phẩm AI đã gợi ý (nếu có)
 * @param pg_id ID của nhân viên PG
 * @param price Giá trên bill
 * @param qty Số lượng trên bill
 */
export const logOcrError = async (raw_name: string, suggested_id: string | null, pg_id: string, price: number, qty: number) => {
  try {
    const normalizedName = raw_name.trim().toLowerCase();
    
    // Kiểm tra xem lỗi này đã từng tồn tại chưa
    const { data: existingError } = await supabase
      .from('ocr_errors')
      .select('id, confirmed_error_count')
      .eq('raw_name', normalizedName)
      .eq('suggested_product_id', suggested_id)
      .maybeSingle();

    if (existingError) {
      // Nếu đã tồn tại, tăng số lần xác nhận sai
      await supabase
        .from('ocr_errors')
        .update({ 
          confirmed_error_count: (existingError.confirmed_error_count || 1) + 1,
          last_reported_at: new Date().toISOString()
        })
        .eq('id', existingError.id);
    } else {
      // Nếu chưa có, tạo mới
      const { error } = await supabase
        .from('ocr_errors')
        .insert({
          raw_name: normalizedName,
          suggested_product_id: suggested_id,
          pg_id: pg_id,
          price: price || 0,
          qty: qty || 1,
          confirmed_error_count: 1,
          created_at: new Date().toISOString()
        });
      
      if (error) {
        if (error.message.includes('relation "ocr_errors" does not exist')) {
          console.warn('Bảng ocr_errors chưa được tạo trong Database.');
        } else {
          throw error;
        }
      }
    }
    return true;
  } catch (error) {
    console.error('Lỗi khi ghi nhận lỗi OCR (logOcrError):', error);
    return false;
  }
};
