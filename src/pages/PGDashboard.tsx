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
  brands: any;
}

interface CartItem {
  product_id: string;
  product_name: string;
  qty: number;
  net_value: number;
  item_type: 'Bán hàng' | 'Quà tặng' | 'Mẫu thử';
  switched_from_brand?: string | null;
}

// Hàm hỗ trợ định dạng số có dấu chấm
const formatNumber = (numStr: string) => {
  const rawValue = numStr.replace(/\D/g, ""); 
  return rawValue.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
};

export default function PGDashboard() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // --- STATE NHẬP LIỆU ---
  const [selectedBrand, setSelectedBrand] = useState('');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [qty, setQty] = useState(1);
  const [customAmount, setCustomAmount] = useState('');
  const [isConverted, setIsConverted] = useState(false);
  const [competitorBrand, setCompetitorBrand] = useState('');
  const [selectedProductType, setSelectedProductType] = useState<'Bán hàng' | 'Quà tặng' | 'Mẫu thử'>('Bán hàng');
  
  const [cart, setCart] = useState<CartItem[]>([]);
  const [applicableGifts, setApplicableGifts] = useState<any[]>([]);

  // --- STATE SỬA ĐƠN HÀNG (MODAL) ---
  const [editingItem, setEditingItem] = useState<any>(null);
  const [editQty, setEditQty] = useState(1);
  const [editAmount, setEditAmount] = useState('');

  // --- THỜI GIAN ---
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();
  
  // Lấy chuỗi YYYY-MM-DD của ngày hôm nay để so sánh
  const todayStr = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().split('T')[0];

  // --- HÀM TẠO ID GIỎ HÀNG ---
  const generateUniqueCartId = async (): Promise<string> => {
    let isUnique = false;
    let newId = '';
    while (!isUnique) {
      const datePart = new Date().toISOString().slice(2, 10).replace(/-/g, '');
      const randomPart = Math.random().toString(36).substring(2, 6).toUpperCase();
      newId = `CART-${datePart}-${randomPart}`;
      const { data } = await supabase.from('orders').select('cart_id').eq('cart_id', newId).limit(1);
      if (!data || data.length === 0) isUnique = true;
    }
    return newId;
  };

  // 1. FETCH DATA
  const { data: products = [] } = useQuery({
    queryKey: ['products'],
    queryFn: async () => {
      const { data, error } = await supabase.from('products').select(`product_id, product_name, value, item_type, brands(brand_name)`).order('product_name');
      if (error) {
        console.error('Error fetching products:', error);
        toast.error('Lỗi tải danh sách sản phẩm');
      }
      return (data || []) as Product[];
    }
  });

  const { data: recentOrders = [] } = useQuery({
    queryKey: ['recent_orders', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data } = await supabase.from('orders').select(`id, cart_id, product_id, qty, net_value, switched_from_brand, created_at, products(product_name)`).eq('pg_id', user.id).order('created_at', { ascending: false });
      return data || [];
    }
  });

  const { data: kpis = [] } = useQuery({
    queryKey: ['kpis', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data } = await supabase.from('kpis').select('*').eq('pg_id', user.id).gte('end_date', new Date().toISOString().split('T')[0]);
      return data || [];
    },
    enabled: !!user?.id,
  });

  const { data: shops = [] } = useQuery({
    queryKey: ['pg_shops', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from('schedules')
        .select('shop_id, shops(shop_name)')
        .eq('pg_id', user.id);
      
      if (error) {
        console.error('Error fetching shops:', error);
        return [];
      }
      
      // Deduplicate shops
      const uniqueShops = new Map();
      data.forEach((item: any) => {
        if (item.shop_id && item.shops) {
          uniqueShops.set(item.shop_id, { shop_id: item.shop_id, shop_name: item.shops.shop_name });
        }
      });
      return Array.from(uniqueShops.values());
    },
    enabled: !!user?.id,
  });

  const { data: promotions = [] } = useQuery({
    queryKey: ['active_promotions'],
    queryFn: async () => {
      const { data, error } = await supabase.from('promotions').select('*');
      if (error) throw error;
      
      const promotionsWithDetails = await Promise.all((data || []).map(async (p) => {
        const { data: tiersData } = await supabase.from('promotion_tiers').select('*').eq('promotion_id', p.promotion_id);
        const tiers = await Promise.all((tiersData || []).map(async (t) => {
          const { data: conditionsData } = await supabase.from('promotion_conditions').select('*').eq('tier_id', t.id);
          return { ...t, conditions: conditionsData || [] };
        }));
        return { ...p, tiers };
      }));
      
      return promotionsWithDetails;
    }
  });

  const [selectedShopId, setSelectedShopId] = useState('');

  // Auto-select shop if there's only one
  useEffect(() => {
    if (shops.length === 1 && !selectedShopId) {
      setSelectedShopId(shops[0].shop_id);
    }
  }, [shops, selectedShopId]);

  // 2. TÍNH TOÁN DOANH SỐ & KPI
  const totalTarget = kpis.reduce((sum, kpi) => sum + Number(kpi.sale_target), 0);
  
  // Doanh số tháng (Không tính hàng đối thủ)
  const currentMonthSales = recentOrders
    .filter((o: any) => !o.switched_from_brand)
    .reduce((sum, order) => sum + Number(order.net_value), 0);
  
  const kpiProgress = totalTarget > 0 ? Math.min((currentMonthSales / totalTarget) * 100, 100) : 0;

  // Doanh số hôm nay (Bao gồm tất cả đơn trong ngày)
  const todaySales = recentOrders
    .filter((o: any) => o.created_at.startsWith(todayStr))
    .reduce((sum, order) => sum + Number(order.net_value), 0);

  // Gom nhóm dữ liệu lịch sử
  const groupedOrders = recentOrders.reduce((acc: any, current: any) => {
    if (!acc[current.cart_id]) {
      acc[current.cart_id] = { cart_id: current.cart_id, created_at: current.created_at, items: [], total: 0 };
    }
    acc[current.cart_id].items.push(current);
    acc[current.cart_id].total += Number(current.net_value);
    return acc;
  }, {});

  // 3. LOGIC TÍNH TIỀN TỰ ĐỘNG
  useEffect(() => {
    const product = products.find(p => p.product_id === selectedProductId);
    if (product && qty > 0) {
      const effectiveType = product.item_type || selectedProductType;
      if (effectiveType === 'Sản phẩm bán') {
        setCustomAmount(formatNumber((product.value * qty).toString()));
      } else {
        setCustomAmount('0');
      }
    } else {
      setCustomAmount('');
    }
  }, [selectedProductId, qty, products, selectedProductType]);

  // 4. LOGIC THÊM VÀO GIỎ HÀNG
  const uniqueBrands = Array.from(new Set(products.map(p => p.brands?.brand_name).filter(Boolean) as string[]));
  const filteredProducts = selectedBrand ? products.filter(p => p.brands?.brand_name === selectedBrand) : products;

  const addToCart = () => {
    const product = products.find(p => p.product_id === selectedProductId);
    const finalAmount = parseInt(customAmount.replace(/\./g, ''), 10);
    
    if (!product || qty <= 0 || isNaN(finalAmount)) return;
    
    // Nếu sản phẩm được định nghĩa là Quà tặng/Mẫu thử trong hệ thống, ưu tiên loại đó
    const effectiveType = (product as any).item_type || selectedProductType;

    setCart([...cart, { 
      product_id: product.product_id, 
      product_name: product.product_name, 
      qty, 
      net_value: finalAmount,
      item_type: effectiveType as any,
      switched_from_brand: isConverted ? competitorBrand : (effectiveType !== 'Bán hàng' ? effectiveType.toUpperCase() : null)
    }]);
    
    // Reset form nhập liệu nhưng giữ nguyên Giỏ hàng
    setSelectedProductId(''); 
    setQty(1);
    setCustomAmount('');
    setIsConverted(false);
    setCompetitorBrand('');
    setSelectedProductType('Bán hàng');
  };

  const removeFromCart = (index: number) => {
    const newCart = [...cart];
    newCart.splice(index, 1);
    setCart(newCart);
  };

  const cartTotal = cart.reduce((sum, item) => sum + item.net_value, 0);

  // 4.5 LOGIC KIỂM TRA KHUYẾN MÃI
  useEffect(() => {
    if (cart.length === 0) {
      setApplicableGifts([]);
      return;
    }

    const gifts: any[] = [];
    
    promotions.forEach((promo: any) => {
      // Kiểm tra phạm vi (Shop, Account, Channel)
      const matchesShop = !promo.shop_id || promo.shop_id === selectedShopId;
      // Thêm logic check account/channel nếu cần
      
      if (matchesShop) {
        promo.tiers?.forEach((tier: any) => {
          // Kiểm tra điều kiện tổng tiền tối thiểu của gói
          if (cartTotal >= tier.min_total_qty) {
            // Kiểm tra các điều kiện đi kèm (Dòng sản phẩm, Sản phẩm cụ thể, Nhãn hàng)
            let allConditionsMet = true;
            
            tier.conditions?.forEach((cond: any) => {
              const targetValues = cond.target_values.split(',').map((v: string) => v.trim().toLowerCase());
              let conditionValue = 0;
              
              cart.forEach(item => {
                const product = products.find(p => p.product_id === item.product_id);
                if (!product) return;
                
                if (cond.condition_type === 'Nhãn hàng') {
                  if (targetValues.includes(product.brands?.brand_name?.toLowerCase())) {
                    conditionValue += item.net_value;
                  }
                } else if (cond.condition_type === 'Sản phẩm cụ thể') {
                  if (targetValues.includes(product.product_name.toLowerCase())) {
                    conditionValue += item.net_value;
                  }
                } else if (cond.condition_type === 'Dòng sản phẩm') {
                  // Giả sử dòng sản phẩm nằm trong tên hoặc brand
                  if (product.product_name.toLowerCase().includes(cond.target_values.toLowerCase())) {
                    conditionValue += item.net_value;
                  }
                }
              });
              
              if (conditionValue < cond.min_target_value) {
                allConditionsMet = false;
              }
            });
            
            if (allConditionsMet && tier.tier_type === 'Quà tặng' && tier.gift_product_id) {
              const giftProduct = products.find(p => p.product_id === tier.gift_product_id);
              if (giftProduct) {
                gifts.push({
                  product_name: giftProduct.product_name,
                  qty: tier.gift_quantity || 1,
                  tier_name: tier.tier_name
                });
              }
            }
          }
        });
      }
    });
    
    setApplicableGifts(gifts);
  }, [cart, cartTotal, promotions, products, selectedShopId]);

  // --- 5. CÁC MUTATIONS (THÊM, SỬA, XÓA TRÊN DATABASE) ---
  const submitOrderMutation = useMutation({
    mutationFn: async () => {
      const finalCartId = await generateUniqueCartId();
      
      // Chuẩn bị các sản phẩm chính
      const ordersToInsert = cart.map(item => ({
        cart_id: finalCartId,
        pg_id: user?.id,
        product_id: item.product_id,
        qty: item.qty,
        net_value: item.net_value,
        switched_from_brand: item.switched_from_brand,
        created_at: new Date().toISOString()
      }));

      // Chuẩn bị các sản phẩm quà tặng
      const giftsToInsert = applicableGifts.map(gift => {
        const giftProduct = products.find(p => p.product_name === gift.product_name);
        return {
          cart_id: finalCartId,
          pg_id: user?.id,
          product_id: giftProduct?.product_id,
          qty: gift.qty,
          net_value: 0, // Quà tặng có giá trị 0
          switched_from_brand: `QUÀ TẶNG: ${gift.tier_name}`,
          created_at: new Date().toISOString()
        };
      });
      
      const allOrders = [...ordersToInsert, ...giftsToInsert];

      const { error } = await supabase.from('orders').insert(allOrders);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('🎉 Đã ghi nhận hóa đơn thành công!');
      setCart([]);
      queryClient.invalidateQueries({ queryKey: ['recent_orders'] });
    },
    onError: (error: any) => toast.error(`Lỗi: ${error.message}`)
  });

  const deleteCartMutation = useMutation({
    mutationFn: async (cartId: string) => {
      const { error } = await supabase.from('orders').delete().eq('cart_id', cartId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('🗑️ Đã xóa hóa đơn!');
      queryClient.invalidateQueries({ queryKey: ['recent_orders'] });
    }
  });

  const updateItemMutation = useMutation({
    mutationFn: async () => {
      const finalAmount = parseInt(editAmount.replace(/\./g, ''), 10);
      const { error } = await supabase.from('orders')
        .update({ qty: editQty, net_value: finalAmount })
        .eq('id', editingItem.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('✏️ Đã cập nhật sản phẩm!');
      setEditingItem(null);
      queryClient.invalidateQueries({ queryKey: ['recent_orders'] });
    }
  });

  const deleteItemMutation = useMutation({
    mutationFn: async (itemId: string) => {
      const { error } = await supabase.from('orders').delete().eq('id', itemId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('🗑️ Đã xóa sản phẩm khỏi hóa đơn!');
      queryClient.invalidateQueries({ queryKey: ['recent_orders'] });
    }
  });

  return (
    <div className="space-y-6 max-w-lg mx-auto pb-10 px-4">
      <h2 className="text-2xl font-bold text-gray-900 pt-6">Bảng điều khiển PG</h2>

      {/* 1. WIDGET BÁO CÁO KÉP (Hôm nay + Tháng) */}
      <div className="bg-gradient-to-br from-indigo-600 to-purple-700 rounded-2xl shadow-xl p-6 text-white flex flex-col gap-4">
        <div className="border-b border-white/20 pb-4">
          <h3 className="text-sm font-medium text-indigo-100 mb-1">Doanh số Hôm nay</h3>
          <div className="text-3xl font-extrabold tracking-tight text-yellow-300">
            {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(todaySales)}
          </div>
        </div>

        <div>
          <h3 className="text-xs font-medium text-indigo-100 mb-1 uppercase tracking-wider">Lũy kế Tháng này</h3>
          <div className="text-xl font-bold mb-2">
            {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(currentMonthSales)}
          </div>
          <div className="flex justify-between text-[10px] mb-1 opacity-90">
            <span>Tiến độ: {kpiProgress.toFixed(1)}%</span>
            <span>Mục tiêu: {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(totalTarget)}</span>
          </div>
          <div className="w-full bg-white/20 rounded-full h-1.5">
            <div className="bg-green-400 h-1.5 rounded-full transition-all duration-500" style={{ width: `${kpiProgress}%` }}></div>
          </div>
        </div>
      </div>

      {/* 2. KHU VỰC NHẬP GIỎ HÀNG */}
      <div className="bg-white shadow-lg rounded-2xl p-5 border border-gray-100">
        <div className="space-y-3">
          {/* Chọn cửa hàng */}
          {shops.length > 0 && (
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Cửa hàng làm việc</label>
              {shops.length === 1 ? (
                <div className="w-full p-2.5 border border-gray-200 rounded-xl bg-gray-50 text-sm font-medium text-gray-700">
                  {shops[0].shop_name}
                </div>
              ) : (
                <select 
                  className="w-full p-2.5 border border-gray-300 rounded-xl bg-gray-50 text-sm font-medium text-gray-700 focus:ring-indigo-500 focus:border-indigo-500"
                  value={selectedShopId}
                  onChange={(e) => setSelectedShopId(e.target.value)}
                >
                  <option value="">-- Chọn cửa hàng --</option>
                  {shops.map((shop: any) => (
                    <option key={shop.shop_id} value={shop.shop_id}>{shop.shop_name}</option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Lọc hãng */}
          <select 
            className="w-full p-2.5 border border-gray-300 rounded-xl bg-gray-50 text-sm font-medium text-gray-700 focus:ring-indigo-500 focus:border-indigo-500" 
            value={selectedBrand} 
            onChange={(e) => { setSelectedBrand(e.target.value); setSelectedProductId(''); }}
          >
            <option value="">-- Lọc theo Nhãn hàng --</option>
            {uniqueBrands.map((b, i) => <option key={i} value={b}>{b}</option>)}
          </select>

          {/* Chọn món */}
          <select 
            className="w-full p-2.5 border border-gray-300 rounded-xl text-sm focus:ring-indigo-500 focus:border-indigo-500" 
            value={selectedProductId} 
            onChange={(e) => setSelectedProductId(e.target.value)}
          >
            <option value="" disabled>Chọn sản phẩm...</option>
            {filteredProducts.map(p => <option key={p.product_id} value={p.product_id}>{p.product_name}</option>)}
          </select>
            
          {/* Số lượng + Loại + Số tiền + Nút thêm */}
          <div className="flex space-x-2">
            <div className="flex flex-col w-16">
              <label className="text-[10px] font-bold text-gray-400 uppercase mb-0.5 ml-1">SL</label>
              <input 
                type="number" min="1" 
                className="w-full p-2.5 border border-gray-300 rounded-xl text-center text-sm font-medium focus:ring-indigo-500 focus:border-indigo-500" 
                value={qty} onChange={(e) => setQty(parseInt(e.target.value) || 1)} placeholder="SL"
              />
            </div>
            
            <div className="flex flex-col flex-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase mb-0.5 ml-1">Loại</label>
              <select
                className="w-full p-2.5 border border-gray-300 rounded-xl text-sm font-medium focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                value={selectedProductType}
                onChange={(e) => setSelectedProductType(e.target.value as any)}
              >
                <option value="Bán hàng">Bán hàng</option>
                <option value="Quà tặng">Quà tặng</option>
                <option value="Mẫu thử">Mẫu thử</option>
              </select>
            </div>

            <div className="flex flex-col flex-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase mb-0.5 ml-1">Số tiền</label>
              <div className="relative">
                <input 
                  type="text" 
                  className="w-full p-2.5 pr-6 border border-gray-300 rounded-xl text-right text-sm font-bold text-indigo-700 bg-indigo-50/30 focus:ring-indigo-500 focus:border-indigo-500" 
                  value={customAmount} onChange={(e) => setCustomAmount(formatNumber(e.target.value))} placeholder="Số tiền"
                />
                <span className="absolute right-2 top-2.5 text-gray-500 text-sm">đ</span>
              </div>
            </div>
          </div>

          {/* LOGIC ĐỐI THỦ (Đưa vào đây để gắn với từng sản phẩm) */}
          <div className="p-3 bg-indigo-50/50 rounded-xl border border-indigo-100 transition-all">
            <label className="flex items-center space-x-2 text-sm font-medium text-indigo-900 cursor-pointer">
              <input type="checkbox" checked={isConverted} onChange={(e) => setIsConverted(e.target.checked)} className="rounded text-indigo-600 w-4 h-4" />
              <span>Sản phẩm này là khách đổi từ hãng khác?</span>
            </label>
            {isConverted && (
              <input 
                type="text" placeholder="Nhập tên hãng đối thủ (VD: Huggies)..." 
                className="mt-3 w-full p-2 border border-indigo-200 rounded-lg text-sm focus:ring-indigo-500"
                value={competitorBrand} onChange={(e) => setCompetitorBrand(e.target.value)}
              />
            )}
          </div>

          {/* Nút Thêm vào giỏ */}
          <button 
            onClick={addToCart} 
            disabled={!selectedProductId || !customAmount || (isConverted && !competitorBrand)} 
            className="w-full bg-indigo-100 text-indigo-700 py-2.5 rounded-xl font-bold flex items-center justify-center disabled:opacity-50 active:scale-95 transition-transform"
          >
            + THÊM VÀO GIỎ
          </button>
        </div>

        {/* HIỂN THỊ GIỎ HÀNG TẠM */}
        {cart.length > 0 && (
          <div className="mt-5 bg-gray-50 rounded-xl p-4 border border-dashed border-gray-300">
            <ul className="space-y-3 mb-3">
              {cart.map((item, idx) => (
                <li key={idx} className="flex flex-col border-b border-gray-200 pb-2 last:border-0 last:pb-0">
                  <div className="flex justify-between items-center text-sm">
                    <div className="flex flex-col flex-1 pr-2 truncate">
                      <span className="text-gray-800 font-medium">{item.qty}x {item.product_name}</span>
                      {item.item_type !== 'Bán hàng' && (
                        <span className={`text-[10px] font-bold uppercase w-fit px-1.5 rounded ${
                          item.item_type === 'Quà tặng' ? 'bg-pink-100 text-pink-800' : 'bg-yellow-100 text-yellow-800'
                        }`}>
                          {item.item_type}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center space-x-3">
                      <span className="font-bold text-gray-900">{new Intl.NumberFormat('vi-VN').format(item.net_value)}đ</span>
                      <button onClick={() => removeFromCart(idx)} className="text-red-500 font-bold bg-red-50 w-6 h-6 rounded-md flex items-center justify-center">✕</button>
                    </div>
                  </div>
                  {item.switched_from_brand && item.item_type === 'Bán hàng' && (
                    <span className="text-[10px] text-green-700 bg-green-100 px-2 py-0.5 rounded w-fit mt-1">Đổi từ: {item.switched_from_brand}</span>
                  )}
                </li>
              ))}
            </ul>
            <div className="border-t border-gray-300 pt-3 flex justify-between items-center font-bold text-lg text-indigo-700">
              <span>Tổng giỏ hàng:</span>
              <span className="text-xl">{new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(cartTotal)}</span>
            </div>

            {applicableGifts.length > 0 && (
              <div className="mt-4 p-3 bg-pink-50 rounded-xl border border-pink-200">
                <h4 className="text-xs font-bold text-pink-700 uppercase mb-2 flex items-center">
                  <span className="mr-1">🎁</span> Quà tặng kèm theo
                </h4>
                <ul className="space-y-1">
                  {applicableGifts.map((gift, idx) => (
                    <li key={idx} className="text-sm text-pink-800 flex justify-between">
                      <span>{gift.product_name} ({gift.tier_name})</span>
                      <span className="font-bold">x{gift.qty}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <button
          onClick={() => submitOrderMutation.mutate()}
          disabled={cart.length === 0 || submitOrderMutation.isPending}
          className="w-full mt-5 bg-indigo-600 text-white py-3.5 rounded-xl font-bold uppercase tracking-wider shadow-lg shadow-indigo-200 hover:bg-indigo-700 active:scale-95 transition-all disabled:opacity-50"
        >
          {submitOrderMutation.isPending ? 'Đang lưu...' : 'XÁC NHẬN LƯU GIỎ HÀNG'}
        </button>
      </div>

      {/* 3. LỊCH SỬ HÔM NAY (Có chức năng Xóa/Sửa) */}
      <div className="space-y-4 pt-4">
        <h3 className="font-bold text-gray-800">Lịch sử hôm nay</h3>
        {Object.values(groupedOrders).filter((o:any) => o.created_at.startsWith(todayStr)).length === 0 ? (
          <p className="text-center text-gray-400 py-6 italic text-sm">Chưa có hóa đơn nào trong ngày.</p>
        ) : (
          Object.values(groupedOrders).filter((o:any) => o.created_at.startsWith(todayStr)).map((order: any) => (
            <div key={order.cart_id} className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
              <div className="flex justify-between items-center border-b pb-2 mb-2">
                <div>
                  <div className="text-[10px] font-mono text-gray-400 uppercase">{order.cart_id}</div>
                  <div className="text-xs text-gray-500">{new Date(order.created_at).toLocaleTimeString('vi-VN')}</div>
                </div>
                <div className="flex items-center space-x-3">
                  <span className="font-bold text-indigo-600 text-lg">{new Intl.NumberFormat('vi-VN').format(order.total)}đ</span>
                  {/* Nút xóa nguyên hóa đơn */}
                  <button onClick={() => { if(window.confirm('Xóa toàn bộ hóa đơn này?')) deleteCartMutation.mutate(order.cart_id) }} className="text-red-500 bg-red-50 p-1.5 rounded-lg">🗑️</button>
                </div>
              </div>
              
              <div className="text-xs text-gray-600 space-y-2">
                {order.items.map((item: any) => (
                  <div key={item.id} className="flex flex-col bg-gray-50 p-2 rounded-lg">
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-medium text-gray-800">• {item.qty}x {item.products?.product_name}</span>
                      <div className="flex items-center space-x-2">
                        <span className="font-bold">{new Intl.NumberFormat('vi-VN').format(item.net_value)}đ</span>
                        {/* Nút sửa / xóa từng món */}
                        <button onClick={() => { setEditingItem(item); setEditQty(item.qty); setEditAmount(formatNumber(item.net_value.toString())); }} className="text-blue-500">✏️</button>
                        <button onClick={() => { if(window.confirm('Xóa sản phẩm này khỏi hóa đơn?')) deleteItemMutation.mutate(item.id) }} className="text-red-400">✕</button>
                      </div>
                    </div>
                    {item.switched_from_brand && <span className="text-[9px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-bold w-fit">ĐỔI TỪ: {item.switched_from_brand.toUpperCase()}</span>}
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* MODAL SỬA NHANH SẢN PHẨM */}
      {editingItem && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-5 shadow-2xl">
            <h3 className="font-bold text-lg mb-4">Sửa sản phẩm</h3>
            <p className="text-sm text-gray-600 mb-4">{editingItem.products?.product_name}</p>
            
            <div className="flex space-x-2 mb-4">
              <input type="number" min="1" className="w-1/3 p-2.5 border rounded-xl text-center" value={editQty} onChange={e => setEditQty(parseInt(e.target.value)||1)} />
              <input type="text" className="w-2/3 p-2.5 border rounded-xl text-right font-bold text-indigo-700 bg-indigo-50" value={editAmount} onChange={e => setEditAmount(formatNumber(e.target.value))} />
            </div>

            <div className="flex space-x-2">
              <button onClick={() => setEditingItem(null)} className="flex-1 py-2.5 border rounded-xl font-medium text-gray-600">Hủy</button>
              <button onClick={() => updateItemMutation.mutate()} disabled={updateItemMutation.isPending} className="flex-1 py-2.5 bg-indigo-600 rounded-xl font-bold text-white">Lưu</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}