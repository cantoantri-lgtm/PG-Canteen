import React, { useState, useRef } from 'react';
import { Camera } from 'lucide-react';
import { GoogleGenAI, Type } from '@google/genai';
import { toast } from 'sonner';
import { matchProduct } from '../services/ocrLearningService';

interface Product {
  product_id: string;
  product_name: string;
  product_group_name: string;
  value: number;
  item_type?: 'NORMAL_PRODUCT' | 'Quà tặng' | 'Mẫu thử' | string;
  brand_name: string;
  category_name?: string;
}

interface CartItem {
  product_id: string;
  product_name: string;
  product_group_name: string;
  qty: number;
  net_value: number;
  item_type: 'Bán hàng' | 'Quà tặng' | 'Mẫu thử';
  switched_from_brand?: string | null;
}

interface PendingOcrItem {
  original_name: string;
  qty: number;
  price: number;
  suggestions: any[];
  selected_product_id?: string;
}

interface ScanbillProps {
  products: Product[];
  productAliases: any[];
  onScanComplete: (newCartItems: CartItem[], newPendingItems: PendingOcrItem[]) => void;
  disabled?: boolean;
}

// Hàm hỗ trợ: Xóa dấu tiếng Việt để so sánh chuỗi chính xác hơn
const removeAccents = (str: string) => {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
};

export default function Scanbill({ products, productAliases, onScanComplete, disabled }: ScanbillProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanStatus, setScanStatus] = useState('');

  const handleScanBill = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsScanning(true);
    setScanProgress(5);
    setScanStatus('Đang tải ảnh lên...');
    
    const progressInterval = setInterval(() => {
      setScanProgress(prev => {
        if (prev < 30) {
          setScanStatus('Đang phân tích hình ảnh...');
          return prev + 5;
        } else if (prev < 70) {
          setScanStatus('AI đang đọc dữ liệu...');
          return prev + 3;
        } else if (prev < 95) {
          setScanStatus('Đang trích xuất sản phẩm...');
          return prev + 1;
        }
        return prev;
      });
    }, 400);

    try {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      await new Promise((resolve) => (reader.onload = resolve));
      const base64Data = (reader.result as string).split(',')[1];

      const apiKey = import.meta.env.VITE_GOOGLE_API_KEY || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || "AIzaSyD2dAXp28io3QlkK0t1hIAAGKPoD7qhyq0";
      if (!apiKey || apiKey === "") {
        toast.error('Lỗi cấu hình: Không tìm thấy API Key.');
        clearInterval(progressInterval);
        setIsScanning(false);
        return;
      }
      const ai = new GoogleGenAI({ apiKey });
      
      const uniqueCategories = Array.from(new Set(products.map(p => p.category_name).filter(Boolean)));
      const categoryList = uniqueCategories.length > 0 ? uniqueCategories.join(', ') : 'Băng vệ sinh, Tã bỉm trẻ em, Tã người lớn, Khăn ướt, Bông tẩy trang';
      
      const promptText = `Bạn là hệ thống AI chuyên trích xuất dữ liệu hóa đơn siêu thị.

NHIỆM VỤ: 
Trích xuất TẤT CẢ các sản phẩm có khả năng thuộc các ngành hàng: [${categoryList}].
Lưu ý: Hóa đơn thường viết tắt rất nhiều (ví dụ: BVS, Ta quan, K.Uot, sz, m). Đừng bỏ sót chúng. Bỏ qua các mặt hàng thực phẩm tươi sống hoặc đồ gia dụng rõ ràng không liên quan.

HƯỚNG DẪN BÓC TÁCH GIÁ (CRITICAL):
Phải lấy đúng ĐƠN GIÁ (Unit Price) của 1 sản phẩm. KHÔNG lấy Thành tiền.
Cấu trúc hóa đơn thường hiển thị theo cặp dòng: 
- Dòng trên: [Tên Sản Phẩm]
- Dòng dưới: [Số lượng]      [Đơn giá]      [Thành tiền]

Ví dụ:
"BVS Diana Sensicool ko canh 8m"
"2,00      22.000      44.000"
-> Kết quả: raw_name: "BVS Diana Sensicool ko canh 8m", qty: 2, unit_price: 22000

ĐỊNH DẠNG ĐẦU RA:
Trả về JSON với 'raw_name' (giữ nguyên từng chữ cái trên bill), 'qty' (số lượng), và 'unit_price' (đơn giá).`;

      const response = await ai.models.generateContent({
        model: 'gemini-1.5-flash',
        contents: [
          {
            inlineData: {
              data: base64Data,
              mimeType: file.type,
            }
          },
          promptText
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                raw_name: { type: Type.STRING },
                qty: { type: Type.NUMBER },
                unit_price: { type: Type.NUMBER }
              }
            }
          }
        }
      });

      clearInterval(progressInterval);
      setScanProgress(100);
      setScanStatus('Hoàn tất!');

      const items = JSON.parse(response.text || '[]');
      
      if (items.length === 0) {
        toast.error('Không tìm thấy sản phẩm mục tiêu nào trong hóa đơn.');
        setIsScanning(false);
        return;
      }

      const newCartItems: CartItem[] = [];
      const newPendingItems: PendingOcrItem[] = [];

      for (const item of items) {
        const matchResult = matchProduct(item.raw_name, item.unit_price, products, productAliases);

        // Chỉ đưa thẳng vào giỏ hàng nếu thuật toán tự tin tuyệt đối
        if (matchResult.matchType === 'exact' || matchResult.matchType === 'fuzzy_high') {
          const matchedProduct = products.find(p => p.product_id === matchResult.product_id);
          if (matchedProduct) {
            newCartItems.push({
              product_id: matchedProduct.product_id,
              product_name: matchedProduct.product_name,
              product_group_name: matchedProduct.product_group_name,
              qty: item.qty || 1,
              net_value: (item.unit_price || matchedProduct.value) * (item.qty || 1), 
              item_type: (matchedProduct.item_type === 'Sản phẩm bán' ? 'Bán hàng' : matchedProduct.item_type) || 'Bán hàng',
              switched_from_brand: null
            });
          }
        } else {
          // THUẬT TOÁN ĐỀ XUẤT (FALLBACK) THÔNG MINH
          const rawNameNorm = removeAccents(item.raw_name.toLowerCase());
          const rawWords = rawNameNorm.split(/[ \-\+]+/);
          const itemUnitPrice = item.unit_price || 0;

          const scoredProducts = products.map(p => {
            let score = 0;
            const pNameNorm = removeAccents(p.product_name.toLowerCase());

            // 1. Chấm điểm từ khóa không dấu (bvs, quan, comfy...)
            rawWords.forEach(word => {
              if (word.length >= 2 && pNameNorm.includes(word)) {
                score += 20; 
              }
            });

            // 2. Chấm điểm giá: Xử lý khác biệt giữa Giá Gói và Giá Miếng
            if (p.value > 0 && itemUnitPrice > 0) {
              const ratio = itemUnitPrice / p.value;
              const nearestInt = Math.round(ratio); 
              
              // Nếu bill đang quét giá Lốc/Gói (VD: 44k / 22k = 2) -> Sai số dưới 10%
              if (nearestInt >= 1 && nearestInt <= 100 && Math.abs(ratio - nearestInt) < 0.1) {
                score += 15; // Thưởng điểm vì chắc chắn khớp đóng gói (1 gói 2 miếng, 4 miếng...)
              } else {
                // Trừ điểm nếu lệch giá quá xa và không theo quy luật
                const priceDiff = Math.abs(p.value - itemUnitPrice);
                score -= Math.min(15, priceDiff / 3000); 
              }
            }

            return { ...p, score };
          });

          // Lọc ra Top 5 sản phẩm liên quan nhất
          let bestSuggestions = scoredProducts
            .filter(p => p.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, 5)
            .map(p => ({
              product_id: p.product_id,
              product_name: p.product_name,
              product_group_name: p.product_group_name,
              value: p.value
            }));

          // Nếu thuật toán mới không tìm ra gì, mới dùng gợi ý của hàm matchProduct cũ
          if (bestSuggestions.length === 0 && matchResult.suggestions && matchResult.suggestions.length > 0) {
             bestSuggestions = matchResult.suggestions.slice(0, 5);
          }

          newPendingItems.push({
            original_name: item.raw_name,
            qty: item.qty || 1,
            price: itemUnitPrice,
            suggestions: bestSuggestions,
            selected_product_id: bestSuggestions[0]?.product_id || ''
          });
        }
      }

      onScanComplete(newCartItems, newPendingItems);
      setIsScanning(false);
      
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

    } catch (error: any) {
      clearInterval(progressInterval);
      setIsScanning(false);
      console.error('Lỗi quét hóa đơn:', error);
      
      const errorMsg = error.message || '';
      if (errorMsg.includes('503') || errorMsg.includes('high demand') || errorMsg.includes('UNAVAILABLE')) {
        toast.error('Server đang quá tải. Thử lại sau 5 giây');
      } else if (errorMsg.includes('429') || errorMsg.includes('quota') || errorMsg.includes('RESOURCE_EXHAUSTED')) {
        toast.error('Hệ thống AI đã hết lượt xử lý. Vui lòng thử lại sau ít phút');
      } else {
        toast.error('Lỗi khi quét hóa đơn. Vui lòng thử lại.');
      }
      
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <>
      <button 
        onClick={() => fileInputRef.current?.click()} 
        disabled={isScanning || disabled}
        className="flex-1 bg-purple-50 text-purple-700 py-3 rounded-xl font-bold hover:bg-purple-100 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
      >
        <Camera size={20} />
        {isScanning ? 'ĐANG QUÉT...' : 'QUÉT BILL'}
      </button>
      <input 
        type="file" 
        accept="image/*" 
        capture="environment" 
        ref={fileInputRef} 
        onChange={handleScanBill} 
        className="hidden" 
      />

      {isScanning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 flex flex-col items-center text-center">
            <div className="w-16 h-16 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center mb-4">
              <Camera size={32} className="animate-pulse" />
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-2">Đang xử lý hóa đơn</h3>
            <div className="w-full flex justify-between text-sm font-medium text-purple-800 mb-2">
              <span>{scanStatus}</span>
              <span>{scanProgress}%</span>
            </div>
            <div className="w-full bg-purple-100 rounded-full h-3 overflow-hidden">
              <div 
                className="bg-purple-600 h-3 rounded-full transition-all duration-300 ease-out" 
                style={{ width: `${scanProgress}%` }}
              ></div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}