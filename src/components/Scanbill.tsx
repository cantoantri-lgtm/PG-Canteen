import React, { useState, useRef } from 'react';
import { Camera } from 'lucide-react';
import { GoogleGenAI, Type } from '@google/genai';
import { toast } from 'sonner';
import { matchProduct } from '../services/ocrLearningService';
import imageCompression from 'browser-image-compression';
import Tesseract from 'tesseract.js';

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

  const processBillFile = async (file: File) => {
    setIsScanning(true);
    setScanProgress(5);
    setScanStatus('Đang nén ảnh...');
    
    let progressInterval: NodeJS.Timeout;

    try {
      // 1. Nén ảnh ở máy khách
      const options = {
        maxSizeMB: 1,
        maxWidthOrHeight: 1920,
        useWebWorker: true
      };
      let compressedFile: File;
      try {
        compressedFile = await imageCompression(file, options);
      } catch (compressError) {
        console.warn('Lỗi nén ảnh, sử dụng ảnh gốc:', compressError);
        compressedFile = file;
      }
      
      setScanProgress(15);
      setScanStatus('Đang đọc văn bản (OCR)...');

      // 2. Áp dụng On-device OCR (Có xử lý lỗi để không làm sập toàn bộ quy trình)
      let ocrText = '';
      try {
        const worker = await Tesseract.createWorker('vie');
        const ret = await worker.recognize(compressedFile);
        ocrText = ret.data.text;
        await worker.terminate();
      } catch (ocrError) {
        console.warn('Lỗi On-device OCR (Tesseract), bỏ qua bước này:', ocrError);
        // Không throw error, tiếp tục dùng Gemini
      }

      setScanProgress(30);
      setScanStatus('Đang phân tích dữ liệu...');

      const uniqueCategories = Array.from(new Set(products.map(p => p.category_name).filter(Boolean)));
      const categoryList = uniqueCategories.length > 0 ? uniqueCategories.join(', ') : 'Băng vệ sinh, Tã bỉm trẻ em, Tã người lớn, Khăn ướt, Bông tẩy trang';

      // Thử phân tích nhanh bằng Regex (On-device parsing) nếu có ocrText
      const localFoundItems: any[] = [];
      let items = [];

      if (ocrText) {
        const lines = ocrText.split('\n').map(l => l.trim()).filter(Boolean);
        
        // Tìm kiếm các sản phẩm trong danh sách bằng cách so khớp chuỗi đơn giản
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].toLowerCase();
          for (const p of products) {
            const pName = p.product_name.toLowerCase();
            if (line.includes(pName) && pName.length > 5) {
              // Tìm giá ở dòng hiện tại hoặc dòng tiếp theo
              let price = p.value;
              let qty = 1;
              const nextLine = lines[i+1] || '';
              const numbers = (line + ' ' + nextLine).match(/\d+([.,]\d+)?/g);
              if (numbers) {
                // Tìm số gần với giá sản phẩm nhất
                const prices = numbers.map(n => parseFloat(n.replace(/,/g, ''))).filter(n => n > 1000);
                if (prices.length > 0) {
                  const closest = prices.reduce((prev, curr) => Math.abs(curr - p.value) < Math.abs(prev - p.value) ? curr : prev);
                  if (Math.abs(closest - p.value) < p.value * 0.5) {
                    price = closest;
                  }
                }
              }
              localFoundItems.push({
                raw_name: lines[i],
                qty: qty,
                unit_price: price,
                category: p.category_name || 'Khác'
              });
              break; // Đã tìm thấy sản phẩm trên dòng này
            }
          }
        }

        // Nếu tìm thấy sản phẩm rõ ràng, sử dụng luôn kết quả local để tiết kiệm API
        if (localFoundItems.length > 0 && localFoundItems.length >= lines.length * 0.1) {
          items = localFoundItems;
          setScanProgress(100);
          setScanStatus('Hoàn tất (On-device)!');
        }
      }

      if (items.length === 0) {
        // Nếu không tìm thấy hoặc bill phức tạp, gọi Gemini API
        progressInterval = setInterval(() => {
          setScanProgress(prev => {
            if (prev < 70) {
              setScanStatus('AI đang đọc dữ liệu...');
              return prev + 3;
            } else if (prev < 95) {
              setScanStatus('Đang trích xuất sản phẩm...');
              return prev + 1;
            }
            return prev;
          });
        }, 400);

        const reader = new FileReader();
        reader.readAsDataURL(compressedFile);
        await new Promise((resolve) => (reader.onload = resolve));
        const base64Data = (reader.result as string).split(',')[1];

        const apiKey = import.meta.env.VITE_GOOGLE_API_KEY || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || "AIzaSyD2dAXp28io3QlkK0t1hIAAGKPoD7qhyq0";
        if (!apiKey || apiKey === "") {
          toast.error('Lỗi cấu hình: Không tìm thấy API Key. Vui lòng kiểm tra lại cấu hình.');
          if (progressInterval) clearInterval(progressInterval);
          setIsScanning(false);
          return;
        }
        const ai = new GoogleGenAI({ apiKey });
        
        const promptText = `Bạn là hệ thống AI chuyên trích xuất dữ liệu hóa đơn siêu thị.

NHIỆM VỤ: 
Trích xuất TẤT CẢ các sản phẩm có trên hóa đơn.
Với mỗi sản phẩm, hãy phân loại xem nó thuộc ngành hàng nào trong danh sách sau: [${categoryList}]. Nếu không thuộc ngành hàng nào trong danh sách, hãy xếp vào loại "Khác".

HƯỚNG DẪN BÓC TÁCH GIÁ (CRITICAL):
Phải lấy đúng ĐƠN GIÁ (Unit Price) của 1 sản phẩm. KHÔNG lấy Thành tiền.
Cấu trúc hóa đơn thường hiển thị theo cặp dòng: 
- Dòng trên: [Tên Sản Phẩm]
- Dòng dưới: [Số lượng]      [Đơn giá]      [Thành tiền]

Dưới đây là văn bản thô đã được quét từ hóa đơn (OCR Text) để hỗ trợ bạn:
"""
${ocrText}
"""

ĐỊNH DẠNG ĐẦU RA:
Trả về JSON với 'raw_name' (giữ nguyên từng chữ cái trên bill), 'qty' (số lượng), 'unit_price' (đơn giá), và 'category' (ngành hàng).`;

        const response = await ai.models.generateContent({
          model: 'gemini-3-flash-preview',
          contents: {
            parts: [
              {
                inlineData: {
                  data: base64Data,
                  mimeType: compressedFile.type || 'image/jpeg',
                }
              },
              { text: promptText }
            ]
          },
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

        if (progressInterval) clearInterval(progressInterval);
        setScanProgress(100);
        setScanStatus('Hoàn tất!');

        let responseText = response.text || '[]';
        // Clean markdown formatting if present
        responseText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
        
        try {
          items = JSON.parse(responseText);
        } catch (parseError) {
          console.error('Lỗi parse JSON từ Gemini:', parseError, responseText);
          throw new Error('Không thể đọc dữ liệu từ AI. Vui lòng thử lại.');
        }
      }
      
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
      if (progressInterval) clearInterval(progressInterval);
      setIsScanning(false);
      console.error('Lỗi quét hóa đơn:', error);
      
      const errorMsg = error.message || '';
      if (errorMsg.includes('503') || errorMsg.includes('high demand') || errorMsg.includes('UNAVAILABLE')) {
        toast.error('Server đang quá tải. Thử lại sau 5 giây', { duration: 5000 });
      } else if (errorMsg.includes('429') || errorMsg.includes('quota') || errorMsg.includes('RESOURCE_EXHAUSTED')) {
        toast.error('Hệ thống AI đã hết lượt xử lý. Vui lòng thử lại sau ít phút', { duration: 5000 });
      } else if (errorMsg) {
        toast.error(errorMsg);
      } else {
        toast.error('Lỗi khi quét hóa đơn. Vui lòng thử lại.');
      }
      
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleScanBill = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      await processBillFile(file);
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