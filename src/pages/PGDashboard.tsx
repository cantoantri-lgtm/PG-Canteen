import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { GoogleGenAI, Type } from '@google/genai';
import { Camera, Check, X } from 'lucide-react';
import { matchProduct, learnAlias } from '../services/ocrLearningService';

interface Product {
  product_id: string;
  product_name: string;
  value: number;
  item_type?: 'Sản phẩm bán' | 'Quà tặng' | 'Mẫu thử';
  brand_name: string;
}

interface CartItem {
  product_id: string;
  product_name: string;
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

const formatNumber = (numStr: string) => {
  const rawValue = numStr.replace(/\D/g, ""); 
  return rawValue.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
};

export default function PGDashboard() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // --- STATE (CÁC BIẾN TRÊN FORM) ---
  const [selectedShopId, setSelectedShopId] = useState('');
  const [selectedBrand, setSelectedBrand] = useState('');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [qty, setQty] = useState(1);
  const [customAmount, setCustomAmount] = useState('');
  const [isConverted, setIsConverted] = useState(false);
  const [competitorBrand, setCompetitorBrand] = useState('');
  const [selectedProductType, setSelectedProductType] = useState<'Bán hàng' | 'Quà tặng' | 'Mẫu thử'>('Bán hàng');
  
  const [cart, setCart] = useState<CartItem[]>([]);
  const [applicableGifts, setApplicableGifts] = useState<any[]>([]);
  
  // State cho OCR Learning
  const [pendingOcrItems, setPendingOcrItems] = useState<PendingOcrItem[]>([]);
  const [showOcrModal, setShowOcrModal] = useState(false);

  // Lấy chuỗi ngày YYYY-MM-DD theo giờ địa phương
  const todayStr = new Date(new Date().getTime() - (new Date().getTimezoneOffset() * 60000)).toISOString().split('T')[0];

  // --- FETCH DATA TỪ DATABASE ---

  // 1. Lấy danh sách Cửa hàng của PG
  const { data: shops = [] } = useQuery({
    queryKey: ['pg_shops', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data } = await supabase.from('schedules').select('shop_id, shops(shop_name)').eq('pg_id', user.id);
      const uniqueShops = new Map();
      data?.forEach((item: any) => { if (item.shop_id) uniqueShops.set(item.shop_id, item); });
      return Array.from(uniqueShops.values());
    },
    enabled: !!user?.id,
  });

  // 2. Lấy danh sách Sản phẩm được phép bán (Từ SQL View)
  const { data: products = [] } = useQuery({
    queryKey: ['allowed_products', user?.id, selectedShopId], 
    queryFn: async () => {
      if (!user?.id || !selectedShopId) return [];
      const { data, error } = await supabase
        .from('v_pg_allowed_products')
        .select('*')
        .eq('pg_id', user.id)
        .eq('shop_id', selectedShopId)
        .lte('start_date', todayStr)
        .gte('end_date', todayStr)
        .order('product_name');
        
      if (error) {
        console.error('Lỗi tải sản phẩm:', error);
        return [];
      }
      return data as Product[];
    },
    enabled: !!user?.id && !!selectedShopId,
  });

  // 2.5 Lấy danh sách Product Aliases (Lưu vào RAM, làm mới mỗi 1 tiếng)
  const { data: productAliases = [] } = useQuery({
    queryKey: ['product_aliases'],
    queryFn: async () => {
      const { data, error } = await supabase.from('product_aliases').select('*');
      if (error) {
        console.error('Lỗi tải product aliases:', error);
        return [];
      }
      return data;
    },
    staleTime: 1000 * 60 * 60, // 1 tiếng
  });

  // 3. Lấy Doanh số hôm nay (Từ SQL View)
  const { data: todaySales = 0 } = useQuery({
    queryKey: ['todaySales', user?.id],
    queryFn: async () => {
      if (!user?.id) return 0;
      const { data } = await supabase.from('v_pg_sales_summary')
        .select('total_sales').eq('pg_id', user.id).eq('sale_date', todayStr).single();
      return data?.total_sales || 0;
    },
    enabled: !!user?.id,
  });

  // 4. Lấy dữ liệu Khuyến mãi
  const { data: activePromotions = [] } = useQuery({
    queryKey: ['active_promotions', selectedShopId],
    queryFn: async () => {
      const { data: promos } = await supabase.from('promotions').select('*');
      if (!promos) return [];
      
      return await Promise.all(promos.map(async (p) => {
        const { data: tiers } = await supabase.from('promotion_tiers').select('*').eq('promotion_id', p.promotion_id);
        const tiersWithConditions = await Promise.all((tiers || []).map(async (t) => {
          const { data: conds } = await supabase.from('promotion_conditions').select('*').eq('tier_id', t.id);
          return { ...t, conditions: conds || [] };
        }));
        return { ...p, tiers: tiersWithConditions };
      }));
    }
  });

  // 5. Lấy tồn kho hiện tại của cửa hàng
  const { data: inventoryData = [] } = useQuery({
    queryKey: ['shop_inventory', selectedShopId],
    queryFn: async () => {
      if (!selectedShopId) return [];
      // Assuming inventory is tracked per shop. If it's tracked globally, remove the eq('shop_id')
      // If there's no shop_id in inventories, we might need to adjust this logic based on actual schema
      const { data, error } = await supabase
        .from('inventories')
        .select('product_id, quantity');
      if (error) {
        console.error('Lỗi tải tồn kho:', error);
        return [];
      }
      return data;
    },
    enabled: !!selectedShopId,
  });

  // --- USE EFFECTS LÀM MƯỢT FORM ---
  
  // Tự động chọn cửa hàng nếu PG chỉ có 1 lịch
  useEffect(() => {
    if (shops.length === 1 && !selectedShopId) setSelectedShopId(shops[0].shop_id);
  }, [shops, selectedShopId]);

  // Tự động điền giá tiền khi chọn sản phẩm
  useEffect(() => {
    const product = products.find(p => p.product_id === selectedProductId);
    if (product && qty > 0) {
      setCustomAmount(product.item_type === 'Sản phẩm bán' || selectedProductType === 'Bán hàng' ? formatNumber((product.value * qty).toString()) : '0');
    } else setCustomAmount('');
  }, [selectedProductId, qty, products, selectedProductType]);

  // --- LOGIC FORM NHẬP LIỆU ---
  
  const uniqueBrands = Array.from(new Set(products.map(p => p.brand_name).filter(Boolean) as string[]));
  const filteredProducts = selectedBrand 
    ? products.filter(p => p.brand_name === selectedBrand) 
    : products;

  const addToCart = () => {
    const product = products.find(p => p.product_id === selectedProductId);
    const finalAmount = parseInt(customAmount.replace(/\./g, ''), 10);
    if (!product || qty <= 0 || isNaN(finalAmount)) return;

    setCart([...cart, { 
      product_id: product.product_id, 
      product_name: product.product_name, 
      qty, net_value: finalAmount,
      item_type: (product as any).item_type || selectedProductType,
      switched_from_brand: isConverted ? competitorBrand : null
    }]);
    
    // Reset form sau khi thêm
    setSelectedProductId(''); setQty(1); setCustomAmount(''); setIsConverted(false); setCompetitorBrand('');
  };

  const cartTotal = cart.reduce((sum, item) => sum + item.net_value, 0);

  // --- LOGIC QUÉT BILL ---
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
      
      const productNamesList = products.map(p => p.product_name).join('\n');
      const promptText = `Trích xuất danh sách các sản phẩm có trong hóa đơn này. 
CHÚ Ý QUAN TRỌNG: Chỉ trích xuất các sản phẩm có khả năng thuộc danh mục sản phẩm của công ty (ví dụ: Băng vệ sinh, tã, bỉm, giấy ướt, bông tẩy trang...). Bỏ qua hoàn toàn các sản phẩm không liên quan (như nước ngọt, đồ ăn, thức uống, phí dịch vụ...).
Danh sách sản phẩm công ty đang bán để tham khảo:
${productNamesList}

Trả về mảng JSON chứa 'product_name' (tên sản phẩm trên hóa đơn), 'qty' (số lượng), 'price' (tổng giá tiền của sản phẩm đó).`;

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
                product_name: { type: Type.STRING },
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
        return;
      }

      let autoAddedCount = 0;
      const newCartItems: CartItem[] = [];
      const newPendingItems: PendingOcrItem[] = [];

      for (const item of items) {
        // Sử dụng logic matchProduct (Self-learning OCR) với dữ liệu RAM
        const matchResult = matchProduct(item.product_name, products, productAliases);

        if (matchResult.matchType === 'exact' || matchResult.matchType === 'fuzzy_high') {
          const matchedProduct = products.find(p => p.product_id === matchResult.product_id);
          if (matchedProduct) {
            newCartItems.push({
              product_id: matchedProduct.product_id,
              product_name: matchedProduct.product_name,
              qty: item.qty || 1,
              net_value: item.price || matchedProduct.value * (item.qty || 1),
              item_type: (matchedProduct.item_type === 'Sản phẩm bán' ? 'Bán hàng' : matchedProduct.item_type) || 'Bán hàng',
              switched_from_brand: null
            });
            autoAddedCount++;
          }
        } else if (matchResult.matchType === 'fuzzy_low' && matchResult.suggestions.length > 0) {
          // Cần PG xác nhận thủ công (chỉ khi có suggestions)
          newPendingItems.push({
            original_name: item.product_name,
            qty: item.qty || 1,
            price: item.price || 0,
            suggestions: matchResult.suggestions,
            selected_product_id: matchResult.suggestions[0]?.product_id || ''
          });
        } else {
          // matchType === 'none' -> Bỏ qua hoàn toàn vì là sản phẩm rác/không bán
          console.log('Đã bỏ qua sản phẩm không liên quan:', item.product_name);
        }
      }

      if (autoAddedCount > 0) {
        setCart(prev => [...prev, ...newCartItems]);
        toast.success(`Đã tự động thêm ${autoAddedCount} sản phẩm vào giỏ hàng!`);
      }

      if (newPendingItems.length > 0) {
        setPendingOcrItems(newPendingItems);
        setShowOcrModal(true);
      } else if (autoAddedCount === 0) {
        toast.warning('Đã quét hóa đơn nhưng không có sản phẩm nào khớp với danh mục được phép bán.');
      }

    } catch (error: any) {
      clearInterval(progressInterval);
      console.error('Lỗi quét hóa đơn:', error);
      
      const errorMsg = error.message || '';
      if (errorMsg.includes('503') || errorMsg.includes('high demand') || errorMsg.includes('UNAVAILABLE')) {
        toast.error('Server đang quá tải. Thử lại sau 5 giây');
      } else if (errorMsg.includes('429') || errorMsg.includes('quota') || errorMsg.includes('RESOURCE_EXHAUSTED')) {
        toast.error('Hệ thống AI đã hết lượt xử lý. Vui lòng thử lại sau ít phút');
      } else {
        toast.error('Lỗi khi quét hóa đơn: ' + error.message);
      }
    } finally {
      setTimeout(() => {
        setIsScanning(false);
        setScanProgress(0);
        setScanStatus('');
      }, 1000);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // --- XỬ LÝ XÁC NHẬN OCR ---
  const handleConfirmPendingItems = async () => {
    const resolvedCartItems: CartItem[] = [];
    
    for (const pending of pendingOcrItems) {
      if (pending.selected_product_id) {
         // 1. Ghi nhận học tập (Learn Alias)
         await learnAlias(pending.original_name, pending.selected_product_id);
         
         // 2. Thêm vào giỏ hàng
         const matchedProduct = products.find(p => p.product_id === pending.selected_product_id);
         if (matchedProduct) {
           resolvedCartItems.push({
              product_id: matchedProduct.product_id,
              product_name: matchedProduct.product_name,
              qty: pending.qty,
              net_value: pending.price || matchedProduct.value * pending.qty,
              item_type: (matchedProduct.item_type === 'Sản phẩm bán' ? 'Bán hàng' : matchedProduct.item_type) || 'Bán hàng',
              switched_from_brand: null
           });
         }
      }
    }
    
    if (resolvedCartItems.length > 0) {
      setCart(prev => [...prev, ...resolvedCartItems]);
      toast.success(`Đã thêm ${resolvedCartItems.length} sản phẩm được xác nhận vào giỏ hàng!`);
    }
    
    setShowOcrModal(false);
    setPendingOcrItems([]);
  };

  // --- THUẬT TOÁN TÍNH KHUYẾN MÃI TỰ ĐỘNG ---
  useEffect(() => {
    if (cart.length === 0) {
      setApplicableGifts([]);
      return;
    }

    let eligibleNormalTiers: any[] = [];
    let eligibleOntopTiers: any[] = [];

    activePromotions.forEach((promo: any) => {
      if (promo.shop_id && promo.shop_id !== selectedShopId) return;

      promo.tiers?.forEach((tier: any) => {
        if (cartTotal >= tier.min_total_qty) {
          
          let allConditionsMet = true;
          
          tier.conditions?.forEach((cond: any) => {
            // Xử lý target_values (có thể là Array từ DB)
            const targetValuesStr = Array.isArray(cond.target_values) 
              ? cond.target_values.join(',').toLowerCase() 
              : String(cond.target_values || '').toLowerCase();
              
            let conditionValue = 0;
            
            cart.forEach(item => {
              const product = products.find(p => p.product_id === item.product_id);
              if (!product) return;
              
              if (cond.condition_type === 'Nhãn hàng' && targetValuesStr.includes(product.brand_name.toLowerCase())) {
                conditionValue += item.net_value;
              } else if (cond.condition_type === 'Sản phẩm cụ thể' && targetValuesStr.includes(product.product_name.toLowerCase())) {
                conditionValue += item.net_value;
              }
            });
            
            if (conditionValue < cond.min_target_value) {
              allConditionsMet = false;
            }
          });

          if (allConditionsMet && tier.tier_type === 'Quà tặng' && tier.gift_product_id) {
            const giftProduct = products.find(p => p.product_id === tier.gift_product_id);
            if (giftProduct) {
              const giftData = {
                product_id: giftProduct.product_id,
                product_name: giftProduct.product_name,
                qty: tier.gift_quantity || 1,
                tier_name: tier.tier_name,
                min_total_qty: tier.min_total_qty 
              };

              // Phân loại ONTOP (cộng dồn) và NORMAL (chỉ lấy cao nhất)
              if (tier.is_ontop) {
                eligibleOntopTiers.push(giftData);
              } else {
                eligibleNormalTiers.push(giftData);
              }
            }
          }
        }
      });
    });

    // Lọc Rổ NORMAL: Chỉ lấy 1 mức có yêu cầu tiền cao nhất
    eligibleNormalTiers.sort((a, b) => b.min_total_qty - a.min_total_qty);
    const finalNormalGift = eligibleNormalTiers.length > 0 ? [eligibleNormalTiers[0]] : [];

    // Gộp 2 rổ lại
    setApplicableGifts([...finalNormalGift, ...eligibleOntopTiers]);

  }, [cart, cartTotal, activePromotions, products, selectedShopId]);


  // --- MUTATION: LƯU DB (SỬ DỤNG RPC) ---
  const submitOrderMutation = useMutation({
    mutationFn: async () => {
      // 1. Tạo Cart ID
      const { data: finalCartId, error: idError } = await supabase.rpc('generate_cart_id');
      if (idError) throw idError;
      
      // 2. Gom dữ liệu Sản phẩm bán
      const sellItems = cart.map(item => ({
        cart_id: finalCartId,
        pg_id: user?.id,
        product_id: item.product_id,
        qty: item.qty,
        net_value: item.net_value,
        switched_from_brand: item.switched_from_brand
      }));

      // 3. Gom dữ liệu Quà tặng
      const giftItems = applicableGifts.map(gift => ({
        cart_id: finalCartId,
        pg_id: user?.id,
        product_id: gift.product_id,
        qty: gift.qty,
        net_value: 0,
        switched_from_brand: `QUÀ TẶNG: ${gift.tier_name}` 
      }));

      // Gộp chung 
      const jsonPayload = [...sellItems, ...giftItems];

      // 4. Đẩy xuống Database xử lý Insert + Trừ kho
      const { error: submitError } = await supabase.rpc('luu_don_hang', { p_cart_items: jsonPayload });
      if (submitError) throw submitError;
    },
    onSuccess: () => {
      toast.success('🎉 Đã ghi nhận hóa đơn và trừ kho thành công!');
      setCart([]);
      setApplicableGifts([]);
      queryClient.invalidateQueries({ queryKey: ['todaySales'] }); 
    },
    onError: (error: any) => toast.error(`Lỗi: ${error.message}`)
  });

  return (
    <div className="space-y-6 max-w-lg mx-auto pb-10 px-4">
      <h2 className="text-2xl font-bold text-gray-900 pt-6">Bảng điều khiển PG</h2>

      {/* WIDGET BÁO CÁO */}
      <div className="bg-gradient-to-br from-indigo-600 to-purple-700 rounded-2xl shadow-xl p-6 text-white">
        <h3 className="text-sm font-medium text-indigo-100 mb-1">Doanh số Hôm nay</h3>
        <div className="text-3xl font-extrabold text-yellow-300">
          {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(todaySales)}
        </div>
      </div>

      {/* KHU VỰC NHẬP LIỆU (FORM) */}
      <div className="bg-white shadow-lg rounded-2xl p-5 border border-gray-100 space-y-4">
        
        <select className="w-full p-2.5 border rounded-xl" value={selectedShopId} onChange={e => setSelectedShopId(e.target.value)}>
          <option value="">-- Chọn cửa hàng làm việc --</option>
          {shops.map((s: any) => <option key={s.shop_id} value={s.shop_id}>{s.shops?.shop_name}</option>)}
        </select>

        <div className="space-y-4">
          <select className="w-full p-2.5 border rounded-xl" value={selectedBrand} onChange={e => {setSelectedBrand(e.target.value); setSelectedProductId('');}}>
            <option value="">-- Lọc Hãng --</option>
            {uniqueBrands.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
          <select className="w-full p-2.5 border rounded-xl" value={selectedProductId} onChange={e => setSelectedProductId(e.target.value)}>
            <option value="" disabled>Chọn SP...</option>
            {filteredProducts.map(p => <option key={p.product_id} value={p.product_id}>{p.product_name}</option>)}
          </select>
        </div>

        <div className="flex gap-2 items-end">
          <div className="w-20">
            <label className="text-xs text-gray-400">SL</label>
            <input type="number" min="1" className="w-full p-2.5 border rounded-xl text-center" value={qty} onChange={e => setQty(parseInt(e.target.value)||1)} />
          </div>
          <div className="flex-1">
            <label className="text-xs text-gray-400">Số tiền (đ)</label>
            <input type="text" className="w-full p-2.5 border rounded-xl text-right font-bold text-indigo-700 bg-indigo-50" value={customAmount} onChange={e => setCustomAmount(formatNumber(e.target.value))} />
          </div>
        </div>

        <div className="p-3 bg-indigo-50/50 rounded-xl border border-indigo-100">
          <label className="flex items-center space-x-2 text-sm text-indigo-900 cursor-pointer">
            <input type="checkbox" checked={isConverted} onChange={e => setIsConverted(e.target.checked)} className="rounded text-indigo-600" />
            <span>Sản phẩm này là khách đổi từ hãng khác?</span>
          </label>
          {isConverted && <input type="text" placeholder="Nhập tên hãng đối thủ..." className="mt-2 w-full p-2 border rounded-lg text-sm focus:ring-indigo-500" value={competitorBrand} onChange={e => setCompetitorBrand(e.target.value)} />}
        </div>

        <div className="flex gap-2">
          <button onClick={addToCart} disabled={!selectedProductId || !customAmount} className="flex-1 bg-indigo-50 text-indigo-700 py-3 rounded-xl font-bold hover:bg-indigo-100 disabled:opacity-50 transition-colors">
            + THÊM VÀO GIỎ
          </button>
          
          <button 
            onClick={() => fileInputRef.current?.click()} 
            disabled={isScanning || !selectedShopId}
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
        </div>
      </div>

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

      {/* HIỂN THỊ GIỎ HÀNG */}
      {cart.length > 0 && (
        <div className="bg-white shadow-lg rounded-2xl p-5 border border-gray-100">
          <ul className="space-y-3 mb-4">
            {cart.map((item, idx) => (
              <li key={idx} className="flex justify-between items-center text-sm border-b border-gray-100 pb-3 last:border-0 last:pb-0">
                <div className="flex flex-col pr-2">
                  <span className="font-medium text-gray-800">{item.qty}x {item.product_name}</span>
                  {item.switched_from_brand && <span className="text-[10px] text-green-700 bg-green-100 px-1.5 py-0.5 rounded w-fit mt-1">Đổi từ: {item.switched_from_brand}</span>}
                </div>
                <div className="flex items-center space-x-3">
                  <span className="font-bold text-gray-900">{new Intl.NumberFormat('vi-VN').format(item.net_value)}đ</span>
                  <button onClick={() => setCart(cart.filter((_, i) => i !== idx))} className="text-red-500 bg-red-50 hover:bg-red-100 w-7 h-7 rounded-md flex items-center justify-center transition-colors">✕</button>
                </div>
              </li>
            ))}
          </ul>
          
          <div className="border-t border-gray-200 pt-3 flex justify-between items-center font-bold text-lg text-indigo-700">
            <span>Tổng giỏ hàng:</span>
            <span className="text-xl">{new Intl.NumberFormat('vi-VN').format(cartTotal)}đ</span>
          </div>

          {/* KHU VỰC HIỂN THỊ QUÀ TẶNG */}
          {applicableGifts.length > 0 && (
            <div className="mt-4 space-y-3">
              {applicableGifts.map((gift, idx) => {
                const inventoryItem = inventoryData.find((i: any) => i.product_id === gift.product_id);
                const stockQty = inventoryItem ? inventoryItem.quantity : 0;
                
                return (
                  <div key={idx} className="p-4 bg-pink-50 rounded-xl border border-pink-200">
                    {/* DÒNG 1: Tiêu đề & Tồn kho ngang hàng */}
                    <div className="flex justify-between items-center mb-3">
                      <h4 className="text-xs font-bold text-pink-700 uppercase flex items-center m-0">
                        <span className="mr-1.5 text-base">🎁</span> Quà tặng kèm theo đơn
                      </h4>
                      <span className="text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded px-2 py-0.5 shadow-sm">
                        Tồn: {stockQty}
                      </span>
                    </div>
                    
                    {/* DÒNG 2: Tên quà tặng & Số lượng tặng ngang hàng */}
                    <div className="flex justify-between items-start mb-1.5">
                      <span className="font-bold text-pink-900 text-sm pr-4 leading-tight">
                        {gift.product_name}
                      </span>
                      <span className="font-extrabold text-pink-700 text-base whitespace-nowrap">
                        x {gift.qty}
                      </span>
                    </div>
                    
                    {/* DÒNG 3: Chi tiết chương trình khuyến mãi */}
                    <div className="text-[11px] text-pink-600 leading-snug">
                      KM: {gift.tier_name}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <button onClick={() => submitOrderMutation.mutate()} disabled={submitOrderMutation.isPending} className="w-full mt-6 bg-indigo-600 text-white py-3.5 rounded-xl font-bold uppercase tracking-wide shadow-lg shadow-indigo-200 hover:bg-indigo-700 disabled:opacity-50 transition-all active:scale-95">
            {submitOrderMutation.isPending ? 'Đang xử lý...' : 'XÁC NHẬN LƯU GIỎ HÀNG'}
          </button>
        </div>
      )}

      {/* MODAL XÁC NHẬN OCR (SELF-LEARNING) */}
      {showOcrModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-4 border-b border-gray-100 bg-indigo-50/50">
              <h3 className="text-lg font-bold text-indigo-900">Xác nhận sản phẩm</h3>
              <p className="text-sm text-indigo-600 mt-1">Hệ thống cần bạn xác nhận một số sản phẩm chưa rõ ràng trên hóa đơn.</p>
            </div>
            
            <div className="p-4 overflow-y-auto flex-1 space-y-4">
              {pendingOcrItems.map((item, idx) => (
                <div key={idx} className="bg-gray-50 p-3 rounded-xl border border-gray-200">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <span className="text-xs font-semibold text-gray-500 uppercase">Tên trên bill:</span>
                      <p className="font-medium text-gray-900">{item.original_name}</p>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-semibold text-gray-500 uppercase">SL/Giá:</span>
                      <p className="font-bold text-indigo-700">{item.qty} x {new Intl.NumberFormat('vi-VN').format(item.price)}đ</p>
                    </div>
                  </div>
                  
                  <label className="block mt-3 text-xs font-semibold text-gray-700 mb-1">Chọn sản phẩm đúng:</label>
                  <select 
                    className="w-full p-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-500"
                    value={item.selected_product_id}
                    onChange={(e) => {
                      const newItems = [...pendingOcrItems];
                      newItems[idx].selected_product_id = e.target.value;
                      setPendingOcrItems(newItems);
                    }}
                  >
                    <option value="">-- Bỏ qua sản phẩm này --</option>
                    {item.suggestions.map((s: any) => (
                      <option key={`sugg-${s.product_id}`} value={s.product_id}>⭐ {s.product_name}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            
            <div className="p-4 border-t border-gray-100 flex gap-3 bg-white">
              <button 
                onClick={() => {
                  setShowOcrModal(false);
                  setPendingOcrItems([]);
                }}
                className="flex-1 py-2.5 rounded-xl font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
              >
                Hủy bỏ
              </button>
              <button 
                onClick={handleConfirmPendingItems}
                className="flex-[2] py-2.5 rounded-xl font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors shadow-md shadow-indigo-200"
              >
                Xác nhận & Thêm vào giỏ
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}