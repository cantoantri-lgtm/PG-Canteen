import React, { useState, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { Plus, Edit2, Trash2, Download, Eye } from 'lucide-react';
import Modal from '../../components/Modal';
import ConfirmModal from '../../components/ConfirmModal';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useRealtimeSync } from '../../hooks/useRealtimeSync';
import { useAuth } from '../../lib/AuthContext';

// --- CÁC INTERFACE DỮ LIỆU (Cập nhật theo cấu trúc mới) ---
interface Order {
  id: string; // detail id
  order_id: string; // header id
  cart_id: string;
  created_at: string;
  pg_id: string;
  program_id: string;
  product_id: string;
  qty: number;
  net_value: number;
  bill_image_url?: string | null;
  switched_from_brand?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  distance_from_shop?: number | null;
  profiles?: { full_name: string };
  products?: { product_name: string; brand_id: string };
}

interface Profile { id: string; full_name: string; }
interface Brand { brand_id: string; brand_name: string; }
interface Product { product_id: string; product_name: string; brand_id: string; value: number; }

export default function Orders() {
  const { user } = useAuth();
  const isAdmin = user?.admin_role === true || user?.role === 'admin' || user?.email?.toLowerCase() === 'can.toantri@gmail.com';
  const isSup = user?.role_name?.toUpperCase() === 'SUP';

  // --- STATES ---
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Order>>({});
  const [isAdding, setIsAdding] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [selectedBrandId, setSelectedBrandId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPgFilter, setSelectedPgFilter] = useState('');
  const [selectedBrandFilter, setSelectedBrandFilter] = useState('');
  const [selectedProgramFilter, setSelectedProgramFilter] = useState('');
  
  // State cho xem ảnh Bill
  const [viewingBillImages, setViewingBillImages] = useState<string[] | null>(null);
  const [isBillModalOpen, setIsBillModalOpen] = useState(false);
  const [loadingBill, setLoadingBill] = useState(false);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  
  // State mới cho đối thủ & Giỏ hàng Admin
  const [isConverted, setIsConverted] = useState(false);
  const [competitorBrand, setCompetitorBrand] = useState('');
  const [currentCartId, setCurrentCartId] = useState<string>(''); // Dùng để gom nhóm khi "Lưu & Thêm tiếp"

  // --- HÀM TẠO ID GIỎ HÀNG (Tương tự PG Dashboard) ---
  const generateUniqueCartId = async (): Promise<string> => {
    let isUnique = false;
    let newId = '';
    while (!isUnique) {
      const datePart = new Date().toISOString().slice(2, 10).replace(/-/g, '');
      const randomPart = Math.random().toString(36).substring(2, 6).toUpperCase();
      newId = `CART-ADM-${datePart}-${randomPart}`;
      const { data } = await supabase.from('orders').select('cart_id').eq('cart_id', newId).limit(1);
      if (!data || data.length === 0) isUnique = true;
    }
    return newId;
  };

  // --- 1. LẤY DỮ LIỆU TỪ SUPABASE ---
  const { data: orders = [], isLoading: loadingOrders, error: ordersError } = useQuery({
    queryKey: ['admin_orders_list', user?.id, isSup],
    queryFn: async () => {
      let query = supabase
        .from('order_details')
        .select(`
          id, order_id, product_id, qty, net_value, switched_from_brand,
          orders!inner(
            cart_id, created_at, pg_id, program_id, customer_name, customer_phone, bill_image_url, distance_from_shop,
            profiles(full_name, manager_id)
          ),
          products(
            product_name,
            product_group!inner(brand_id)
          )
        `);

      if (isSup && user?.id) {
        // Get assigned program IDs first
        const { data: assigned } = await supabase
          .from('sup_programs')
          .select('program_id')
          .eq('sup_id', user.id);
        
        const assignedIds = assigned?.map(a => a.program_id) || [];
        if (assignedIds.length === 0) return [];
        
        query = query.in('orders.program_id', assignedIds);
      }

      const { data, error } = await query.order('id', { ascending: false });
      
      if (error) {
        console.error('Lỗi tải đơn hàng:', error);
        throw error;
      }
      
      // Flatten the data
      let flattenedData = (data || []).map(item => {
        const order = Array.isArray(item.orders) ? item.orders[0] : item.orders;
        const product = Array.isArray(item.products) ? item.products[0] : item.products;
        const productGroup = Array.isArray(product?.product_group) ? product.product_group[0] : product?.product_group;
        
        return {
          id: item.id,
          order_id: item.order_id,
          product_id: item.product_id,
          qty: item.qty,
          net_value: item.net_value,
          switched_from_brand: item.switched_from_brand,
          cart_id: order?.cart_id,
          created_at: order?.created_at,
          pg_id: order?.pg_id,
          program_id: order?.program_id,
          customer_name: order?.customer_name,
          customer_phone: order?.customer_phone,
          bill_image_url: order?.bill_image_url,
          distance_from_shop: order?.distance_from_shop,
          profiles: order?.profiles,
          products: {
            product_name: product?.product_name,
            brand_id: productGroup?.brand_id
          }
        };
      }) as any as Order[];

      if (isSup && user?.id) {
        flattenedData = flattenedData.filter(o => (o.profiles as any)?.manager_id === user.id);
      }

      return flattenedData;
    }
  });

  const { data: profiles = [] } = useQuery({
    queryKey: ['profiles_list'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('id, full_name').eq('admin_role', false).order('full_name');
      if (error) throw error;
      return data as Profile[];
    }
  });

  const { data: brands = [] } = useQuery({
    queryKey: ['brands_list'],
    queryFn: async () => {
      const { data, error } = await supabase.from('brands').select('*').order('brand_name');
      if (error) throw error;
      return data as Brand[];
    }
  });

  const { data: programs = [] } = useQuery({
    queryKey: ['programs_list', isSup, user?.id],
    queryFn: async () => {
      let query = supabase.from('programs').select('program_id, program_name');
      
      if (isSup && user?.id) {
        const { data: assigned } = await supabase
          .from('sup_programs')
          .select('program_id')
          .eq('sup_id', user.id);
        
        const assignedIds = assigned?.map(a => a.program_id) || [];
        if (assignedIds.length === 0) return [];
        
        query = query.in('program_id', assignedIds);
      }

      const { data, error } = await query.order('program_name');
      if (error) throw error;
      return data;
    }
  });

  const { data: products = [] } = useQuery({
    queryKey: ['products_list'],
    queryFn: async () => {
      const { data, error } = await supabase.from('products').select('*').order('product_name');
      if (error) throw error;
      return data as Product[];
    }
  });

  // --- 2. ĐỒNG BỘ REALTIME ---
  const orderSyncConfig = useMemo(() => ({
    table: 'orders',
    queryKey: ['admin_orders_list'],
    idColumn: 'id' // Cập nhật theo schema mới
  }), []);
  useRealtimeSync(orderSyncConfig);

  const filteredOrders = useMemo(() => {
    return orders.filter(o => {
      const cartId = o.cart_id || '';
      const pgName = o.profiles?.full_name || '';
      const custName = o.customer_name || '';
      const custPhone = o.customer_phone || '';
      
      const matchesSearch = cartId.toLowerCase().includes(searchQuery.toLowerCase()) || 
                           pgName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                           custName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                           custPhone.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesPg = selectedPgFilter === '' || o.pg_id === selectedPgFilter;
      const matchesBrand = selectedBrandFilter === '' || o.products?.brand_id === selectedBrandFilter;
      const matchesProgram = selectedProgramFilter === '' || o.program_id === selectedProgramFilter;
      
      return matchesSearch && matchesPg && matchesBrand && matchesProgram;
    });
  }, [orders, searchQuery, selectedPgFilter, selectedBrandFilter, selectedProgramFilter]);

  // --- 3. MUTATIONS (THÊM / SỬA / XÓA) ---
  const saveMutation = useMutation({
    mutationFn: async ({ payload, isKeepOpen }: { payload: any; isKeepOpen: boolean }) => {
      if (isAdding) {
        // 1. Xác định hoặc tạo Header (orders)
        let activeOrderId = '';
        let activeCartId = currentCartId;

        if (!activeCartId) {
          activeCartId = await generateUniqueCartId();
          
          // Tạo header mới
          const headerPayload = {
            cart_id: activeCartId,
            pg_id: payload.pg_id,
            program_id: payload.program_id,
            customer_name: payload.customer_name,
            customer_phone: payload.customer_phone,
            bill_image_url: payload.bill_image_url,
            created_at: new Date().toISOString()
          };
          
          const { data: headerData, error: headerError } = await supabase
            .from('orders')
            .insert([headerPayload])
            .select()
            .single();
            
          if (headerError) throw headerError;
          activeOrderId = headerData.id;
        } else {
          // Tìm header hiện tại theo cart_id
          const { data: existingHeader, error: findError } = await supabase
            .from('orders')
            .select('id')
            .eq('cart_id', activeCartId)
            .single();
            
          if (findError) throw findError;
          activeOrderId = existingHeader.id;

          // Cập nhật bill_image_url nếu có thay đổi
          if (payload.bill_image_url) {
            await supabase
              .from('orders')
              .update({ bill_image_url: payload.bill_image_url })
              .eq('id', activeOrderId);
          }
        }

        // 2. Thêm vào Details
        const detailPayload = {
          order_id: activeOrderId,
          product_id: payload.product_id,
          qty: payload.qty,
          net_value: payload.net_value,
          switched_from_brand: payload.switched_from_brand,
          is_gift: false
        };

        const { data: detailData, error: detailError } = await supabase
          .from('order_details')
          .insert([detailPayload])
          .select()
          .single();

        if (detailError) throw detailError;
        
        return { data: detailData, isKeepOpen, activeCartId };
      } else {
        // Cập nhật Details
        const { error: detailError } = await supabase
          .from('order_details')
          .update({
            product_id: payload.product_id,
            qty: payload.qty,
            net_value: payload.net_value,
            switched_from_brand: payload.switched_from_brand
          })
          .eq('id', editForm.id);
        
        if (detailError) throw detailError;

        // Cập nhật Header (nếu cần - ví dụ thông tin khách hàng)
        const { error: headerError } = await supabase
          .from('orders')
          .update({
            pg_id: payload.pg_id,
            program_id: payload.program_id,
            customer_name: payload.customer_name,
            customer_phone: payload.customer_phone,
            bill_image_url: payload.bill_image_url
          })
          .eq('id', editForm.order_id);

        if (headerError) throw headerError;

        return { data: payload, isKeepOpen, activeCartId: null };
      }
    },
    onSuccess: (result) => {
      toast.success(isAdding ? 'Thêm sản phẩm thành công!' : 'Cập nhật thành công!');
      if (result.isKeepOpen && isAdding) {
        // Lưu lại mã giỏ hàng để gom chung các món tiếp theo
        setCurrentCartId(result.activeCartId as string);
        // Reset form để nhập món khác
        setEditForm(prev => ({ ...prev, product_id: '', qty: 1, net_value: 0 }));
        setIsConverted(false);
        setCompetitorBrand('');
      } else {
        setIsModalOpen(false);
        setCurrentCartId(''); // Đóng form thì reset mã giỏ hàng
      }
    },
    onError: (error: any) => {
      toast.error(`Không thể lưu: ${error.message}`);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('order_details').delete().eq('id', id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => toast.success('Đã xóa sản phẩm khỏi hệ thống!')
  });

  // --- 4. CÁC HÀM XỬ LÝ GIAO DIỆN ---
  const formatCurrency = (value: any) => {
    if (value === null || value === undefined) return '';
    const numericValue = value.toString().replace(/\D/g, '');
    return numericValue.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  };

  const handleAdd = () => {
    setIsAdding(true);
    setCurrentCartId(''); // Reset mã giỏ khi bắt đầu phiên nhập mới
    setEditForm({ qty: 1, net_value: 0, program_id: selectedProgramFilter || '' });
    setSelectedBrandId('');
    setIsConverted(false);
    setCompetitorBrand('');
    setIsModalOpen(true);
  };

  const handleEdit = (order: Order) => {
    setIsAdding(false);
    setEditForm(order);
    if (order.products?.brand_id) {
      setSelectedBrandId(order.products.brand_id);
    }
    // Gán dữ liệu chuyển đổi đối thủ
    setIsConverted(!!order.switched_from_brand);
    setCompetitorBrand(order.switched_from_brand || '');
    setIsModalOpen(true);
  };

  const handleSave = (isKeepOpen = false) => {
    if (!editForm.pg_id || !editForm.program_id || !editForm.product_id || !editForm.qty || editForm.net_value === undefined) {
      toast.error("Vui lòng điền đầy đủ các trường bắt buộc (*)");
      return;
    }
    if (isConverted && !competitorBrand.trim()) {
      toast.error("Vui lòng nhập tên hãng đối thủ!");
      return;
    }

    const payload = {
      pg_id: editForm.pg_id,
      program_id: editForm.program_id,
      product_id: editForm.product_id,
      qty: editForm.qty,
      net_value: editForm.net_value,
      switched_from_brand: isConverted ? competitorBrand.trim() : null,
      customer_name: editForm.customer_name || null,
      customer_phone: editForm.customer_phone || null,
      bill_image_url: editForm.bill_image_url || null
    };

    saveMutation.mutate({ payload, isKeepOpen });
  };

  const confirmDelete = () => {
    if (deleteId) {
      deleteMutation.mutate(deleteId);
      setDeleteId(null);
    }
  };

  const handleViewBill = async (cartId: string, directImageUrl?: string | null) => {
    setLoadingBill(true);
    setIsBillModalOpen(true);
    
    if (directImageUrl) {
      setViewingBillImages(directImageUrl.split(','));
      setLoadingBill(false);
      return;
    }

    try {
      // Thử lấy từ orders (theo schema mới)
      const { data: orderData, error: orderError } = await supabase
        .from('orders')
        .select('bill_image_url')
        .eq('cart_id', cartId)
        .not('bill_image_url', 'is', null)
        .limit(1)
        .single();
        
      if (!orderError && orderData?.bill_image_url) {
        setViewingBillImages(orderData.bill_image_url.split(','));
      } else {
        // Thử lấy từ order_headers (fallback)
        const { data, error } = await supabase
          .from('order_headers')
          .select('bill_image_url')
          .eq('cart_id', cartId)
          .single();
        
        if (error || !data?.bill_image_url) {
          setViewingBillImages([]);
          toast.error("Không tìm thấy ảnh hóa đơn cho đơn hàng này.");
        } else {
          setViewingBillImages(data.bill_image_url.split(','));
        }
      }
    } catch (err) {
      console.error("Lỗi khi tải ảnh bill:", err);
      toast.error("Lỗi khi tải ảnh hóa đơn.");
      setViewingBillImages([]);
    } finally {
      setLoadingBill(false);
    }
  };

  const filteredProducts = products.filter(p => !selectedBrandId || p.brand_id === selectedBrandId);

  // --- XUẤT CSV ---
  const exportToCSV = () => {
    if (!orders || orders.length === 0) {
      toast.error('Không có dữ liệu để xuất');
      return;
    }

    const headers = ['Mã Giỏ Hàng', 'Ngày tạo', 'Nhân viên PG', 'Sản phẩm', 'Số lượng', 'Thành tiền', 'Cướp từ đối thủ', 'Link hóa đơn'];
    const rows = orders.map(order => [
      order.cart_id,
      new Date(order.created_at).toLocaleString('vi-VN'),
      order.profiles?.full_name || 'N/A',
      order.products?.product_name || 'N/A',
      order.qty,
      order.net_value,
      order.switched_from_brand || 'Không',
      order.bill_image_url || ''
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `bao_cao_chi_tiet_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (loadingOrders) return <div className="p-8 text-center text-indigo-600 animate-pulse font-semibold">Đang tải dữ liệu...</div>;

  return (
    <div className="space-y-6">
      <div className="sm:flex sm:items-center sm:justify-between">
        <h2 className="text-2xl font-bold text-gray-900">Quản lý Đơn hàng chi tiết</h2>
        <div className="mt-3 sm:mt-0 flex space-x-3">
          <button onClick={exportToCSV} className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50">
            <Download className="-ml-1 mr-2 h-5 w-5 text-gray-400" />
            Xuất CSV
          </button>
          {isAdmin && (
            <button onClick={handleAdd} className="inline-flex items-center justify-center rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700">
              <Plus className="-ml-1 mr-2 h-5 w-5" />
              Nhập Đơn hàng
            </button>
          )}
        </div>
      </div>

      {/* BỘ LỌC */}
      <div className="flex flex-col sm:flex-row flex-wrap gap-4 bg-white p-4 rounded-lg shadow-sm border border-gray-200">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-sm font-medium text-gray-700 mb-1">Tìm kiếm đơn hàng</label>
          <input
            type="text"
            placeholder="Nhập mã giỏ hàng hoặc tên PG..."
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="w-full sm:w-48">
          <label className="block text-sm font-medium text-gray-700 mb-1">Chương trình</label>
          <select
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2 bg-white"
            value={selectedProgramFilter}
            onChange={(e) => setSelectedProgramFilter(e.target.value)}
          >
            <option value="">Tất cả Program</option>
            {programs.map((p: any) => <option key={p.program_id} value={p.program_id}>{p.program_name}</option>)}
          </select>
        </div>
        <div className="w-full sm:w-48">
          <label className="block text-sm font-medium text-gray-700 mb-1">Lọc theo PG</label>
          <select
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2 bg-white"
            value={selectedPgFilter}
            onChange={(e) => setSelectedPgFilter(e.target.value)}
          >
            <option value="">Tất cả PG</option>
            {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        </div>
        <div className="w-full sm:w-48">
          <label className="block text-sm font-medium text-gray-700 mb-1">Lọc theo Nhãn hàng</label>
          <select
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2 bg-white"
            value={selectedBrandFilter}
            onChange={(e) => setSelectedBrandFilter(e.target.value)}
          >
            <option value="">Tất cả Nhãn hàng</option>
            {brands.map(b => <option key={b.brand_id} value={b.brand_id}>{b.brand_name}</option>)}
          </select>
        </div>
        <div className="flex items-end">
          <button 
            onClick={() => {
              setSearchQuery('');
              setSelectedPgFilter('');
              setSelectedBrandFilter('');
              setSelectedProgramFilter('');
            }}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-indigo-600 transition-colors"
          >
            Xóa lọc
          </button>
        </div>
      </div>

      <div className="flex justify-between items-center px-1">
        <div className="text-sm text-gray-500">
          Hiển thị <strong>{filteredOrders.length}</strong> / {orders.length} đơn hàng
          {ordersError && <span className="text-red-500 ml-2">(Lỗi: {(ordersError as any).message})</span>}
        </div>
      </div>

      {/* BẢNG HIỂN THỊ */}
      <div className="mt-8 flex flex-col">
        <div className="-my-2 -mx-4 overflow-x-auto sm:-mx-6 lg:-mx-8">
          <div className="inline-block min-w-full py-2 align-middle md:px-6 lg:px-8">
            <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 md:rounded-lg">
              <table className="min-w-full divide-y divide-gray-300">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900">Mã GH / Ngày tạo</th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Nhân viên PG</th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Khách hàng</th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Sản phẩm</th>
                    <th className="px-3 py-3.5 text-right text-sm font-semibold text-gray-900">Số lượng</th>
                    <th className="px-3 py-3.5 text-right text-sm font-semibold text-gray-900">Thành tiền</th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Đổi từ hãng</th>
                    <th className="px-3 py-3.5 text-center text-sm font-semibold text-gray-900">Hóa đơn</th>
                    <th className="px-3 py-3.5 text-right text-sm font-semibold text-gray-900">Khoảng cách</th>
                    <th className="relative py-3.5 pl-3 pr-4 sm:pr-6"><span className="sr-only">Thao tác</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {filteredOrders.map((order) => (
                    <tr key={order.id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm">
                        <div className="font-mono text-[10px] text-gray-400 uppercase">{order.cart_id}</div>
                        <div className="text-gray-900">{new Date(order.created_at).toLocaleString('vi-VN', {day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'})}</div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm font-medium text-indigo-600">{order.profiles?.full_name || 'N/A'}</td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm">
                        <div className="text-gray-900 font-medium">{order.customer_name || '-'}</div>
                        <div className="text-gray-500 text-xs">{order.customer_phone || ''}</div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-900">{order.products?.product_name || 'N/A'}</td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-900 text-right font-semibold">{order.qty}</td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-green-600 text-right font-semibold">
                        {order.net_value.toLocaleString('vi-VN')} đ
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm">
                        {order.switched_from_brand ? (
                          <span className={`text-xs px-2 py-1 rounded font-bold uppercase ${
                            order.switched_from_brand.startsWith('QUÀ TẶNG') ? 'bg-pink-100 text-pink-800' : 
                            order.switched_from_brand.startsWith('MẪU THỬ') ? 'bg-blue-100 text-blue-800' :
                            'bg-yellow-100 text-yellow-800'
                          }`}>
                            {order.switched_from_brand}
                          </span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-center">
                        {order.bill_image_url ? (
                          <div className="flex items-center justify-center space-x-1">
                            <img 
                              src={order.bill_image_url.split(',')[0]} 
                              alt="Bill" 
                              className="h-10 w-10 object-cover rounded border border-gray-200 cursor-pointer hover:opacity-80 transition-opacity"
                              referrerPolicy="no-referrer"
                              onClick={() => handleViewBill(order.cart_id, order.bill_image_url)}
                            />
                            {order.bill_image_url.split(',').length > 1 && (
                              <span className="text-xs font-medium text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-full">
                                +{order.bill_image_url.split(',').length - 1}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-right">
                        {order.distance_from_shop != null ? (
                          <span className={`font-medium ${order.distance_from_shop > 500 ? 'text-red-600' : 'text-gray-900'}`}>
                            {Math.round(order.distance_from_shop)}m
                          </span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                        <button onClick={() => handleViewBill(order.cart_id, order.bill_image_url)} className="text-blue-600 hover:text-blue-900 mr-4" title="Xem hóa đơn"><Eye className="h-4 w-4" /></button>
                        {isAdmin && (
                          <>
                            <button onClick={() => handleEdit(order)} className="text-indigo-600 hover:text-indigo-900 mr-4"><Edit2 className="h-4 w-4" /></button>
                            <button onClick={() => setDeleteId(order.id)} className="text-red-600 hover:text-red-900"><Trash2 className="h-4 w-4" /></button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                  {filteredOrders.length === 0 && <tr><td colSpan={9} className="px-6 py-8 text-center text-gray-500">Không tìm thấy đơn hàng nào.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* MODAL THÊM/SỬA */}
      <Modal isOpen={isModalOpen} onClose={() => { setIsModalOpen(false); setCurrentCartId(''); }} title={isAdding ? 'Nhập chi tiết Đơn hàng' : 'Sửa Đơn hàng'}>
        <div className="space-y-4">
          
          {/* Thông báo nếu đang nhập liên tiếp */}
          {currentCartId && isAdding && (
            <div className="bg-blue-50 text-blue-700 p-2 rounded text-xs font-mono font-bold text-center border border-blue-200">
              Đang nhập tiếp cho giỏ hàng: {currentCartId}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700">Nhân viên PG *</label>
            <select
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2 bg-white"
              value={editForm.pg_id || ''}
              onChange={e => setEditForm({...editForm, pg_id: e.target.value})}
              disabled={!!currentCartId} // Đang nhập dở giỏ hàng thì cấm đổi PG
            >
              <option value="">-- Chọn nhân viên --</option>
              {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Chương trình *</label>
            <select
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2 bg-white"
              value={editForm.program_id || ''}
              onChange={e => setEditForm({...editForm, program_id: e.target.value})}
              disabled={!!currentCartId}
            >
              <option value="">-- Chọn chương trình --</option>
              {programs.map((p: any) => <option key={p.program_id} value={p.program_id}>{p.program_name}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Tên Khách hàng</label>
              <input 
                type="text" 
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" 
                value={editForm.customer_name || ''} 
                onChange={e => setEditForm({...editForm, customer_name: e.target.value})} 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Số điện thoại</label>
              <input 
                type="text" 
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" 
                value={editForm.customer_phone || ''} 
                onChange={e => setEditForm({...editForm, customer_phone: e.target.value})} 
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Link ảnh hóa đơn (Các link cách nhau bởi dấu phẩy)</label>
            <input 
              type="text" 
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" 
              value={editForm.bill_image_url || ''} 
              onChange={e => setEditForm({...editForm, bill_image_url: e.target.value})} 
              placeholder="https://example.com/image1.jpg, https://example.com/image2.jpg"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Lọc Nhãn hàng</label>
              <select
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2 bg-gray-50"
                value={selectedBrandId}
                onChange={e => { setSelectedBrandId(e.target.value); setEditForm({...editForm, product_id: ''}); }}
              >
                <option value="">Tất cả</option>
                {brands.map(b => <option key={b.brand_id} value={b.brand_id}>{b.brand_name}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Sản phẩm *</label>
              <select
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2 bg-white"
                value={editForm.product_id || ''}
                onChange={e => {
                  const pId = e.target.value;
                  const prod = products.find(p => p.product_id === pId);
                  setEditForm({...editForm, product_id: pId, net_value: prod ? prod.value * (editForm.qty || 1) : 0});
                }}
              >
                <option value="">-- Chọn --</option>
                {filteredProducts.map(p => <option key={p.product_id} value={p.product_id}>{p.product_name}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Số lượng</label>
              <input 
                type="number" min="1"
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" 
                value={editForm.qty || ''} 
                onChange={e => {
                  const q = parseInt(e.target.value) || 0;
                  const prod = products.find(p => p.product_id === editForm.product_id);
                  setEditForm({...editForm, qty: q, net_value: prod ? prod.value * q : editForm.net_value});
                }} 
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Số tiền (VNĐ) *</label>
              <input 
                type="text" 
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2 font-bold text-indigo-700 bg-indigo-50" 
                value={formatCurrency(editForm.net_value)} 
                onChange={e => {
                  const rawValue = e.target.value.replace(/\D/g, '');
                  setEditForm({...editForm, net_value: rawValue ? parseInt(rawValue, 10) : 0});
                }} 
              />
            </div>
          </div>

          <div className="p-3 bg-yellow-50 rounded-lg border border-yellow-200 mt-4">
            <label className="flex items-center space-x-2 text-sm font-medium text-yellow-900 cursor-pointer">
              <input type="checkbox" checked={isConverted} onChange={e => setIsConverted(e.target.checked)} className="rounded text-indigo-600 focus:ring-indigo-500" />
              <span>Sản phẩm này là khách đổi từ hãng khác?</span>
            </label>
            {isConverted && (
              <input 
                type="text" placeholder="Tên hãng đối thủ (VD: Enfa)..." 
                className="mt-2 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
                value={competitorBrand} onChange={e => setCompetitorBrand(e.target.value)}
              />
            )}
          </div>

          <div className="flex justify-end space-x-3 mt-6">
            <button onClick={() => { setIsModalOpen(false); setCurrentCartId(''); }} disabled={saveMutation.isPending} className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">Đóng</button>
            {isAdding && (
              <button onClick={() => handleSave(true)} disabled={saveMutation.isPending} className="rounded-md border border-transparent bg-indigo-100 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-200 disabled:opacity-50">
                {saveMutation.isPending ? '...' : 'Lưu & Thêm tiếp'}
              </button>
            )}
            <button onClick={() => handleSave(false)} disabled={saveMutation.isPending} className="rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
              {saveMutation.isPending ? 'Đang lưu...' : 'Lưu & Đóng'}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={confirmDelete}
        title="Xóa Sản phẩm"
        message="Bạn có chắc chắn muốn xóa sản phẩm này khỏi hệ thống không? Doanh thu của PG sẽ bị trừ đi tương ứng."
      />

      {/* MODAL XEM ẢNH BILL */}
      <Modal 
        isOpen={isBillModalOpen} 
        onClose={() => { setIsBillModalOpen(false); setViewingBillImages(null); setZoomedImage(null); }} 
        title="Ảnh hóa đơn (Bill Images)"
      >
        <div className="space-y-4">
          {loadingBill ? (
            <div className="flex flex-col items-center justify-center py-10 space-y-3">
              <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
              <p className="text-sm text-gray-500">Đang tải ảnh hóa đơn...</p>
            </div>
          ) : viewingBillImages && viewingBillImages.length > 0 ? (
            <div className="grid grid-cols-1 gap-4">
              {viewingBillImages.map((url, idx) => (
                <div key={idx} className="rounded-lg overflow-hidden border border-gray-200 shadow-sm group relative">
                  <img 
                    src={url} 
                    alt={`Bill ${idx + 1}`} 
                    className="w-full h-auto object-contain max-h-[70vh] cursor-zoom-in hover:opacity-95 transition-opacity" 
                    referrerPolicy="no-referrer"
                    onClick={() => setZoomedImage(url)}
                  />
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                    <div className="bg-black/50 text-white px-3 py-1 rounded-full text-xs font-bold">Click để phóng to</div>
                  </div>
                  <div className="bg-gray-50 p-2 text-center text-xs text-gray-500 border-t border-gray-100">
                    Ảnh {idx + 1} / {viewingBillImages.length}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-10 text-gray-500">
              Không tìm thấy ảnh hóa đơn cho đơn hàng này.
            </div>
          )}
          <div className="flex justify-end mt-4">
            <button 
              onClick={() => { setIsBillModalOpen(false); setViewingBillImages(null); setZoomedImage(null); }} 
              className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg font-medium hover:bg-gray-200 transition-colors"
            >
              Đóng
            </button>
          </div>
        </div>
      </Modal>

      {/* MODAL PHÓNG TO ẢNH */}
      {zoomedImage && (
        <div 
          className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center p-4 cursor-zoom-out"
          onClick={() => setZoomedImage(null)}
        >
          <div className="relative max-w-full max-h-full">
            <img 
              src={zoomedImage} 
              alt="Zoomed Bill" 
              className="max-w-full max-h-[95vh] object-contain shadow-2xl rounded-lg"
              referrerPolicy="no-referrer"
            />
            <button 
              className="absolute top-4 right-4 bg-white/20 hover:bg-white/40 text-white rounded-full p-2 transition-colors"
              onClick={(e) => { e.stopPropagation(); setZoomedImage(null); }}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}