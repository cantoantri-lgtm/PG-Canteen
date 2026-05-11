import React, { useState, useRef } from 'react';
import { Camera, ImagePlus } from 'lucide-react';
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

// 1. TỐI ƯU LOCAL OCR: Singleton Worker Logic
let currentProgressCallback: ((p: number) => void) | null = null;
let tesseractWorkerPromise: Promise<Tesseract.Worker> | null = null;

const getTesseractWorker = () => {
  if (!tesseractWorkerPromise) {
    tesseractWorkerPromise = Tesseract.createWorker('vie', 1, {
      logger: m => {
        if (m.status === 'recognizing text' && currentProgressCallback) {
          currentProgressCallback(Math.floor(m.progress * 30));
        }
      }
    });
  }
  return tesseractWorkerPromise;
};

// Hàm tiền xử lý hình ảnh (Grayscale + Tăng độ tương phản)
const preprocessImage = async (file: File): Promise<File> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(file);
      
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      
      for (let i = 0; i < data.length; i += 4) {
        // Luminance (Grayscale)
        let luminance = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
        // Increase contrast
        luminance = (luminance - 128) * 1.5 + 128; 
        luminance = Math.max(0, Math.min(255, luminance));
        data[i] = data[i+1] = data[i+2] = luminance;
      }
      
      ctx.putImageData(imageData, 0, 0);
      canvas.toBlob(blob => {
        if (blob) {
          resolve(new File([blob], file.name, { type: 'image/jpeg' }));
        } else {
          resolve(file);
        }
      }, 'image/jpeg', 0.9);
    };
    img.onerror = () => resolve(file);
    img.src = URL.createObjectURL(file);
  });
};

// 2. BỘ LỌC CHẶN CLOUD (Gatekeeper Logic)
const shouldUseCloudAI = (tesseractResult: any, matchedItems: any[]): boolean => {
  const confidence = tesseractResult?.data?.confidence || 0;
  const rawText = tesseractResult?.data?.text || '';
  
  if (confidence < 60) {
    console.log(`[Gatekeeper] Độ tin cậy OCR quá thấp: ${confidence}%`);
    return true;
  }
  if (rawText.length < 30) {
    console.log(`[Gatekeeper] Lượng chữ đọc được quá ngắn: ${rawText.length} ký tự`);
    return true;
  }
  if (matchedItems.length === 0) {
    console.log('[Gatekeeper] Local không nhận diện được SKU mục tiêu nào');
    return true;
  }
  return false;
};

export default function Scanbill({ products, productAliases, ocrErrors = [], onScanComplete, disabled }: ScanbillProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanStatus, setScanStatus] = useState('');

  const getBase64 = (file: File | Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        const base64Data = result.split(',')[1];
        resolve(base64Data);
      };
      reader.onerror = error => reject(error);
    });
  };

  const processBillFile = async (file: File) => {
    setIsScanning(true);
    setScanProgress(5);
    setScanStatus('Đang nén và tiền xử lý ảnh...');
    
    let progressInterval: NodeJS.Timeout | null = null;

    try {
      // 3. TỐI ƯU CLOUD FALLBACK: Đảm bảo ảnh nén max 1MB
      const options = {
        maxSizeMB: 1, 
        maxWidthOrHeight: 1200,
        useWebWorker: true
      };
      let compressedFile: File;
      try {
        compressedFile = await imageCompression(file, options);
      } catch (compressError) {
        compressedFile = file;
      }

      // Tiền xử lý ảnh (chuyển Grayscale) giúp Tesseract đọc tốt hơn
      const preppedFile = await preprocessImage(compressedFile);

      setScanProgress(15);
      setScanStatus('Đang quét nhanh tại Local...');

      // Gọi Singleton Worker Local OCR
      currentProgressCallback = setScanProgress;
      const worker = await getTesseractWorker();
      const ocrResult = await worker.recognize(preppedFile);
      const rawText = ocrResult.data.text;
      
      const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);

      let localMatchedItems: any[] = [];
      const keywordToProductMatch = (line: string) => {
        let bestMatch: Product | null = null;
        let score = 0;
        
        products.forEach(p => {
          const pNameLower = p.product_name.toLowerCase();
          const lineLower = line.toLowerCase();
          if (lineLower.includes(pNameLower)) {
            let currentScore = pNameLower.length; 
            if (currentScore > score) {
              score = currentScore;
              bestMatch = p;
            }
          }
        });
        
        return bestMatch ? { product: bestMatch, score } : null;
      };

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = keywordToProductMatch(line);
        if (match) {
          let price = match.product.value; 
          if (i + 1 < lines.length) {
            const nextLine = lines[i+1];
            const numMatches = nextLine.match(/\d+[.,\s]*\d*/g);
            if (numMatches && numMatches.length >= 2) {
              const possiblePrice = parseInt(numMatches[1].replace(/\D/g, ''));
              if (possiblePrice > 1000) price = possiblePrice;
            }
          }
          localMatchedItems.push({
            raw_name: line,
            qty: 1,
            unit_price: price,
            category: match.product.category_name || 'Khác'
          });
        }
      }

      let items = [];

      // Áp dụng Gatekeeper Logic
      if (!shouldUseCloudAI(ocrResult, localMatchedItems)) {
        setScanStatus('Đã tìm ra và xử lý xong bằng Local AI!');
        setScanProgress(100);
        items = localMatchedItems;
        console.log("Local OCR hoàn tất thành công:", items);
      } else {
        setScanStatus('Local AI không đủ tinh cậy. Fallback sang Cloud AI...');
        setScanProgress(40);
        
        progressInterval = setInterval(() => {
          setScanProgress(prev => {
            if (prev < 90) return prev + 2;
            return prev;
          });
        }, 300);

        const uniqueCategories = Array.from(new Set(products.map(p => p.category_name).filter(Boolean)));
        const categoryList = uniqueCategories.length > 0 ? uniqueCategories.join(', ') : 'Khác';

        const imageBase64 = await getBase64(compressedFile); // Dùng file nén < 1MB
        const mimeType = compressedFile.type || 'image/jpeg';

        // Gọi Cloud Fallback - Truyền model alias nhanh & rẻ (gemini-1.5-flash-8b)
        const res = await fetch('/api/v1/scan-bill', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            modelName: 'gemini-1.5-flash-8b', 
            rawText: rawText,
            imageBase64,
            mimeType,
            categoryList
          })
        });

          if (!res.ok) {
          const errData = await res.json().catch(() => null);
          throw new Error(errData?.error || `Lỗi Server HTTP ${res.status}`);
        }

        const data = await res.json();
        items = data.items || [];
        
        if (progressInterval) clearInterval(progressInterval);
        setScanProgress(100);
        setScanStatus('Cloud AI xử lý hoàn tất!');
      }
      
      if (items.length === 0) {
        toast.error('Không tìm thấy sản phẩm mục tiêu nào trong hóa đơn.');
        setIsScanning(false);
        return;
      }

      const newCartItems: CartItem[] = [];
      const newPendingItems: PendingOcrItem[] = [];
      const uniqueCategories = Array.from(new Set(products.map(p => p.category_name).filter(Boolean)));

      for (const item of items) {
        if (item.category === 'Khác' || !uniqueCategories.includes(item.category)) {
          continue; 
        }

        const matchResult = matchProduct(item.raw_name, item.unit_price, products, productAliases);

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
          let suggestions = matchResult.suggestions || [];
          if (suggestions.length === 0) {
            const rawWords = item.raw_name.toLowerCase().split(/[ \-\+]+/); 
            
            const scoredProducts = products.map(p => {
              let score = 0;
              const pName = p.product_name.toLowerCase();
              rawWords.forEach(word => {
                if (word.length > 2 && pName.includes(word)) score += 15;
              });
              const priceDiff = Math.abs(p.value - (item.unit_price || 0));
              score -= (priceDiff / 5000); 
              return { ...p, score };
            });

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
            suggestions = suggestions.slice(0, 10);
          }

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
      
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (galleryInputRef.current) galleryInputRef.current.value = '';

    } catch (error: any) {
      if (progressInterval) clearInterval(progressInterval);
      setIsScanning(false);
      console.error('Lỗi quét hóa đơn:', error);
      toast.error(error.message || 'Lỗi khi quét hóa đơn. Vui lòng thử lại.');
      
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (galleryInputRef.current) galleryInputRef.current.value = '';
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
      <div className="flex gap-2 flex-1">
        <button 
          onClick={() => fileInputRef.current?.click()} 
          disabled={isScanning || disabled}
          className="flex-1 bg-purple-50 text-purple-700 py-3 rounded-xl font-bold hover:bg-purple-100 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
        >
          <Camera size={20} />
          {isScanning ? 'ĐANG QUÉT...' : 'QUÉT BILL'}
        </button>
        <button 
          onClick={() => galleryInputRef.current?.click()} 
          disabled={isScanning || disabled}
          className="px-4 bg-purple-50 text-purple-700 rounded-xl hover:bg-purple-100 disabled:opacity-50 transition-colors flex items-center justify-center"
          title="Chọn ảnh từ thư viện"
        >
          <ImagePlus size={20} />
        </button>
      </div>
      <input 
        type="file" 
        accept="image/*" 
        capture="environment"
        ref={fileInputRef} 
        onChange={handleScanBill} 
        className="hidden" 
      />
      <input 
        type="file" 
        accept="image/*" 
        ref={galleryInputRef} 
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