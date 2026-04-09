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

// Hàm hỗ trợ: Chuẩn hóa tiếng Việt (Xóa dấu) để so sánh chính xác hơn
const removeAccents = (str: string) => {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
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
        if (prev < 30) return prev + 5;
        if (prev < 70) return prev + 3;
        if (prev < 95) return prev + 1;
        return prev;
      });
    }, 400);

    try {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      await new Promise((resolve) => (reader.onload = resolve));
      const base64Data = (reader.result as string).split(',')[1];

      // API Key Configuration
      const apiKey = import.meta.env.VITE_GOOGLE_API_KEY || "AIzaSyD2dAXp28io3QlkK0t1hIAAGKPoD7qhyq0";
      const ai = new GoogleGenAI({ apiKey });
      
      const uniqueCategories = Array.from(new Set(products.map(p => p.category_name).filter(Boolean)));
      const categoryList = uniqueCategories.join(', ');
      
      const promptText = `Bạn là hệ thống AI trích xuất hóa đơn siêu thị. 
      NHIỆM VỤ: Trích xuất sản phẩm thuộc các nhóm: [${categoryList}]. 
      HƯỚNG DẪN: Lấy ĐƠN GIÁ (unit_price) của 1 sản phẩm, không lấy thành tiền. Lưu ý viết tắt: BVS (Băng vệ sinh), Ta (Tã), K.Uot (Khăn ướt).
      TRẢ VỀ JSON: [{raw_name: string, qty: number, unit_price: number}]`;

      const response = await ai.models.generateContent({
        model: 'gemini-1.5-flash',
        contents: [{ inlineData: { data: base64Data, mimeType: file.type } }, promptText],
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

      const items = JSON.parse(response.text || '[]');
      const newCartItems: CartItem[] = [];
      const newPendingItems: PendingOcrItem[] = [];

      for (const item of items) {
        // 1. Thử khớp nhanh bằng dịch vụ có sẵn
        const matchResult = matchProduct(item.raw_name, item.unit_price, products, productAliases);

        if (matchResult.matchType === 'exact' || matchResult.matchType === 'fuzzy_high') {
          const p = products.find(p => p.product_id === matchResult.product_id);
          if (p) {
            newCartItems.push({
              product_id: p.product_id,
              product_name: p.product_name,
              product_group_name: p.product_group_name,
              qty: item.qty || 1,
              net_value: (item.unit_price || p.value) * (item.qty || 1),
              item_type: (p.item_type === 'Sản phẩm bán' ? 'Bán hàng' : p.item_type) as any || 'Bán hàng',
            });
            continue;
          }
        }

        // 2. THUẬT TOÁN ĐỀ XUẤT PHÂN CẤP TRỌNG SỐ (TOP 10)
        const rawNameNorm = removeAccents(item.raw_name);
        const itemPrice = item.unit_price || 0;

        const scoredProducts = products.map(p => {
          let score = 0;
          const pNameNorm = removeAccents(p.product_name);
          const pBrandNorm = removeAccents(p.brand_name || '');
          const pGroupNorm = removeAccents(p.product_group_name || '');
          const pCatNorm = removeAccents(p.category_name || '');

          // ƯU TIÊN 1: NGÀNH HÀNG (Weight: 500)
          if (rawNameNorm.includes('bvs') && pCatNorm.includes('bang ve sinh')) score += 500;
          if ((rawNameNorm.includes('ta') || rawNameNorm.includes('bim')) && pCatNorm.includes('tre em')) score += 500;
          if (rawNameNorm.includes('uot') && pCatNorm.includes('khan uot')) score += 500;

          // ƯU TIÊN 2: NHÃN HÀNG (Weight: 200)
          if (pBrandNorm && rawNameNorm.includes(pBrandNorm)) score += 200;
          else {
            // Xử lý viết tắt nhãn hàng
            if (pBrandNorm === 'diana' && (rawNameNorm.includes('dn') || rawNameNorm.includes('dia'))) score += 200;
            if (pBrandNorm === 'bobby' && (rawNameNorm.includes('bb') || rawNameNorm.includes('bob'))) score += 200;
          }

          // ƯU TIÊN 3: NHÓM SẢN PHẨM (Weight: 100)
          if (pGroupNorm && rawNameNorm.includes(pGroupNorm)) score += 100;

          // ƯU TIÊN 4: TÊN CHI TIẾT (Weight: 20 mỗi từ)
          const words = rawNameNorm.split(' ');
          words.forEach(w => {
            if (w.length > 2 && pNameNorm.includes(w)) {
              score += 20;
              // Bonus cho các dòng cao cấp bạn đang tìm
              if (['beauty', 'comfy', 'softfit', 'double', 'fresh'].includes(w)) score += 30;
            }
          });

          // ƯU TIÊN 5: GIÁ CẢ (Weight: 50)
          if (p.value > 0 && itemPrice > 0) {
            const ratio = itemPrice / p.value;
            if (Math.abs(ratio - Math.round(ratio)) < 0.1) score += 50;
          }

          return { ...p, score };
        });

        const bestSuggestions = scoredProducts
          .filter(p => p.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 10) // Lấy Top 10
          .map(p => ({
            product_id: p.product_id,
            product_name: p.product_name,
            product_group_name: p.product_group_name,
            value: p.value
          }));

        newPendingItems.push({
          original_name: item.raw_name,
          qty: item.qty || 1,
          price: itemPrice,
          suggestions: bestSuggestions.length > 0 ? bestSuggestions : (matchResult.suggestions?.slice(0, 10) || []),
          selected_product_id: bestSuggestions[0]?.product_id || ''
        });
      }

      onScanComplete(newCartItems, newPendingItems);
      clearInterval(progressInterval);
      setScanProgress(100);
      setScanStatus('Hoàn tất!');
      setTimeout(() => setIsScanning(false), 500);

    } catch (error) {
      clearInterval(progressInterval);
      setIsScanning(false);
      toast.error('Lỗi quét hóa đơn. Vui lòng thử lại.');
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
        type="file" accept="image/*" capture="environment" 
        ref={fileInputRef} onChange={handleScanBill} className="hidden" 
      />

      {isScanning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 flex flex-col items-center">
            <div className="w-16 h-16 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center mb-4">
              <Camera size={32} className="animate-pulse" />
            </div>
            <h3 className="text-lg font-bold mb-2">Đang xử lý hóa đơn</h3>
            <div className="w-full flex justify-between text-sm font-medium text-purple-800 mb-2">
              <span>{scanStatus}</span>
              <span>{scanProgress}%</span>
            </div>
            <div className="w-full bg-purple-100 rounded-full h-3 overflow-hidden">
              <div className="bg-purple-600 h-3 transition-all duration-300" style={{ width: `${scanProgress}%` }}></div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}