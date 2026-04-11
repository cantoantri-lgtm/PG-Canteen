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
  ocrErrors?: any[];
  onScanComplete: (newCartItems: CartItem[], newPendingItems: PendingOcrItem[], imageFile: File) => void;
  disabled?: boolean;
}

export default function Scanbill({ products, productAliases, ocrErrors = [], onScanComplete, disabled }: ScanbillProps) {
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
        toast.error('Lỗi cấu hình: Không tìm thấy API Key. Vui lòng kiểm tra lại cấu hình.');
        clearInterval(progressInterval);
        setIsScanning(false);
        return;
      }
      const ai = new GoogleGenAI({ apiKey });
      
      const uniqueCategories = Array.from(new Set(products.map(p => p.category_name).filter(Boolean)));
      const categoryList = uniqueCategories.length > 0 ? uniqueCategories.join(', ') : 'Băng vệ sinh, Tã bỉm trẻ em, Tã người lớn, Khăn ướt, Bông tẩy trang';
      
      // SỬA LỖI 1: Tinh chỉnh lại Prompt, loại bỏ các từ cấm đoán quá mạnh, thêm ví dụ thực tế.
      const promptText = `Bạn là hệ thống AI chuyên trích xuất dữ liệu hóa đơn siêu thị.

NHIỆM VỤ: 
Trích xuất TẤT CẢ các sản phẩm có trên hóa đơn.
Với mỗi sản phẩm, hãy phân loại xem nó thuộc ngành hàng nào trong danh sách sau: [${categoryList}]. Nếu không thuộc ngành hàng nào trong danh sách, hãy xếp vào loại "Khác".

HƯỚNG DẪN BÓC TÁCH GIÁ (CRITICAL):
Phải lấy đúng ĐƠN GIÁ (Unit Price) của 1 sản phẩm. KHÔNG lấy Thành tiền.
Cấu trúc hóa đơn thường hiển thị theo cặp dòng: 
- Dòng trên: [Tên Sản Phẩm]
- Dòng dưới: [Số lượng]      [Đơn giá]      [Thành tiền]

Ví dụ:
"BVS Diana Sensicool ko canh 8m"
"2,00      22.000      44.000"
-> Kết quả: raw_name: "BVS Diana Sensicool ko canh 8m", qty: 2, unit_price: 22000, category: "Băng vệ sinh"

ĐỊNH DẠNG ĐẦU RA:
Trả về JSON với 'raw_name' (giữ nguyên từng chữ cái trên bill), 'qty' (số lượng), 'unit_price' (đơn giá), và 'category' (ngành hàng).`;

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
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
                unit_price: { type: Type.NUMBER },
                category: { type: Type.STRING }
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
        if (item.category === 'Khác' || !uniqueCategories.includes(item.category)) {
          continue; // Bỏ qua không đúng ngành hàng
        }

        const matchResult = matchProduct(item.raw_name, item.unit_price, products, productAliases);

        // Lọc bỏ các gợi ý đã được xác nhận là sai 2 lần trở lên
        if (matchResult.product_id) {
          const isConfirmedError = ocrErrors.some(err => 
            err.raw_name.toLowerCase() === item.raw_name.trim().toLowerCase() && 
            err.suggested_product_id === matchResult.product_id
          );
          if (isConfirmedError) {
            matchResult.product_id = null;
            matchResult.matchType = 'none';
          }
        }

        if (matchResult.suggestions && matchResult.suggestions.length > 0) {
          matchResult.suggestions = matchResult.suggestions.filter(sugg => {
            return !ocrErrors.some(err => 
              err.raw_name.toLowerCase() === item.raw_name.trim().toLowerCase() && 
              err.suggested_product_id === sugg.product_id
            );
          });
        }

        if (matchResult.matchType === 'exact' || matchResult.matchType === 'fuzzy_high') {
          const matchedProduct = products.find(p => p.product_id === matchResult.product_id);
          if (matchedProduct) {
            newCartItems.push({
              product_id: matchedProduct.product_id,
              product_name: matchedProduct.product_name,
              product_group_name: matchedProduct.product_group_name,
              qty: item.qty || 1,
              net_value: (item.unit_price || matchedProduct.value) * (item.qty || 1), 
              item_type: (matchedProduct.item_type === 'Sản phẩm bán' ? 'Bán hàng' : matchedProduct.item_type) as 'Bán hàng' | 'Quà tặng' | 'Mẫu thử',
              switched_from_brand: null
            });
          }
        } else {
          // SỬA LỖI 2 & 3: Xử lý mọi trường hợp còn lại (fuzzy_low, none) thay vì bỏ qua
          let suggestions = matchResult.suggestions || [];

          // Nếu hàm matchProduct trả về mảng rỗng, tự động tính toán Top 10 dựa trên tên và giá
          if (suggestions.length === 0) {
            const rawWords = item.raw_name.toLowerCase().split(/[ \-\+]+/); // Cắt chuỗi thành các từ
            
            const scoredProducts = products.map(p => {
              let score = 0;
              const pName = p.product_name.toLowerCase();
              
              // 1. Cộng điểm nếu trùng từ khóa (ưu tiên từ khóa dài > 2 ký tự)
              rawWords.forEach(word => {
                if (word.length > 2 && pName.includes(word)) score += 15;
              });

              // 2. Trừ điểm nếu lệch giá (Càng lệch giá càng bị trừ nhiều điểm)
              const priceDiff = Math.abs(p.value - (item.unit_price || 0));
              score -= (priceDiff / 5000); // Ví dụ: lệch 5k bị trừ 1 điểm

              return { ...p, score };
            });

            // Lấy ra Top 10 sản phẩm có điểm số cao nhất
            suggestions = scoredProducts
              .sort((a, b) => b.score - a.score)
              .slice(0, 10)
              .map(p => ({
                product_id: p.product_id,
                product_name: p.product_name,
                product_group_name: p.product_group_name,
                value: p.value
              }));
          } else {
            // Đảm bảo suggestions trả về từ hàm lấy tối đa 10
            suggestions = suggestions.slice(0, 10);
          }

          // Đẩy vào danh sách Pending để PG kiểm tra thủ công
          newPendingItems.push({
            original_name: item.raw_name,
            qty: item.qty || 1,
            price: item.unit_price || 0,
            suggestions: suggestions,
            selected_product_id: suggestions[0]?.product_id || ''
          });
        }
      }

      onScanComplete(newCartItems, newPendingItems, file);
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
        toast.error('Server đang quá tải. Thử lại sau 5 giây', { duration: 5000 });
      } else if (errorMsg.includes('429') || errorMsg.includes('quota') || errorMsg.includes('RESOURCE_EXHAUSTED')) {
        toast.error('Hệ thống AI đã hết lượt xử lý. Vui lòng thử lại sau ít phút', { duration: 5000 });
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