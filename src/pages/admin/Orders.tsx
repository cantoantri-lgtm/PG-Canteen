import React, { useState, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { Plus, Edit2, Trash2, Download } from 'lucide-react';
import Modal from '../../components/Modal';
import ConfirmModal from '../../components/ConfirmModal';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useRealtimeSync } from '../../hooks/useRealtimeSync';

// --- CÁC INTERFACE DỮ LIỆU ---
interface Order {
  order_id: string;
  created_date: string;
  pg_id: string;
  product_id: string;
  qty: number;
  net_value: number;
  is_competitor_product: boolean;
  profiles?: { full_name: string };
  products?: { product_name: string; brand_id: string };
}

interface Profile { id: string; full_name: string; }
interface Brand { brand_id: string; brand_name: string; }
interface Product { product_id: string; product_name: string; brand_id: string; }

export default function Orders() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Order>>({});
  const [isAdding, setIsAdding] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [selectedBrandId, setSelectedBrandId] = useState<string>('');

  // --- 1. LẤY DỮ LIỆU TỪ SUPABASE ---
  const { data: orders = [], isLoading: loadingOrders } = useQuery({
    queryKey: ['orders'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('*, profiles(full_name), products(product_name, brand_id)')
        .order('created_date', { ascending: false });
      if (error) throw error;
      return data as Order[];
    }
  });

  const { data: profiles = [] } = useQuery({
    queryKey: ['profiles_list'],
    queryFn: async () => {
      // Chỉ lấy danh sách nhân viên PG (admin_role = false)
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
    queryKey: ['orders'],
    idColumn: 'order_id'
  }), []);
  useRealtimeSync(orderSyncConfig);

  // --- 3. MUTATIONS (THÊM / SỬA / XÓA) ---
  const saveMutation = useMutation({
    mutationFn: async ({ payload }: { payload: any; isKeepOpen: boolean }) => {
      if (isAdding) {
        const { error } = await supabase.from('orders').insert([payload]); 
        if (error) throw error;
        return payload;
      } else {
        const { error } = await supabase.from('orders').update(payload).eq('order_id', editForm.order_id);
        if (error) throw error;
        return payload;
      }
    },
    onSuccess: (_, variables) => {
      toast.success(isAdding ? 'Thêm đơn hàng thành công!' : 'Cập nhật đơn hàng thành công!');
      if (variables.isKeepOpen && isAdding) {
        // Giữ lại tên PG và Thương hiệu, chỉ reset Sản phẩm, SL và Giá tiền
        setEditForm(prev => ({ ...prev, product_id: '', qty: 1, net_value: 0, is_competitor_product: false }));
      } else {
        setIsModalOpen(false);
      }
    },
    onError: (error: any) => {
      toast.error(`Không thể lưu: ${error.message}`);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('orders').delete().eq('order_id', id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => toast.success('Đã xóa đơn hàng!')
  });

  // --- 4. CÁC HÀM XỬ LÝ GIAO DIỆN ---
  const formatCurrency = (value: any) => {
    if (value === null || value === undefined) return '';
    const numericValue = value.toString().replace(/\D/g, '');
    return numericValue.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  };

  const handleAdd = () => {
    setIsAdding(true);
    setEditForm({ qty: 1, net_value: 0, is_competitor_product: false });
    setSelectedBrandId('');
    setIsModalOpen(true);
  };

  const handleEdit = (order: Order) => {
    setIsAdding(false);
    setEditForm(order);
    // Tự động set Thương hiệu khi bấm Sửa
    if (order.products?.brand_id) {
      setSelectedBrandId(order.products.brand_id);
    }
    setIsModalOpen(true);
  };

  const handleSave = (isKeepOpen = false) => {
    if (!editForm.pg_id || !editForm.product_id || !editForm.qty || editForm.net_value === undefined) {
      toast.error("Vui lòng điền đầy đủ các trường bắt buộc (*)");
      return;
    }

    const payload = {
      pg_id: editForm.pg_id,
      product_id: editForm.product_id,
      qty: editForm.qty,
      net_value: editForm.net_value,
      is_competitor_product: editForm.is_competitor_product || false
    };

    saveMutation.mutate({ payload, isKeepOpen });
  };

  // Hàm xác nhận xóa đơn hàng
  const confirmDelete = () => {
    if (deleteId) {
      deleteMutation.mutate(deleteId);
      setDeleteId(null);
    }
  };

  // Lọc sản phẩm theo thương hiệu đã chọn
  const filteredProducts = products.filter(p => !selectedBrandId || p.brand_id === selectedBrandId);

  const exportToCSV = () => {
    if (!orders || orders.length === 0) {
      toast.error('Không có dữ liệu để xuất');
      return;
    }

    const headers = ['Ngày tạo', 'Nhân viên PG', 'Sản phẩm', 'Số lượng', 'Thành tiền', 'Đối thủ?'];

    const rows = orders.map(order => [
      new Date(order.created_date).toLocaleString('vi-VN'),
      order.profiles?.full_name || 'N/A',
      order.products?.product_name || 'N/A',
      order.qty,
      order.net_value,
      order.is_competitor_product ? 'Có' : 'Không'
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `don_hang_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (loadingOrders) return <div className="p-8 text-center text-indigo-600 animate-pulse font-semibold">Đang tải đơn hàng...</div>;

  return (
    <div className="space-y-6">
      <div className="sm:flex sm:items-center sm:justify-between">
        <h2 className="text-2xl font-bold text-gray-900">Quản lý Đơn hàng</h2>
        <div className="mt-3 sm:mt-0 flex space-x-3">
          <button onClick={exportToCSV} className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50">
            <Download className="-ml-1 mr-2 h-5 w-5 text-gray-400" />
            Xuất CSV
          </button>
          <button onClick={handleAdd} className="inline-flex items-center justify-center rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700">
            <Plus className="-ml-1 mr-2 h-5 w-5" />
            Thêm Đơn hàng
          </button>
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
                    <th className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900">Ngày tạo</th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Nhân viên PG</th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Sản phẩm</th>
                    <th className="px-3 py-3.5 text-right text-sm font-semibold text-gray-900">Số lượng</th>
                    <th className="px-3 py-3.5 text-right text-sm font-semibold text-gray-900">Thành tiền</th>
                    <th className="px-3 py-3.5 text-center text-sm font-semibold text-gray-900">Đối thủ?</th>
                    <th className="relative py-3.5 pl-3 pr-4 sm:pr-6"><span className="sr-only">Thao tác</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {orders.map((order) => (
                    <tr key={order.order_id}>
                      <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm text-gray-500">
                        {new Date(order.created_date).toLocaleString('vi-VN')}
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm font-medium text-indigo-600">{order.profiles?.full_name || 'N/A'}</td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-900">{order.products?.product_name || 'N/A'}</td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-900 text-right font-semibold">{order.qty}</td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-green-600 text-right font-semibold">
                        {order.net_value.toLocaleString('vi-VN')} đ
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-center">
                        {order.is_competitor_product ? <span className="text-red-600 font-bold">Có</span> : <span className="text-gray-400">-</span>}
                      </td>
                      <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                        <button onClick={() => handleEdit(order)} className="text-indigo-600 hover:text-indigo-900 mr-4"><Edit2 className="h-4 w-4" /></button>
                        <button onClick={() => setDeleteId(order.order_id)} className="text-red-600 hover:text-red-900"><Trash2 className="h-4 w-4" /></button>
                      </td>
                    </tr>
                  ))}
                  {orders.length === 0 && <tr><td colSpan={7} className="px-6 py-8 text-center text-gray-500">Chưa có đơn hàng nào.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* MODAL THÊM/SỬA */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={isAdding ? 'Thêm Đơn hàng' : 'Sửa Đơn hàng'}>
        <div className="space-y-4">
          
          {/* Nhân viên PG */}
          <div>
            <label className="block text-sm font-medium text-gray-700">Nhân viên PG *</label>
            <select
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2 bg-white"
              value={editForm.pg_id || ''}
              onChange={e => setEditForm({...editForm, pg_id: e.target.value})}
            >
              <option value="">-- Chọn nhân viên --</option>
              {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Thương hiệu */}
            <div>
              <label className="block text-sm font-medium text-gray-700">Thương hiệu (Nhãn)</label>
              <select
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2 bg-white"
                value={selectedBrandId}
                onChange={e => {
                  setSelectedBrandId(e.target.value);
                  setEditForm({...editForm, product_id: ''}); // Reset SP khi đổi hãng
                }}
              >
                <option value="">Tất cả thương hiệu</option>
                {brands.map(b => <option key={b.brand_id} value={b.brand_id}>{b.brand_name}</option>)}
              </select>
            </div>

            {/* Sản phẩm */}
            <div>
              <label className="block text-sm font-medium text-gray-700">Sản phẩm *</label>
              <select
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2 bg-white"
                value={editForm.product_id || ''}
                onChange={e => setEditForm({...editForm, product_id: e.target.value})}
              >
                <option value="">-- Chọn sản phẩm --</option>
                {filteredProducts.map(p => <option key={p.product_id} value={p.product_id}>{p.product_name}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Số lượng */}
            <div>
              <label className="block text-sm font-medium text-gray-700">Số lượng</label>
              <input 
                type="number" min="1"
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" 
                value={editForm.qty || ''} 
                onChange={e => setEditForm({...editForm, qty: parseInt(e.target.value) || 0})} 
              />
            </div>

            {/* Số tiền (Có định dạng dấu phẩy) */}
            <div>
              <label className="block text-sm font-medium text-gray-700">Số tiền (VNĐ) *</label>
              <input 
                type="text" 
                placeholder="0"
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" 
                value={formatCurrency(editForm.net_value)} 
                onChange={e => {
                  const rawValue = e.target.value.replace(/\D/g, ''); // Lột bỏ dấu phẩy
                  setEditForm({...editForm, net_value: rawValue ? parseInt(rawValue, 10) : 0});
                }} 
              />
            </div>
          </div>

          {/* Đối thủ */}
          <div className="flex items-center mt-4">
            <input
              id="competitor"
              type="checkbox"
              className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              checked={editForm.is_competitor_product || false}
              onChange={e => setEditForm({...editForm, is_competitor_product: e.target.checked})}
            />
            <label htmlFor="competitor" className="ml-2 block text-sm text-gray-900">
              Đang sử dụng sản phẩm đối thủ
            </label>
          </div>

          <div className="flex justify-end space-x-3 mt-6">
            <button onClick={() => setIsModalOpen(false)} disabled={saveMutation.isPending} className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">Hủy</button>
            {isAdding && (
              <button onClick={() => handleSave(true)} disabled={saveMutation.isPending} className="rounded-md border border-transparent bg-indigo-100 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-200 disabled:opacity-50">
                {saveMutation.isPending ? 'Đang lưu...' : 'Lưu & Thêm tiếp'}
              </button>
            )}
            <button onClick={() => handleSave(false)} disabled={saveMutation.isPending} className="rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
              {saveMutation.isPending ? 'Đang lưu...' : 'Lưu'}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={confirmDelete}
        title="Xóa Đơn hàng"
        message="Bạn có chắc chắn muốn xóa đơn hàng này không? Dữ liệu doanh thu liên quan sẽ bị trừ đi tương ứng."
      />
    </div>
  );
}