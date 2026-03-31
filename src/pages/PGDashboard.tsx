import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

// --- INTERFACES ---
interface KPI {
  kpi_id: string;
  start_date: string;
  end_date: string;
  sale_target: number;
}

interface Product {
  product_id: string;
  product_name: string;
  value: number;
  brands: { brand_name: string };
}

interface Order {
  order_id: string;
  product_id: string;
  qty: number;
  net_value: number;
  is_competitor_product: boolean;
  created_date: string;
  products: { product_name: string; brands: { brand_name: string } };
}

export default function PGDashboard() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // State Form Thêm Mới
  const [selectedProductId, setSelectedProductId] = useState('');
  const [qty, setQty] = useState(1);
  const [isCompetitor, setIsCompetitor] = useState(false);

  // State Form Sửa Đơn Hàng (Modal)
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [editProductId, setEditProductId] = useState('');
  const [editQty, setEditQty] = useState(1);
  const [editIsCompetitor, setEditIsCompetitor] = useState(false);

  // --- THỜI GIAN THÁNG HIỆN TẠI ---
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();

  // 1. FETCH SẢN PHẨM
  const { data: products = [], isLoading: loadingProducts } = useQuery({
    queryKey: ['products'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select(`product_id, product_name, value, brands ( brand_name )`)
        .order('product_name');
      if (error) return [];
      return data as Product[];
    },
    retry: 1
  });

  // 2. FETCH KPI
  const { data: kpis = [] } = useQuery({
    queryKey: ['kpis', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from('kpis')
        .select('*')
        .eq('pg_id', user.id)
        .gte('end_date', new Date().toISOString().split('T')[0])
        .order('start_date', { ascending: true });
      if (error) return [];
      return data as KPI[];
    },
    enabled: !!user?.id,
  });

  // 3. FETCH LỊCH SỬ ĐƠN HÀNG TRONG THÁNG
  const { data: recentOrders = [], isLoading: loadingOrders } = useQuery({
    queryKey: ['recent_orders', user?.id, startOfMonth, endOfMonth],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from('orders')
        .select(`
          order_id, product_id, qty, net_value, is_competitor_product, created_date,
          products ( product_name, brands ( brand_name ) )
        `)
        .eq('pg_id', user.id)
        .gte('created_date', startOfMonth)
        .lte('created_date', endOfMonth)
        .order('created_date', { ascending: false }); // Đơn mới nhất lên đầu
      if (error) return [];
      return data as Order[];
    },
    enabled: !!user?.id,
  });

  // 4. LẤY TỔNG DOANH SỐ THÁNG HIỆN TẠI (Chỉ tính hàng nội bộ)
  const { data: currentMonthSales = 0 } = useQuery({
    queryKey: ['monthly_sales', user?.id, startOfMonth, endOfMonth],
    queryFn: async () => {
      if (!user?.id) return 0;
      const { data, error } = await supabase
        .from('orders')
        .select('net_value')
        .eq('pg_id', user.id)
        .eq('is_competitor_product', false)
        .gte('created_date', startOfMonth)
        .lte('created_date', endOfMonth);
      if (error) return 0;
      return data.reduce((sum, order) => sum + (Number(order.net_value) || 0), 0);
    },
    enabled: !!user?.id,
  });

  // --- MUTATIONS (THÊM, SỬA, XÓA) ---

  // A. Thêm đơn hàng
  const submitOrderMutation = useMutation({
    mutationFn: async (payload: any) => {
      const { error } = await supabase.from('orders').insert([payload]);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('🎉 Ghi nhận đơn hàng thành công!');
      setSelectedProductId(''); setQty(1); setIsCompetitor(false);
      queryClient.invalidateQueries({ queryKey: ['recent_orders'] });
      queryClient.invalidateQueries({ queryKey: ['monthly_sales'] });
    },
    onError: (error: any) => toast.error(`Lỗi: ${error.message}`)
  });

  // B. Cập nhật đơn hàng (Sửa)
  const updateOrderMutation = useMutation({
    mutationFn: async (payload: any) => {
      const { error } = await supabase
        .from('orders')
        .update(payload)
        .eq('order_id', editingOrder?.order_id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('✏️ Đã cập nhật đơn hàng!');
      setEditingOrder(null); // Đóng modal
      queryClient.invalidateQueries({ queryKey: ['recent_orders'] });
      queryClient.invalidateQueries({ queryKey: ['monthly_sales'] });
    },
    onError: (error: any) => toast.error(`Lỗi cập nhật: ${error.message}`)
  });

  // C. Xóa đơn hàng
  const deleteOrderMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const { error } = await supabase.from('orders').delete().eq('order_id', orderId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('🗑️ Đã xóa đơn hàng!');
      queryClient.invalidateQueries({ queryKey: ['recent_orders'] });
      queryClient.invalidateQueries({ queryKey: ['monthly_sales'] });
    }
  });

  // --- HANDLERS ---
  const handleSubmitOrder = (e: React.FormEvent) => {
    e.preventDefault();
    const product = products.find(p => p.product_id === selectedProductId);
    submitOrderMutation.mutate({
      pg_id: user?.id,
      product_id: selectedProductId,
      qty: qty,
      net_value: product ? product.value * qty : 0,
      is_competitor_product: isCompetitor,
      created_date: new Date().toISOString(),
    });
  };

  const handleUpdateOrder = (e: React.FormEvent) => {
    e.preventDefault();
    const product = products.find(p => p.product_id === editProductId);
    updateOrderMutation.mutate({
      product_id: editProductId,
      qty: editQty,
      net_value: product ? product.value * editQty : 0,
      is_competitor_product: editIsCompetitor,
    });
  };

  const handleDeleteOrder = (orderId: string) => {
    if (window.confirm('Bạn có chắc chắn muốn xóa đơn hàng này không? Doanh số sẽ bị trừ đi.')) {
      deleteOrderMutation.mutate(orderId);
    }
  };

  const openEditModal = (order: Order) => {
    setEditingOrder(order);
    setEditProductId(order.product_id);
    setEditQty(order.qty);
    setEditIsCompetitor(order.is_competitor_product);
  };

  // --- TÍNH TOÁN HIỂN THỊ ---
  const selectedProduct = products.find(p => p.product_id === selectedProductId);
  const calculatedValue = selectedProduct ? selectedProduct.value * qty : 0;
  
  const editProductInfo = products.find(p => p.product_id === editProductId);
  const editCalculatedValue = editProductInfo ? editProductInfo.value * editQty : 0;

  const totalTarget = kpis.reduce((sum, kpi) => sum + Number(kpi.sale_target), 0);
  const kpiProgress = totalTarget > 0 ? Math.min((currentMonthSales / totalTarget) * 100, 100) : 0;

  return (
    <div className="space-y-6 max-w-lg mx-auto md:max-w-none pb-10">
      <h2 className="text-2xl font-bold text-gray-900">Bảng điều khiển PG</h2>

      {/* --- WIDGET BÁO CÁO DOANH SỐ & KPI --- */}
      <div className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl shadow-lg p-6 text-white">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold opacity-90">Doanh số Tháng {new Date().getMonth() + 1}</h3>
          <span className="bg-white/20 px-3 py-1 rounded-full text-xs font-medium">Báo cáo trực tiếp</span>
        </div>
        
        <div className="mb-6">
          <span className="text-4xl font-extrabold tracking-tight">
            {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(currentMonthSales)}
          </span>
          <p className="text-indigo-100 text-sm mt-1">
            Tổng mục tiêu: {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(totalTarget)}
          </p>
        </div>

        {totalTarget > 0 ? (
          <div>
            <div className="flex justify-between text-sm mb-1 opacity-90">
              <span>Tiến độ KPI</span>
              <span className="font-bold">{kpiProgress.toFixed(1)}%</span>
            </div>
            <div className="w-full bg-indigo-900/50 rounded-full h-2.5">
              <div 
                className="bg-green-400 h-2.5 rounded-full transition-all duration-700 ease-out" 
                style={{ width: `${kpiProgress}%` }}
              ></div>
            </div>
          </div>
        ) : (
          <div className="text-sm bg-white/10 p-3 rounded-lg border border-white/20">
            ⏳ Bạn chưa được giao chỉ tiêu KPI cho tháng này.
          </div>
        )}
      </div>

      {/* --- FORM NHẬP ĐƠN HÀNG --- */}
      <div className="bg-white shadow sm:rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-lg font-medium leading-6 text-gray-900">Ghi nhận đơn hàng mới</h3>
          <form className="mt-5 space-y-4" onSubmit={handleSubmitOrder}>
            <div>
              <label className="block text-sm font-medium text-gray-700">Sản phẩm</label>
              {loadingProducts ? (
                <div className="mt-1 p-2 border rounded-md text-gray-500 bg-gray-50">Đang tải...</div>
              ) : (
                <select
                  className="mt-1 block w-full rounded-md border-gray-300 py-2 pl-3 pr-10 text-base focus:border-indigo-500 focus:outline-none focus:ring-indigo-500 sm:text-sm border bg-white"
                  value={selectedProductId}
                  onChange={(e) => setSelectedProductId(e.target.value)}
                  required
                >
                  <option value="" disabled>Chọn một sản phẩm...</option>
                  {products.map((product) => (
                    <option key={product.product_id} value={product.product_id}>
                      {product.product_name} - {product.brands?.brand_name || 'Khác'} ({new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(product.value)})
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="flex space-x-4">
              <div className="w-1/3">
                <label className="block text-sm font-medium text-gray-700">Số lượng</label>
                <input
                  type="number" min="1" required
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
                  value={qty} onChange={(e) => setQty(parseInt(e.target.value) || 0)}
                />
              </div>
              <div className="w-2/3">
                <label className="block text-sm font-medium text-gray-700">Tổng giá trị</label>
                <div className="mt-1 block w-full rounded-md border-gray-300 bg-gray-50 sm:text-sm border p-2 text-gray-600 font-semibold text-right">
                  {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(calculatedValue)}
                </div>
              </div>
            </div>

            <div className="flex items-start bg-yellow-50 p-3 rounded-lg border border-yellow-100">
              <div className="flex h-5 items-center">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  checked={isCompetitor} onChange={(e) => setIsCompetitor(e.target.checked)}
                />
              </div>
              <div className="ml-3 text-sm">
                <label className="font-medium text-gray-800">Đây là hàng đối thủ (Competitor)</label>
                <p className="text-gray-500 text-xs">Sẽ không cộng vào KPI của bạn.</p>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitOrderMutation.isPending || !selectedProductId || qty <= 0}
              className="w-full justify-center rounded-md border border-transparent bg-indigo-600 px-4 py-3 text-base font-bold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
            >
              {submitOrderMutation.isPending ? 'Đang lưu...' : 'GHI NHẬN DOANH SỐ'}
            </button>
          </form>
        </div>
      </div>

      {/* --- LỊCH SỬ ĐƠN HÀNG THÁNG NÀY --- */}
      <div className="bg-white shadow sm:rounded-lg overflow-hidden">
        <div className="px-4 py-5 border-b border-gray-200 sm:px-6">
          <h3 className="text-lg font-medium leading-6 text-gray-900">Lịch sử đơn hàng tháng này</h3>
          <p className="mt-1 text-sm text-gray-500">Xem lại và chỉnh sửa các đơn bạn đã nhập.</p>
        </div>
        
        {loadingOrders ? (
          <div className="p-6 text-center text-gray-500">Đang tải lịch sử...</div>
        ) : recentOrders.length === 0 ? (
          <div className="p-6 text-center text-gray-500 text-sm">Chưa có đơn hàng nào được ghi nhận trong tháng này.</div>
        ) : (
          <ul className="divide-y divide-gray-200">
            {recentOrders.map((order) => (
              <li key={order.order_id} className="p-4 sm:px-6 hover:bg-gray-50 transition-colors">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center space-x-2">
                    <p className="font-semibold text-gray-900 truncate">
                      {order.products?.product_name || 'Sản phẩm đã xóa'}
                    </p>
                    {order.is_competitor_product && (
                      <span className="bg-yellow-100 text-yellow-800 text-[10px] font-bold px-2 py-0.5 rounded uppercase">Đối thủ</span>
                    )}
                  </div>
                  <p className="text-sm font-bold text-indigo-600">
                    {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(order.net_value)}
                  </p>
                </div>
                
                <div className="flex items-center justify-between">
                  <div className="text-sm text-gray-500">
                    <p>Số lượng: <span className="font-medium">{order.qty}</span></p>
                    <p className="text-xs mt-0.5">{new Date(order.created_date).toLocaleString('vi-VN')}</p>
                  </div>
                  
                  {/* Nút Sửa / Xóa */}
                  <div className="flex space-x-3">
                    <button 
                      onClick={() => openEditModal(order)}
                      className="text-indigo-600 hover:text-indigo-900 text-sm font-medium"
                    >
                      Sửa
                    </button>
                    <button 
                      onClick={() => handleDeleteOrder(order.order_id)}
                      disabled={deleteOrderMutation.isPending}
                      className="text-red-600 hover:text-red-900 text-sm font-medium disabled:opacity-50"
                    >
                      Xóa
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* --- MODAL CHỈNH SỬA ĐƠN HÀNG --- */}
      {editingOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
              <h3 className="text-lg font-bold text-gray-900">Sửa Đơn Hàng</h3>
              <button onClick={() => setEditingOrder(null)} className="text-gray-400 hover:text-gray-600 font-bold text-xl">&times;</button>
            </div>
            
            <form onSubmit={handleUpdateOrder} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Sản phẩm</label>
                <select
                  className="mt-1 block w-full rounded-md border-gray-300 p-2 border sm:text-sm"
                  value={editProductId}
                  onChange={(e) => setEditProductId(e.target.value)}
                  required
                >
                  {products.map((product) => (
                    <option key={product.product_id} value={product.product_id}>
                      {product.product_name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex space-x-4">
                <div className="w-1/3">
                  <label className="block text-sm font-medium text-gray-700">Số lượng</label>
                  <input
                    type="number" min="1" required
                    className="mt-1 block w-full rounded-md border-gray-300 p-2 border sm:text-sm"
                    value={editQty} onChange={(e) => setEditQty(parseInt(e.target.value) || 0)}
                  />
                </div>
                <div className="w-2/3">
                  <label className="block text-sm font-medium text-gray-700">Tổng giá trị (Tự tính)</label>
                  <div className="mt-1 block w-full rounded-md border-gray-300 bg-gray-50 p-2 border sm:text-sm text-right font-semibold text-indigo-600">
                    {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(editCalculatedValue)}
                  </div>
                </div>
              </div>

              <div className="flex items-center space-x-2 pt-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  checked={editIsCompetitor} onChange={(e) => setEditIsCompetitor(e.target.checked)}
                />
                <label className="text-sm text-gray-700 font-medium">Là hàng đối thủ (Không cộng KPI)</label>
              </div>

              <div className="pt-4 flex space-x-3">
                <button
                  type="button" onClick={() => setEditingOrder(null)}
                  className="flex-1 bg-white border border-gray-300 text-gray-700 py-2 rounded-md font-medium hover:bg-gray-50"
                >
                  Hủy
                </button>
                <button
                  type="submit" disabled={updateOrderMutation.isPending}
                  className="flex-1 bg-indigo-600 text-white py-2 rounded-md font-medium hover:bg-indigo-700 disabled:opacity-50"
                >
                  {updateOrderMutation.isPending ? 'Đang lưu...' : 'Lưu Thay Đổi'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}