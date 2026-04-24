import React, { useState, useEffect, useRef, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { GoogleGenAI, Type } from '@google/genai';
import { Link } from 'react-router-dom';
import { Camera, Check, X, FileText, UserCircle, Gift, BarChart3, Plus, Minus, ImagePlus } from 'lucide-react';
import clsx from 'clsx';
import { matchProduct, learnAlias, logOcrError } from '../services/ocrLearningService';
import Scanbill from '../components/Scanbill';

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
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedProductGroupName, setSelectedProductGroupName] = useState('');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [qty, setQty] = useState(1);
  const [customAmount, setCustomAmount] = useState('');
  const [isConverted, setIsConverted] = useState(false);
  const [competitorBrand, setCompetitorBrand] = useState('');
  const [selectedProductType, setSelectedProductType] = useState<'Bán hàng' | 'Quà tặng' | 'Mẫu thử'>('Bán hàng');
  
  const [currentDistance, setCurrentDistance] = useState<number | null>(null);
  const [isLocationLoading, setIsLocationLoading] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedTierCounts, setSelectedTierCounts] = useState<Record<string, number>>({});
  const [isManualGiftMode, setIsManualGiftMode] = useState(false);
  
  // State cho thông tin khách hàng & Bill
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [billImages, setBillImages] = useState<File[]>([]);
  const [billPreviews, setBillPreviews] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  
  // State cho OCR Learning
  const [pendingOcrItems, setPendingOcrItems] = useState<PendingOcrItem[]>([]);
  const [showOcrModal, setShowOcrModal] = useState(false);
  
  // State cho Manual Selection trong OCR
  const [manualSelectIndex, setManualSelectIndex] = useState<number | null>(null);
  const [manualCategory, setManualCategory] = useState('');
  const [manualBrand, setManualBrand] = useState('');
  const [manualProductGroup, setManualProductGroup] = useState('');
  const [manualProductId, setManualProductId] = useState('');

  // Lấy chuỗi ngày YYYY-MM-DD theo giờ địa phương
  const todayStr = new Date(new Date().getTime() - (new Date().getTimezoneOffset() * 60000)).toISOString().split('T')[0];

  // --- FETCH DATA TỪ DATABASE ---

  // 0. Lấy thông tin mới nhất của PG từ DB để lấy manager_id chính xác
  const { data: pgProfile } = useQuery({
    queryKey: ['pg_profile', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data } = await supabase.from('profiles').select('manager_id').eq('id', user.id).single();
      return data;
    },
    enabled: !!user?.id,
  });

  // 1. Lấy danh sách Cửa hàng của PG
  const { data: rawShops } = useQuery({
    queryKey: ['pg_shops', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data } = await supabase.from('schedules').select('shop_id, program_id, created_by, shops(shop_name, latitude, longitude, allowed_distance), programs(require_bill_image)').eq('pg_id', user.id);
      const uniqueShops = new Map();
      data?.forEach((item: any) => { if (item.shop_id) uniqueShops.set(item.shop_id, item); });
      return Array.from(uniqueShops.values());
    },
    enabled: !!user?.id,
  });
  const shops = React.useMemo(() => rawShops || [], [rawShops]);

  // 2. Lấy danh sách Sản phẩm được phép bán (Từ SQL View)
  const { data: rawProducts } = useQuery({
    queryKey: ['allowed_products', user?.id, selectedShopId], 
    queryFn: async () => {
      if (!user?.id || !selectedShopId) return [];
      
      // 1. Get schedules for this PG and Shop today
      const { data: schedules } = await supabase
        .from('schedules')
        .select('program_id')
        .eq('pg_id', user.id)
        .eq('shop_id', selectedShopId)
        .lte('start_date', todayStr)
        .gte('end_date', todayStr);

      const programIds = schedules?.map(s => s.program_id) || [];
      if (programIds.length === 0) return [];

      // 2. Get brand_ids from program_brands
      const { data: programBrands } = await supabase
        .from('program_brands')
        .select('brand_id')
        .in('program_id', programIds);

      const brandIds = programBrands?.map(pb => pb.brand_id) || [];
      if (brandIds.length === 0) return [];

      // 3. Fetch products with nested relations
      const { data: productsData, error } = await supabase
        .from('products')
        .select(`
          *,
          product_group!inner (
            id,
            name,
            brand_id,
            brands!inner (
              brand_id,
              brand_name,
              categories (
                id,
                name
              )
            )
          )
        `)
        .in('product_group.brand_id', brandIds);
        
      if (error) {
        console.error('Lỗi tải sản phẩm:', error);
        return [];
      }

      // 3.5 Fetch gift products
      const { data: giftProductsData } = await supabase
        .from('products')
        .select('*')
        .eq('item_type', 'Quà tặng');
      
      const normalProducts = (productsData || []).map((p: any) => ({
        product_id: p.product_id,
        product_name: p.product_name || p.product_group?.name,
        product_group_name: p.product_group?.name || '',
        value: p.value || 0,
        item_type: p.item_type,
        brand_name: p.product_group?.brands?.brand_name || '',
        category_name: p.product_group?.brands?.categories?.name || '',
      }));

      const giftProducts = (giftProductsData || []).map((p: any) => ({
        product_id: p.product_id,
        product_name: p.product_name || 'Quà tặng',
        product_group_name: '',
        value: p.value || 0,
        item_type: p.item_type,
        brand_name: '',
        category_name: '',
      }));

      // Combine and remove duplicates by product_id
      const allProducts = [...normalProducts, ...giftProducts];
      const uniqueProducts = Array.from(new Map(allProducts.map(item => [item.product_id, item])).values());

      return uniqueProducts as Product[];
    },
    enabled: !!user?.id && !!selectedShopId,
  });
  const products = React.useMemo(() => rawProducts || [], [rawProducts]);

  // 2.5 Lấy danh sách Product Aliases (Lưu vào RAM, làm mới mỗi 1 tiếng)
  const { data: rawProductAliases } = useQuery({
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
  const productAliases = React.useMemo(() => rawProductAliases || [], [rawProductAliases]);

  const { data: rawOcrErrors } = useQuery({
    queryKey: ['ocr_errors'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ocr_errors')
        .select('raw_name, suggested_product_id')
        .gte('confirmed_error_count', 2);
      if (error) return [];
      return data;
    }
  });
  const ocrErrors = React.useMemo(() => rawOcrErrors || [], [rawOcrErrors]);

  // 3. Lấy Doanh số và KPI hôm nay
  const { data: dashboardStats } = useQuery({
    queryKey: ['todaySales', user?.id],
    queryFn: async () => {
      if (!user?.id) return { todaySales: 0, dailyKpiProgress: 0, monthlyKpiProgress: 0 };
      
      const dateObj = new Date();
      // Ensure we are in local timezone for todayStr
      const todayStr = new Date(dateObj.getTime() - (dateObj.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
      
      const startOfM = new Date(dateObj.getFullYear(), dateObj.getMonth(), 1).toISOString();
      const endOfM = new Date(dateObj.getFullYear(), dateObj.getMonth() + 1, 0, 23, 59, 59, 999).toISOString();
      
      const { data: ordersData, error: ordersError } = await supabase
        .from('order_details')
        .select(`
          net_value,
          switched_from_brand,
          orders!inner(created_at, pg_id)
        `)
        .eq('orders.pg_id', user.id)
        .gte('orders.created_at', startOfM)
        .lte('orders.created_at', endOfM);
        
      if (ordersError) {
        console.error('Lỗi tải doanh số:', ordersError);
        return { todaySales: 0, dailyKpiProgress: 0, monthlyKpiProgress: 0 };
      }
      
      const startStr = startOfM.split('T')[0];
      const endStr = new Date(dateObj.getFullYear(), dateObj.getMonth() + 1, 0).toISOString().split('T')[0];
      
      const { data: kpiData } = await supabase
        .from('kpis')
        .select('*')
        .eq('pg_id', user.id)
        .gte('end_date', startStr)
        .lte('start_date', endStr);
        
      let monthlyTotalAmount = 0;
      let dailyTotalAmount = 0;
      
      ordersData?.forEach((item: any) => {
        // Chỉ tính doanh số các món không phải quà tặng 
        if (!item.switched_from_brand?.startsWith('QUÀ TẶNG:')) {
          const o = Array.isArray(item.orders) ? item.orders[0] : item.orders;
          const val = Number(item.net_value) || 0;
          monthlyTotalAmount += val;
          
          if (o?.created_at) {
            const orderDateStr = new Date(new Date(o.created_at).getTime() - (new Date().getTimezoneOffset() * 60000)).toISOString().split('T')[0];
            if (orderDateStr === todayStr) {
              dailyTotalAmount += val;
            }
          }
        }
      });
      
      const totalMonthlyTarget = (kpiData || []).reduce((sum, kpi) => sum + Number(kpi.sale_target), 0);
      const daysInMonth = new Date(dateObj.getFullYear(), dateObj.getMonth() + 1, 0).getDate();
      const dailyTarget = totalMonthlyTarget / daysInMonth;
      
      const dailyKpiProgress = dailyTarget > 0 ? (dailyTotalAmount / dailyTarget) * 100 : 0;
      const monthlyKpiProgress = totalMonthlyTarget > 0 ? (monthlyTotalAmount / totalMonthlyTarget) * 100 : 0;
      
      return { 
        todaySales: dailyTotalAmount, 
        dailyKpiProgress, 
        monthlyKpiProgress 
      };
    },
    enabled: !!user?.id,
  });

  const todaySales = dashboardStats?.todaySales || 0;
  const dailyKpiProgress = dashboardStats?.dailyKpiProgress || 0;
  const monthlyKpiProgress = dashboardStats?.monthlyKpiProgress || 0;

  // 4 & 5. Lấy dữ liệu Khuyến mãi và Tồn kho
  const { data: promoAndInventoryData } = useQuery({
    queryKey: ['promo_and_inventory', selectedShopId, pgProfile?.manager_id, shops],
    queryFn: async () => {
      const supId = pgProfile?.manager_id;
      const selectedSchedule = shops.find((s: any) => s.shop_id === selectedShopId);
      
      if (!selectedShopId || !supId || !selectedSchedule?.program_id) {
        return { promotions: [], inventory: [] };
      }

      try {
        // Thử gọi RPC mới
        const { data: rpcData, error: rpcError } = await supabase.rpc('get_sup_promotions_and_inventory', {
          p_sup_id: supId,
          p_shop_id: selectedShopId
        });

        if (!rpcError && rpcData) {
          return {
            promotions: rpcData.promotions || [],
            inventory: rpcData.inventory || []
          };
        }
      } catch (err) {
        console.log('RPC chưa được tạo, sử dụng logic fallback...');
      }

      // Fallback: Logic cũ nếu chưa chạy SQL tạo RPC
      const { data: promos } = await supabase
        .from('promotions')
        .select('*')
        .eq('program_id', selectedSchedule.program_id);
        
      const activePromotions = await Promise.all((promos || []).map(async (p) => {
        const { data: tiers } = await supabase.from('promotion_tiers').select('*').eq('promotion_id', p.promotion_id);
        const tiersWithConditions = await Promise.all((tiers || []).map(async (t) => {
          const { data: conds } = await supabase.from('promotion_conditions').select('*').eq('tier_id', t.id);
          return { ...t, conditions: conds || [] };
        }));
        return { ...p, tiers: tiersWithConditions };
      }));

      const { data: inventory } = await supabase
        .from('inventories')
        .select('product_id, quantity')
        .eq('sup_id', supId);

      return {
        promotions: activePromotions,
        inventory: inventory || []
      };
    },
    enabled: !!selectedShopId && !!pgProfile?.manager_id && shops.length > 0,
  });

  const activePromotions = React.useMemo(() => promoAndInventoryData?.promotions || [], [promoAndInventoryData?.promotions]);
  const inventoryData = promoAndInventoryData?.inventory || [];

  // --- USE EFFECTS LÀM MƯỢT FORM ---
  
  // Tự động chọn cửa hàng nếu PG chỉ có 1 lịch
  useEffect(() => {
    if (shops.length === 1 && !selectedShopId) setSelectedShopId(shops[0].shop_id);
  }, [shops, selectedShopId]);

  // Tính khoảng cách khi chọn cửa hàng
  useEffect(() => {
    if (!selectedShopId) {
      setCurrentDistance(null);
      setLocationError(null);
      return;
    }

    const selectedSchedule = shops.find((s: any) => s.shop_id === selectedShopId);
    const shopData = selectedSchedule?.shops;

    if (!shopData?.latitude || !shopData?.longitude) {
      setCurrentDistance(null);
      setLocationError("Cửa hàng này chưa được thiết lập tọa độ.");
      return;
    }

    setIsLocationLoading(true);
    setLocationError(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        
        const R = 6371e3; // metres
        const φ1 = lat * Math.PI/180;
        const φ2 = shopData.latitude * Math.PI/180;
        const Δφ = (shopData.latitude - lat) * Math.PI/180;
        const Δλ = (shopData.longitude - lng) * Math.PI/180;

        const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
                  Math.cos(φ1) * Math.cos(φ2) *
                  Math.sin(Δλ/2) * Math.sin(Δλ/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

        const distance = R * c;
        setCurrentDistance(distance);
        setIsLocationLoading(false);
      },
      (err) => {
        console.error("Lỗi lấy vị trí:", err);
        setLocationError("Không thể lấy vị trí hiện tại của bạn. Vui lòng bật định vị.");
        setCurrentDistance(null);
        setIsLocationLoading(false);
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  }, [selectedShopId, shops]);

  // Tự động điền giá tiền khi chọn sản phẩm
  useEffect(() => {
    const product = products.find(p => p.product_id === selectedProductId);
    if (product && qty > 0) {
      setCustomAmount(product.item_type === 'Sản phẩm bán' || selectedProductType === 'Bán hàng' ? formatNumber((product.value * qty).toString()) : '0');
    } else setCustomAmount('');
  }, [selectedProductId, qty, products, selectedProductType]);

  // --- LOGIC FORM NHẬP LIỆU ---
  
  const uniqueCategories = Array.from(new Set(products.map(p => p.category_name).filter(Boolean) as string[]));
  const availableBrandsForCategory = selectedCategory 
    ? products.filter(p => p.category_name === selectedCategory)
    : products;
  const uniqueBrands = Array.from(new Set(availableBrandsForCategory.map(p => p.brand_name).filter(Boolean) as string[]));
  
  const filteredProducts = products.filter(p => {
    if (selectedBrand && p.brand_name !== selectedBrand) return false;
    if (selectedCategory && p.category_name !== selectedCategory) return false;
    return true;
  });

  const uniqueProductGroupNames = Array.from(new Set(filteredProducts.map(p => p.product_group_name).filter(Boolean) as string[]));
  const availableProducts = filteredProducts.filter(p => p.product_group_name === selectedProductGroupName);

  // --- LOGIC FORM CHỌN THỦ CÔNG (OCR) ---
  const manualAvailableBrands = manualCategory 
    ? products.filter(p => p.category_name === manualCategory)
    : products;
  const manualUniqueBrands = Array.from(new Set(manualAvailableBrands.map(p => p.brand_name).filter(Boolean) as string[]));
  
  const manualFilteredProducts = products.filter(p => {
    if (manualBrand && p.brand_name !== manualBrand) return false;
    if (manualCategory && p.category_name !== manualCategory) return false;
    return true;
  });

  const manualUniqueProductGroupNames = Array.from(new Set(manualFilteredProducts.map(p => p.product_group_name).filter(Boolean) as string[]));
  const manualAvailableProducts = manualFilteredProducts.filter(p => p.product_group_name === manualProductGroup);

  // Tự động chọn chi tiết sản phẩm nếu chỉ có 1 lựa chọn
  useEffect(() => {
    if (selectedProductGroupName && availableProducts.length === 1 && !selectedProductId) {
      setSelectedProductId(availableProducts[0].product_id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProductGroupName, availableProducts.length, selectedProductId]);

  const addToCart = () => {
    const product = products.find(p => p.product_id === selectedProductId);
    const finalAmount = parseInt(customAmount.replace(/\./g, ''), 10);
    if (!product || isNaN(qty) || qty <= 0 || isNaN(finalAmount)) return;

    setCart([...cart, { 
      product_id: product.product_id, 
      product_name: product.product_name, 
      product_group_name: product.product_group_name,
      qty, net_value: finalAmount,
      item_type: (product as any).item_type || selectedProductType,
      switched_from_brand: isConverted ? competitorBrand : null
    }]);
    
    // Reset form sau khi thêm
    setSelectedProductGroupName(''); setSelectedProductId(''); setQty(1); setCustomAmount(''); setIsConverted(false); setCompetitorBrand('');
  };

  const cartTotal = cart.reduce((sum, item) => sum + item.net_value, 0);

  const handleScanComplete = (newCartItems: CartItem[], newPendingItems: PendingOcrItem[], imageFile: File) => {
    // Thêm ảnh vào danh sách ảnh
    setBillImages(prev => [...prev, imageFile]);
    setBillPreviews(prev => [...prev, URL.createObjectURL(imageFile)]);

    if (newCartItems.length > 0) {
      setCart(prev => [...prev, ...newCartItems]);
      toast.success(`Đã tự động thêm ${newCartItems.length} sản phẩm vào giỏ hàng!`);
    }

    if (newPendingItems.length > 0) {
      setPendingOcrItems(newPendingItems);
      setShowOcrModal(true);
    } else if (newCartItems.length === 0) {
      toast.warning('Đã quét hóa đơn nhưng không có sản phẩm nào khớp với danh mục được phép bán.');
    }
  };

  // --- XỬ LÝ XÁC NHẬN OCR ---
  const handleConfirmPendingItems = async () => {
    const resolvedCartItems: CartItem[] = [];
    
    for (const pending of pendingOcrItems) {
      if (pending.selected_product_id) {
         // 1. Ghi nhận học tập (Learn Alias)
         await learnAlias(pending.original_name, pending.selected_product_id, pending.price || 0);
         
         // 2. Thêm vào giỏ hàng
         const matchedProduct = products.find(p => p.product_id === pending.selected_product_id);
         if (matchedProduct) {
           resolvedCartItems.push({
              product_id: matchedProduct.product_id,
              product_name: matchedProduct.product_name,
              product_group_name: matchedProduct.product_group_name,
              qty: pending.qty,
              net_value: pending.price || matchedProduct.value * pending.qty,
              item_type: (matchedProduct.item_type === 'Sản phẩm bán' ? 'Bán hàng' : matchedProduct.item_type) as 'Bán hàng' | 'Quà tặng' | 'Mẫu thử',
              switched_from_brand: null
           });
         }
      } else {
        // Nếu PG chọn "Bỏ qua sản phẩm này" -> Ghi nhận lỗi OCR
        await logOcrError(pending.original_name, null, user?.id || '', pending.price || 0, pending.qty);
      }
    }
    
    if (resolvedCartItems.length > 0) {
      setCart(prev => [...prev, ...resolvedCartItems]);
      toast.success(`Đã thêm ${resolvedCartItems.length} sản phẩm được xác nhận vào giỏ hàng!`);
    }
    
    setShowOcrModal(false);
    setPendingOcrItems([]);
  };

  // --- LOGIC TÍNH TOÁN QUÀ TẶNG ---
  const eligibleTiersData = useMemo(() => {
    if (cart.length === 0) return { eligibleNormalTiers: [], eligibleOntopTiers: [], sortedGroupedTiers: [] };

    let allNormalTiers: any[] = [];
    let eligibleOntopTiers: any[] = [];

    activePromotions.forEach((promo: any) => {
      if (promo.shop_id && promo.shop_id !== selectedShopId) return;

      promo.tiers?.forEach((tier: any) => {
        let allConditionsMet = true;
        if (tier.conditions && tier.conditions.length > 0) {
          tier.conditions.forEach((cond: any) => {
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
            if (conditionValue < cond.min_target_value) allConditionsMet = false;
          });
        }

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
            if (tier.is_ontop) eligibleOntopTiers.push(giftData);
            else allNormalTiers.push(giftData);
          }
        }
      });
    });

    const groupedNormalTiers: Record<string, any> = {};
    allNormalTiers.forEach(tier => {
      const key = `${tier.tier_name}_${tier.min_total_qty}`;
      if (!groupedNormalTiers[key]) {
        groupedNormalTiers[key] = { tier_name: tier.tier_name, min_total_qty: tier.min_total_qty, gifts: [] };
      }
      groupedNormalTiers[key].gifts.push(tier);
    });

    const sortedGroupedTiers = Object.values(groupedNormalTiers).sort((a: any, b: any) => b.min_total_qty - a.min_total_qty);
    const eligibleNormalTiers = sortedGroupedTiers.filter((group: any) => group.min_total_qty > 0 && group.min_total_qty <= cartTotal);

    return { eligibleNormalTiers, eligibleOntopTiers, sortedGroupedTiers };
  }, [cart, cartTotal, activePromotions, products, selectedShopId]);

  // Đồng bộ selectedTierCounts khi cart thay đổi hoặc chế độ thay đổi
  useEffect(() => {
    const { eligibleNormalTiers } = eligibleTiersData;
    
    if (!isManualGiftMode) {
      // Chế độ tự động: Tính toán Greedy
      let remainingAmount = cartTotal;
      let suggestedCounts: Record<string, number> = {};
      const greedyTiers = [...eligibleNormalTiers].sort((a: any, b: any) => b.min_total_qty - a.min_total_qty);
      
      for (const group of greedyTiers) {
        const stockInfo = group.gifts.map((g: any) => {
          const inv = inventoryData.find((i: any) => i.product_id === g.product_id);
          const stock = inv ? inv.quantity : 0;
          return Math.floor(stock / g.qty);
        });
        const tierStock = stockInfo.length > 0 ? Math.min(...stockInfo) : 0;

        const maxAffordable = Math.floor(remainingAmount / group.min_total_qty);
        const count = Math.min(maxAffordable, tierStock);
        
        if (count > 0) {
          suggestedCounts[`${group.tier_name}_${group.min_total_qty}`] = count;
          remainingAmount -= count * group.min_total_qty;
        }
      }
      
      setSelectedTierCounts(prev => {
        // Chỉ update nếu thực sự thay đổi để tránh loop
        if (JSON.stringify(suggestedCounts) === JSON.stringify(prev)) return prev;
        return suggestedCounts;
      });
    } else {
      // Chế độ thủ công: Chỉ loại bỏ các mốc không còn hợp lệ
      setSelectedTierCounts(prev => {
        const newCounts = { ...prev };
        let updated = false;
        Object.keys(newCounts).forEach(key => {
          if (!eligibleNormalTiers.some((g: any) => `${g.tier_name}_${g.min_total_qty}` === key)) {
            delete newCounts[key];
            updated = true;
          }
        });
        return updated ? newCounts : prev;
      });
    }
  }, [cartTotal, eligibleTiersData, isManualGiftMode, inventoryData]);

  const applicableGifts = useMemo(() => {
    const { sortedGroupedTiers, eligibleOntopTiers } = eligibleTiersData;
    let finalNormalGifts: any[] = [];
    let currentSelectedTotal = 0;

    for (const group of sortedGroupedTiers) {
      const key = `${group.tier_name}_${group.min_total_qty}`;
      const count = selectedTierCounts[key] || 0;
      if (count > 0) {
        const possibleCount = Math.min(count, Math.floor((cartTotal - currentSelectedTotal) / group.min_total_qty));
        if (possibleCount > 0) {
          group.gifts.forEach((gift: any) => {
            const existingGift = finalNormalGifts.find(g => g.product_id === gift.product_id && g.tier_name === gift.tier_name);
            if (existingGift) existingGift.qty += gift.qty * possibleCount;
            else finalNormalGifts.push({ ...gift, qty: gift.qty * possibleCount });
          });
          currentSelectedTotal += possibleCount * group.min_total_qty;
        }
      }
    }

    let finalGifts = [...finalNormalGifts];
    for (const ontop of eligibleOntopTiers) {
      if (cartTotal >= ontop.min_total_qty) {
        const inv = inventoryData.find((i: any) => i.product_id === ontop.product_id);
        const stock = inv ? inv.quantity : 0;
        
        let qtyToAdd = ontop.qty;
        const currentQty = finalGifts.reduce((sum, g) => g.product_id === ontop.product_id ? sum + g.qty : sum, 0);
        const availableStock = Math.max(0, stock - currentQty);
        
        qtyToAdd = Math.min(qtyToAdd, availableStock);
        
        if (qtyToAdd > 0) {
          const existingGift = finalGifts.find(g => g.product_id === ontop.product_id && g.tier_name === ontop.tier_name);
          if (existingGift) existingGift.qty += qtyToAdd;
          else finalGifts.push({ ...ontop, qty: qtyToAdd });
        }
      }
    }
    return finalGifts;
  }, [eligibleTiersData, selectedTierCounts, cartTotal, inventoryData]);

  const eligibleTiers = eligibleTiersData.eligibleNormalTiers;


  const selectedSchedule = shops.find((s: any) => s.shop_id === selectedShopId);
  const requireBillImage = selectedSchedule?.programs?.require_bill_image || false;

  // --- MUTATION: LƯU DB (SỬ DỤNG RPC VỚI HEADER-DETAIL) ---
  const submitOrderMutation = useMutation({
    mutationFn: async () => {
      if (!selectedShopId) throw new Error('Vui lòng chọn cửa hàng');

      const shopData = selectedSchedule?.shops;
      const allowedDistance = shopData?.allowed_distance || 500;

      if (requireBillImage && billImages.length === 0) {
        throw new Error('Vui lòng chụp ít nhất 1 ảnh hóa đơn');
      }

      if (currentDistance !== null && currentDistance > allowedDistance) {
        throw new Error(`Bạn đang ở quá xa cửa hàng (${Math.round(currentDistance)}m). Khoảng cách cho phép là ${allowedDistance}m.`);
      }

      // 1. Lấy vị trí hiện tại
      const getCoords = () => new Promise<{lat: number, lng: number}>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
          () => resolve({ lat: 0, lng: 0 }),
          { timeout: 5000 }
        );
      });
      const coords = await getCoords();

      // Calculate distance if shop has coordinates
      const programId = selectedSchedule?.program_id;
      
      let distance = null;
      if (coords.lat !== 0 && coords.lng !== 0 && shopData?.latitude && shopData?.longitude) {
        const R = 6371e3; // metres
        const φ1 = coords.lat * Math.PI/180; // φ, λ in radians
        const φ2 = shopData.latitude * Math.PI/180;
        const Δφ = (shopData.latitude - coords.lat) * Math.PI/180;
        const Δλ = (shopData.longitude - coords.lng) * Math.PI/180;

        const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
                  Math.cos(φ1) * Math.cos(φ2) *
                  Math.sin(Δλ/2) * Math.sin(Δλ/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

        distance = R * c; // in metres
      }

      // 2. Tạo Cart ID & Program ID
      const { data: finalCartId } = await supabase.rpc('generate_cart_id');

      // 3. Upload tất cả ảnh lên Storage
      const uploadPromises = billImages.map(async (file, index) => {
        const fileExt = file.name.split('.').pop();
        const fileName = `${finalCartId}_${index}.${fileExt}`;
        const filePath = `${programId}/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from('Bills')
          .upload(filePath, file);
        
        if (uploadError) {
          if (uploadError.message.includes('Bucket not found')) {
            throw new Error('Lỗi: Chưa tạo bucket "Bills" trong Supabase Storage. Vui lòng tạo bucket tên "Bills" (chế độ Public) để tải ảnh hóa đơn.');
          }
          throw uploadError;
        }

        const { data: { publicUrl } } = supabase.storage.from('Bills').getPublicUrl(filePath);
        return publicUrl;
      });

      const publicUrls = await Promise.all(uploadPromises);
      const billImageUrlString = publicUrls.join(',');

      // 4. Chuẩn bị Header
      const header = {
        cart_id: finalCartId,
        pg_id: user?.id,
        program_id: programId,
        shop_id: selectedShopId,
        bill_image_url: billImageUrlString,
        latitude: coords.lat,
        longitude: coords.lng,
        distance_from_shop: distance,
        customer_name: customerName,
        customer_phone: customerPhone
      };

      // 5. Chuẩn bị Details
      const sellItems = cart.map(item => ({
        product_id: item.product_id,
        qty: item.qty,
        net_value: item.net_value,
        promotion_id: null, // Sẽ bổ sung nếu có logic gán promo cho từng dòng
        is_gift: false,
        switched_from_brand: item.switched_from_brand
      }));

      const giftItems = applicableGifts.map(gift => ({
        product_id: gift.product_id,
        qty: gift.qty,
        net_value: 0,
        promotion_id: null, // Có thể lưu tier_id vào đây
        is_gift: true,
        switched_from_brand: `QUÀ TẶNG: ${gift.tier_name}`
      }));

      const details = [...sellItems, ...giftItems];

      // 6. Gọi RPC thực hiện Transaction
      const { error: submitError } = await supabase.rpc('create_order_transaction', { 
        p_header: header, 
        p_details: details 
      });

      if (submitError) throw submitError;
    },
    onSuccess: () => {
      toast.success('🎉 Đã lưu đơn hàng và tải ảnh thành công!');
      setCart([]);
      setSelectedTierCounts({});
      setIsManualGiftMode(false);
      setCustomerName('');
      setCustomerPhone('');
      setBillImages([]);
      setBillPreviews([]);
      queryClient.invalidateQueries({ queryKey: ['todaySales'] }); 
      queryClient.invalidateQueries({ queryKey: ['promo_and_inventory'] }); 
    },
    onError: (error: any) => toast.error(`Lỗi: ${error.message}`)
  });

  return (
    <div className="space-y-6 max-w-lg mx-auto pb-10 px-4">
      <h2 className="text-2xl font-bold text-gray-900 pt-6">Bảng điều khiển PG</h2>

      {/* WIDGET BÁO CÁO */}
      <div className="bg-gradient-to-br from-indigo-600 to-purple-700 rounded-2xl shadow-xl p-6 text-white space-y-4">
        <div>
          <h3 className="text-sm font-medium text-indigo-100 mb-1">Doanh số Hôm nay</h3>
          <div className="text-3xl font-extrabold text-yellow-300">
            {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(todaySales)}
          </div>
        </div>
        
        <div className="space-y-3 pt-4 border-t border-indigo-500/50">
          <div>
            <div className="flex justify-between text-xs text-indigo-100 mb-1.5 font-medium">
              <span>Tiến độ Ngày</span>
              <span>{dailyKpiProgress.toFixed(1)}%</span>
            </div>
            <div className="w-full bg-indigo-900/50 rounded-full h-2">
              <div className="bg-green-400 h-2 rounded-full transition-all duration-500 shadow-[0_0_8px_rgba(74,222,128,0.4)]" style={{ width: `${Math.min(dailyKpiProgress, 100)}%` }}></div>
            </div>
          </div>
          <div>
            <div className="flex justify-between text-xs text-indigo-100 mb-1.5 font-medium">
              <span>Tiến độ Tháng</span>
              <span>{monthlyKpiProgress.toFixed(1)}%</span>
            </div>
            <div className="w-full bg-indigo-900/50 rounded-full h-2">
              <div className="bg-yellow-400 h-2 rounded-full transition-all duration-500 shadow-[0_0_8px_rgba(250,204,21,0.4)]" style={{ width: `${Math.min(monthlyKpiProgress, 100)}%` }}></div>
            </div>
          </div>
        </div>
      </div>

      {/* KHU VỰC NHẬP LIỆU (FORM) */}
      <div className="bg-white shadow-lg rounded-2xl p-5 border border-gray-100 space-y-4">
        
        <select className="w-full p-2.5 border rounded-xl" value={selectedShopId} onChange={e => setSelectedShopId(e.target.value)}>
          <option value="">-- Chọn cửa hàng làm việc --</option>
          {shops.map((s: any) => <option key={s.shop_id} value={s.shop_id}>{s.shops?.shop_name}</option>)}
        </select>

        {selectedShopId && (
          <div className="text-sm px-1">
            {isLocationLoading ? (
              <span className="text-gray-500 flex items-center gap-2">
                <div className="w-3 h-3 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin"></div>
                Đang kiểm tra vị trí...
              </span>
            ) : locationError ? (
              <span className="text-red-500">{locationError}</span>
            ) : currentDistance !== null && !isNaN(currentDistance) ? (
              <span className={`font-medium ${
                currentDistance > (shops.find((s: any) => s.shop_id === selectedShopId)?.shops?.allowed_distance || 500) 
                  ? 'text-red-600' 
                  : 'text-green-600'
              }`}>
                Khoảng cách đến shop: {Math.round(currentDistance)}m 
                (Cho phép: {shops.find((s: any) => s.shop_id === selectedShopId)?.shops?.allowed_distance || 500}m)
              </span>
            ) : null}
          </div>
        )}

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <select className="w-full p-2.5 border rounded-xl" value={selectedCategory} onChange={e => {setSelectedCategory(e.target.value); setSelectedProductGroupName(''); setSelectedProductId('');}}>
              <option value="">-- Lọc Ngành hàng --</option>
              {uniqueCategories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select className="w-full p-2.5 border rounded-xl" value={selectedBrand} onChange={e => {setSelectedBrand(e.target.value); setSelectedProductGroupName(''); setSelectedProductId('');}}>
              <option value="">-- Lọc Hãng --</option>
              {uniqueBrands.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <select className="w-full p-2.5 border rounded-xl" value={selectedProductGroupName} onChange={e => {setSelectedProductGroupName(e.target.value); setSelectedProductId('');}}>
            <option value="" disabled>Chọn Nhóm SP...</option>
            {uniqueProductGroupNames.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
          <select className="w-full p-2.5 border rounded-xl" value={selectedProductId} onChange={e => setSelectedProductId(e.target.value)}>
            <option value="" disabled>Chọn Sản phẩm...</option>
            {availableProducts.map(p => (
              <option key={p.product_id} value={p.product_id}>{p.product_name || 'Mặc định'}</option>
            ))}
          </select>
        </div>

        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <label className="text-xs text-gray-400">Số lượng</label>
            <div className="flex items-center">
              <button 
                type="button"
                onClick={() => setQty(Math.max(1, qty - 1))}
                className="p-2.5 bg-gray-50 border border-gray-200 rounded-l-xl hover:bg-gray-100 transition-colors"
                title="Giảm số lượng"
              >
                <Minus className="w-4 h-4 text-gray-500" />
              </button>
              <input 
                type="number" 
                min="1" 
                className="w-full p-2.5 border-t border-b border-gray-200 text-center font-bold focus:outline-none" 
                value={qty} 
                onChange={e => setQty(parseInt(e.target.value)||1)} 
              />
              <button 
                type="button"
                onClick={() => setQty(qty + 1)}
                className="p-2.5 bg-gray-50 border border-gray-200 rounded-r-xl hover:bg-gray-100 transition-colors"
                title="Tăng số lượng"
              >
                <Plus className="w-4 h-4 text-gray-500" />
              </button>
            </div>
          </div>
          <div className="flex-[1.5]">
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
          
          <Scanbill 
            products={products} 
            productAliases={productAliases} 
            ocrErrors={ocrErrors}
            onScanComplete={handleScanComplete} 
            disabled={!selectedShopId} 
          />
        </div>
      </div>

      {/* HIỂN THỊ GIỎ HÀNG */}
      {cart.length > 0 && (
        <div className="bg-white shadow-lg rounded-2xl p-5 border border-gray-100">
          <ul className="space-y-3 mb-4">
            {cart.map((item, idx) => (
              <li key={idx} className="flex justify-between items-center text-sm border-b border-gray-100 pb-3 last:border-0 last:pb-0">
                <div className="flex flex-col pr-2">
                  <span className="font-medium text-gray-800">{item.qty != null ? (isNaN(Number(item.qty)) ? 0 : item.qty) : 0}x {item.product_group_name}</span>
                  <span className="text-xs text-gray-500">{item.product_name}</span>
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

          {/* THÔNG TIN KHÁCH HÀNG & CHỤP BILL */}
          <div className="mt-6 space-y-4 border-t border-dashed border-gray-200 pt-4">
            <div className="grid grid-cols-2 gap-3">
              <input 
                type="text" 
                placeholder="Tên khách hàng" 
                className="p-2.5 border rounded-xl text-sm" 
                value={customerName} 
                onChange={e => setCustomerName(e.target.value)} 
              />
              <input 
                type="tel" 
                placeholder="Số điện thoại" 
                className="p-2.5 border rounded-xl text-sm" 
                value={customerPhone} 
                onChange={e => setCustomerPhone(e.target.value)} 
              />
            </div>

            <div className="space-y-3">
              <input 
                type="file" 
                accept="image/*" 
                capture="environment" 
                className="hidden" 
                ref={fileInputRef}
                multiple
                onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  if (files.length > 0) {
                    setBillImages(prev => [...prev, ...files]);
                    const newPreviews = files.map(file => URL.createObjectURL(file));
                    setBillPreviews(prev => [...prev, ...newPreviews]);
                  }
                }}
              />
              <input 
                type="file" 
                accept="image/*" 
                className="hidden" 
                ref={galleryInputRef}
                multiple
                onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  if (files.length > 0) {
                    setBillImages(prev => [...prev, ...files]);
                    const newPreviews = files.map(file => URL.createObjectURL(file));
                    setBillPreviews(prev => [...prev, ...newPreviews]);
                  }
                }}
              />
              
              {/* Grid hiển thị ảnh đã chọn */}
              {billPreviews.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {billPreviews.map((url, idx) => (
                    <div key={idx} className="relative rounded-lg overflow-hidden border border-gray-200 aspect-square group">
                      <img src={url} alt={`Bill ${idx}`} className="w-full h-full object-cover" />
                      <button 
                        onClick={() => {
                          setBillImages(prev => prev.filter((_, i) => i !== idx));
                          setBillPreviews(prev => prev.filter((_, i) => i !== idx));
                        }}
                        className="absolute top-1 right-1 bg-red-500 text-white p-0.5 rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-indigo-200 rounded-lg flex flex-col items-center justify-center text-indigo-400 hover:border-indigo-400 hover:text-indigo-600 transition-all bg-indigo-50/30 aspect-square"
                  >
                    <Camera className="w-5 h-5" />
                    <span className="text-[10px] font-medium">Chụp ảnh</span>
                  </button>
                  <button 
                    onClick={() => galleryInputRef.current?.click()}
                    className="border-2 border-dashed border-indigo-200 rounded-lg flex flex-col items-center justify-center text-indigo-400 hover:border-indigo-400 hover:text-indigo-600 transition-all bg-indigo-50/30 aspect-square"
                  >
                    <ImagePlus className="w-5 h-5" />
                    <span className="text-[10px] font-medium">Từ thư viện</span>
                  </button>
                </div>
              )}

              {billPreviews.length === 0 && (
                <div className="flex gap-2">
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="flex-1 py-8 border-2 border-dashed border-indigo-200 rounded-xl flex flex-col items-center justify-center text-indigo-400 hover:border-indigo-400 hover:text-indigo-600 transition-all bg-indigo-50/30"
                  >
                    <Camera className="w-8 h-8 mb-2" />
                    <span className="text-sm font-medium">Chụp hóa đơn {requireBillImage ? '(Bắt buộc)' : '(Tùy chọn)'}</span>
                  </button>
                  <button 
                    onClick={() => galleryInputRef.current?.click()}
                    className="flex-1 py-8 border-2 border-dashed border-indigo-200 rounded-xl flex flex-col items-center justify-center text-indigo-400 hover:border-indigo-400 hover:text-indigo-600 transition-all bg-indigo-50/30"
                  >
                    <ImagePlus className="w-8 h-8 mb-2" />
                    <span className="text-sm font-medium">Tải ảnh thư viện</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* KHU VỰC QUÀ TẶNG - Đề xuất hoặc Thủ công */}
          {eligibleTiers.length > 0 && (
            <div className="mt-6 pt-6 border-t border-gray-100">
              {/* Header logic */}
              <div className="flex justify-between items-end mb-4 px-1">
                <div>
                  <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider flex items-center">
                    <span className="mr-2">🎁</span> {isManualGiftMode ? 'CHỌN QUÀ TẶNG THỦ CÔNG' : 'QUÀ TẶNG ĐỀ XUẤT'}
                  </h3>
                  <p className="text-[10px] text-gray-500 mt-1 font-medium">
                    {isManualGiftMode 
                      ? 'PG đang tự chọn combo quà tặng theo yêu cầu khách' 
                      : 'Hệ thống đã tự động chọn gói quà tối ưu nhất'}
                  </p>
                </div>
                {!isManualGiftMode ? (
                  <button 
                    onClick={() => setIsManualGiftMode(true)}
                    className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded hover:bg-indigo-100 transition-colors"
                  >
                    Thay đổi / Chọn quà khác
                  </button>
                ) : (
                  <button 
                    onClick={() => setIsManualGiftMode(false)}
                    className="text-[10px] font-bold text-gray-500 bg-gray-100 px-2 py-1 rounded hover:bg-gray-200 transition-colors"
                  >
                    Dùng đề xuất mặc định
                  </button>
                )}
              </div>

              {/* Ngân sách chỉ hiện khi ở chế độ thủ công */}
              {isManualGiftMode && (
                <div className="bg-indigo-50 p-3 rounded-xl mb-4 flex justify-between items-center border border-indigo-100">
                  <span className="text-xs font-bold text-indigo-700">Ngân sách quà còn lại:</span>
                  <span className="text-sm font-black text-indigo-700">
                    {new Intl.NumberFormat('vi-VN').format(
                      cartTotal - eligibleTiers
                        .reduce((sum, t) => sum + (selectedTierCounts[`${t.tier_name}_${t.min_total_qty}`] || 0) * t.min_total_qty, 0)
                    )}đ
                  </span>
                </div>
              )}

              {/* Danh sách combo quà (Chỉ hiện khi thủ công) */}
              {isManualGiftMode && (
                <div className="space-y-3 mb-6">
                  {eligibleTiers.map((tier, idx) => {
                    const key = `${tier.tier_name}_${tier.min_total_qty}`;
                    const count = selectedTierCounts[key] || 0;
                    const selectedTotal = eligibleTiers
                      .reduce((sum, t) => sum + (selectedTierCounts[`${t.tier_name}_${t.min_total_qty}`] || 0) * t.min_total_qty, 0);
                    
                    const stockInfo = tier.gifts.map((g: any) => {
                      const inv = inventoryData.find((i: any) => i.product_id === g.product_id);
                      const stock = inv ? inv.quantity : 0;
                      return Math.floor(stock / g.qty);
                    });
                    const tierStock = stockInfo.length > 0 ? Math.min(...stockInfo) : 0;

                    const canIncrease = (selectedTotal + tier.min_total_qty <= cartTotal) && (count < tierStock);

                    return (
                      <div 
                        key={idx} 
                        className={clsx(
                          "flex items-center justify-between p-4 rounded-xl border-2 transition-all group",
                          count > 0 
                            ? "bg-pink-50 border-pink-400 shadow-sm" 
                            : "bg-white border-gray-100 hover:border-pink-200"
                        )}
                      >
                        <div className="flex-1 min-w-0 pr-4">
                          <div className="font-bold text-gray-800 text-sm leading-tight mb-0.5 truncate">{tier.tier_name}</div>
                          <div className="text-[11px] font-bold text-pink-600 flex items-center">
                            Giá trị: {new Intl.NumberFormat('vi-VN').format(tier.min_total_qty)}đ
                            <span className="mx-2 text-gray-300">|</span>
                            {tier.gifts.length} loại quà
                            <span className="mx-2 text-gray-300">|</span>
                            <span className="text-gray-500">
                              Tồn: {tierStock}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              if (count > 0) {
                                setSelectedTierCounts({ ...selectedTierCounts, [key]: count - 1 });
                              }
                            }}
                            disabled={count <= 0}
                            className={clsx(
                              "p-2 rounded-lg transition-colors",
                              count > 0 ? "bg-white border border-pink-200 text-pink-600 active:scale-90" : "bg-gray-50 text-gray-300"
                            )}
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          
                          <div className="w-8 text-center font-black text-lg text-gray-900">{count}</div>
                          
                          <button
                            type="button"
                            onClick={() => {
                              if (canIncrease) {
                                setSelectedTierCounts({ ...selectedTierCounts, [key]: count + 1 });
                              } else if (count >= tierStock) {
                                toast.error('Không đủ số lượng quà tồn kho!');
                              } else {
                                toast.error('Hóa đơn không đủ ngân sách để thêm gói quà này!');
                              }
                            }}
                            className={clsx(
                              "p-2 rounded-lg transition-colors active:scale-90",
                              canIncrease ? "bg-pink-500 text-white shadow-md shadow-pink-200" : "bg-gray-100 text-gray-400"
                            )}
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* KHU VỰC HIỂN THỊ CHI TIẾT QUÀ TẶNG (TỔNG HỢP) */}
          {applicableGifts.length > 0 && (
            <div className={clsx(
              "space-y-3 pt-6 border-t border-dashed border-gray-200",
              isManualGiftMode ? "mt-4" : "mt-0"
            )}>
               <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.15em] mb-4 text-center">Tóm tắt quà tặng kèm theo đơn</h4>
              {applicableGifts.map((gift, idx) => {
                const inventoryItem = inventoryData.find((i: any) => i.product_id === gift.product_id);
                const stockQty = inventoryItem ? inventoryItem.quantity : 0;
                
                return (
                  <div key={idx} className="p-3 bg-pink-50 rounded-xl border border-pink-100 flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="bg-white p-1.5 rounded-lg shadow-sm">
                        <Gift className="w-4 h-4 text-pink-500" />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-pink-900">{gift.product_name}</div>
                        <div className="text-[10px] text-pink-600 font-medium">{gift.tier_name}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-black text-pink-700">x{gift.qty}</div>
                      <div className="text-[9px] text-gray-400">Tồn: {stockQty}</div>
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
          <div className="bg-white rounded-2xl shadow-xl w-[95vw] max-w-md overflow-hidden flex flex-col max-h-[85vh]">
            <div className="p-4 border-b border-gray-100 bg-indigo-50/50">
              <h3 className="text-lg font-bold text-indigo-900">Xác nhận sản phẩm</h3>
              <p className="text-sm text-indigo-600 mt-1">Hệ thống cần bạn xác nhận một số sản phẩm chưa rõ ràng trên hóa đơn.</p>
            </div>
            
            <div className="p-4 overflow-y-auto flex-1 space-y-4">
              {pendingOcrItems.map((item, idx) => (
                <div key={idx} className="bg-gray-50 p-3 rounded-xl border border-gray-200 relative group">
                  <button 
                    onClick={async () => {
                      // Ghi nhận lỗi OCR khi PG chủ động xóa
                      await logOcrError(item.original_name, item.selected_product_id || null, user?.id || '', item.price || 0, item.qty);
                      
                      const newItems = pendingOcrItems.filter((_, i) => i !== idx);
                      setPendingOcrItems(newItems);
                      if (newItems.length === 0) setShowOcrModal(false);
                    }}
                    className="absolute -top-2 -right-2 bg-red-500 text-white p-1 rounded-full shadow-lg transition-all active:scale-90"
                    title="Xóa sản phẩm này"
                  >
                    <X className="w-3 h-3" />
                  </button>
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex-1 min-w-0 pr-2">
                      <span className="text-xs font-semibold text-gray-500 uppercase">Tên trên bill:</span>
                      <p className="font-medium text-gray-900 truncate">{item.original_name}</p>
                    </div>
                    <div className="text-right whitespace-nowrap">
                      <span className="text-xs font-semibold text-gray-500 uppercase">SL/Giá:</span>
                      <p className="font-bold text-indigo-700">{item.qty} x {new Intl.NumberFormat('vi-VN').format(item.price)}đ</p>
                    </div>
                  </div>
                  
                  <label className="block mt-3 text-xs font-semibold text-gray-700 mb-1">Chọn sản phẩm đúng:</label>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <select 
                      className="w-full sm:flex-1 min-w-0 overflow-hidden text-ellipsis p-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-500"
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
                    <button
                      onClick={() => {
                        setManualSelectIndex(idx);
                        setManualCategory('');
                        setManualBrand('');
                        setManualProductGroup('');
                        setManualProductId('');
                      }}
                      className="w-full sm:w-auto px-3 py-2 bg-indigo-100 text-indigo-700 rounded-lg text-sm font-medium hover:bg-indigo-200 transition-colors whitespace-nowrap"
                    >
                      Tìm khác...
                    </button>
                  </div>
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

      {/* MODAL TÌM SẢN PHẨM THỦ CÔNG */}
      {manualSelectIndex !== null && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-[95vw] max-w-md overflow-hidden flex flex-col max-h-[85vh]">
            <div className="p-4 border-b border-gray-100 bg-indigo-50/50 flex justify-between items-center">
              <h3 className="text-lg font-bold text-indigo-900">Tìm sản phẩm</h3>
              <button onClick={() => setManualSelectIndex(null)} className="text-gray-500 hover:text-gray-700"><X className="w-5 h-5" /></button>
            </div>
            
            <div className="p-4 overflow-y-auto flex-1 space-y-4">
              <div className="bg-gray-50 p-3 rounded-xl border border-gray-200 mb-4">
                <span className="text-xs font-semibold text-gray-500 uppercase">Đang tìm cho:</span>
                <p className="font-medium text-gray-900 truncate">{pendingOcrItems[manualSelectIndex]?.original_name}</p>
              </div>

              <div className="space-y-3">
                <select className="w-full p-2.5 border rounded-xl bg-white max-w-full overflow-hidden text-ellipsis" value={manualCategory} onChange={e => {setManualCategory(e.target.value); setManualProductGroup(''); setManualProductId('');}}>
                  <option value="">-- Lọc Ngành hàng --</option>
                  {uniqueCategories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <select className="w-full p-2.5 border rounded-xl bg-white max-w-full overflow-hidden text-ellipsis" value={manualBrand} onChange={e => {setManualBrand(e.target.value); setManualProductGroup(''); setManualProductId('');}}>
                  <option value="">-- Lọc Hãng --</option>
                  {manualUniqueBrands.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
                <select className="w-full p-2.5 border rounded-xl bg-white max-w-full overflow-hidden text-ellipsis" value={manualProductGroup} onChange={e => {setManualProductGroup(e.target.value); setManualProductId('');}}>
                  <option value="" disabled>Chọn Nhóm SP...</option>
                  {manualUniqueProductGroupNames.map(name => <option key={name} value={name}>{name}</option>)}
                </select>
                <select className="w-full p-2.5 border rounded-xl bg-white max-w-full overflow-hidden text-ellipsis" value={manualProductId} onChange={e => setManualProductId(e.target.value)}>
                  <option value="" disabled>Chọn Sản phẩm...</option>
                  {manualAvailableProducts.map(p => (
                    <option key={p.product_id} value={p.product_id}>{p.product_name || 'Mặc định'}</option>
                  ))}
                </select>
              </div>
            </div>
            
            <div className="p-4 border-t border-gray-100 flex gap-3 bg-white">
              <button 
                onClick={() => setManualSelectIndex(null)}
                className="flex-1 py-2.5 rounded-xl font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
              >
                Hủy
              </button>
              <button 
                disabled={!manualProductId}
                onClick={() => {
                  const newItems = [...pendingOcrItems];
                  const selectedProduct = products.find(p => p.product_id === manualProductId);
                  if (selectedProduct) {
                    // Thêm sản phẩm vừa chọn vào đầu danh sách suggestions nếu chưa có
                    const existingSuggIndex = newItems[manualSelectIndex].suggestions.findIndex((s: any) => s.product_id === manualProductId);
                    if (existingSuggIndex === -1) {
                      newItems[manualSelectIndex].suggestions.unshift({
                        product_id: selectedProduct.product_id,
                        product_name: selectedProduct.product_name,
                        product_group_name: selectedProduct.product_group_name,
                        value: selectedProduct.value
                      });
                    }
                    newItems[manualSelectIndex].selected_product_id = manualProductId;
                    setPendingOcrItems(newItems);
                  }
                  setManualSelectIndex(null);
                }}
                className="flex-[2] py-2.5 rounded-xl font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-md shadow-indigo-200"
              >
                Chọn sản phẩm này
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}