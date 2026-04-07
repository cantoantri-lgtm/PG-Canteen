import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

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

        <div className="flex gap-2">
          <select className="flex-1 p-2.5 border rounded-xl" value={selectedBrand} onChange={e => {setSelectedBrand(e.target.value); setSelectedProductId('');}}>
            <option value="">-- Lọc Hãng --</option>
            {uniqueBrands.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
          <select className="flex-1 p-2.5 border rounded-xl" value={selectedProductId} onChange={e => setSelectedProductId(e.target.value)}>
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

        <button onClick={addToCart} disabled={!selectedProductId || !customAmount} className="w-full bg-indigo-50 text-indigo-700 py-3 rounded-xl font-bold hover:bg-indigo-100 disabled:opacity-50 transition-colors">
          + THÊM VÀO GIỎ
        </button>
      </div>

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
            <div className="mt-4 p-4 bg-pink-50 rounded-xl border border-pink-200">
              <h4 className="text-xs font-bold text-pink-700 uppercase mb-3 flex items-center">
                <span className="mr-2">🎁</span> Quà tặng kèm theo đơn
              </h4>
              <ul className="space-y-2">
                {applicableGifts.map((gift, idx) => (
                  <li key={idx} className="text-sm text-pink-900 flex justify-between items-start border-b border-pink-100 pb-2 last:border-0 last:pb-0">
                    <div className="flex flex-col pr-4">
                      <span className="font-medium">{gift.product_name}</span>
                      <span className="text-[10px] text-pink-600 mt-0.5">KM: {gift.tier_name}</span>
                    </div>
                    <span className="font-bold whitespace-nowrap">x {gift.qty}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button onClick={() => submitOrderMutation.mutate()} disabled={submitOrderMutation.isPending} className="w-full mt-6 bg-indigo-600 text-white py-3.5 rounded-xl font-bold uppercase tracking-wide shadow-lg shadow-indigo-200 hover:bg-indigo-700 disabled:opacity-50 transition-all active:scale-95">
            {submitOrderMutation.isPending ? 'Đang xử lý...' : 'XÁC NHẬN LƯU GIỎ HÀNG'}
          </button>
        </div>
      )}
    </div>
  );
}