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
        toast.error('Lỗi cấu hình: Không tìm thấy API Key. Vui lòng kiểm tra lại cấu hình.');
        clearInterval(progressInterval);
        setIsScanning(false);
        return;
      }
      const ai = new GoogleGenAI({ apiKey });
      
      // Lấy danh sách nhóm ngành hàng duy nhất
      const uniqueCategories = Array.from(new Set(products.map(p => p.category_name).filter(Boolean)));
      const categoryList = uniqueCategories.length > 0 ? uniqueCategories.join(', ') : 'Băng vệ sinh, Tã bỉm trẻ em, Tã người lớn, Khăn ướt, Bông tẩy trang...';
      
      const promptText = `Bạn là hệ thống trích xuất dữ liệu hóa đơn.
Trích xuất toàn bộ các mặt hàng trên hóa đơn này có khả năng thuộc các NHÓM NGÀNH HÀNG sau: [${categoryList}].
TUYỆT ĐỐI BỎ QUA các sản phẩm không thuộc các nhóm trên (ví dụ: thực phẩm, đồ uống, hóa mỹ phẩm khác).
Trả về JSON với 'raw_name' (giữ đúng 100% từng chữ cái trên hóa đơn), 'qty', 'price'.`;

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
                price: { type: Type.NUMBER }
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
        toast.error('Không tìm thấy sản phẩm nào trong hóa đơn.');
        setIsScanning(false);
        return;
      }

      const newCartItems: CartItem[] = [];
      const newPendingItems: PendingOcrItem[] = [];

      for (const item of items) {
        // Sử dụng logic matchProduct (Self-learning OCR) với dữ liệu RAM
        const matchResult = matchProduct(item.raw_name, products, productAliases);

        if (matchResult.matchType === 'exact' || matchResult.matchType === 'fuzzy_high') {
          const matchedProduct = products.find(p => p.product_id === matchResult.product_id);
          if (matchedProduct) {
            newCartItems.push({
              product_id: matchedProduct.product_id,
              product_name: matchedProduct.product_name,
              product_group_name: matchedProduct.product_group_name,
              qty: item.qty || 1,
              net_value: item.price || matchedProduct.value * (item.qty || 1),
              item_type: (matchedProduct.item_type === 'Sản phẩm bán' ? 'Bán hàng' : matchedProduct.item_type) || 'Bán hàng',
              switched_from_brand: null
            });
          }
        } else if (matchResult.matchType === 'fuzzy_low' && matchResult.suggestions.length > 0) {
          // Cần PG xác nhận thủ công (chỉ khi có suggestions)
          newPendingItems.push({
            original_name: item.raw_name,
            qty: item.qty || 1,
            price: item.price || 0,
            suggestions: matchResult.suggestions,
            selected_product_id: matchResult.suggestions[0]?.product_id || ''
          });
        } else {
          // matchType === 'none' -> Bỏ qua hoàn toàn vì là sản phẩm rác/không bán
          console.log('Đã bỏ qua sản phẩm không liên quan:', item.raw_name);
        }
      }

      onScanComplete(newCartItems, newPendingItems);
      setIsScanning(false);
      
      // Reset input file
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
      
      // Reset input file
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

      {/* MODAL TIẾN TRÌNH QUÉT BILL */}
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
