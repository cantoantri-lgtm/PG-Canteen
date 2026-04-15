import React, { useState, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { Plus, Edit2, Trash2 } from 'lucide-react';
import Modal from '../../components/Modal';
import ConfirmModal from '../../components/ConfirmModal';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useRealtimeSync } from '../../hooks/useRealtimeSync';
import { useAuth } from '../../lib/AuthContext';

interface Inventory {
  id: string;
  sup_id: string;
  product_id: string;
  quantity: number;
  last_updated: string;
  profiles?: { full_name: string };
  products?: { product_name: string };
}

export default function Inventories() {
  const { user } = useAuth();
  const isAdmin = user?.admin_role === true || 
                  user?.role === 'admin' || 
                  user?.role_name?.toUpperCase() === 'ADMIN' || 
                  user?.email?.toLowerCase() === 'can.toantri@gmail.com';
  const isSup = user?.role_name?.toUpperCase() === 'SUP';

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Inventory>>({});
  const [isAdding, setIsAdding] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSupFilter, setSelectedSupFilter] = useState('');
  const [selectedProductFilter, setSelectedProductFilter] = useState('');
  const [selectedModalBrand, setSelectedModalBrand] = useState('');

  const { data: profiles = [] } = useQuery({
    queryKey: ['profiles'],
    queryFn: async () => {
      // 1. Lấy role_id của chức danh 'SUP' từ bảng roles
      const { data: roleData, error: roleError } = await supabase
        .from('roles')
        .select('role_id')
        .eq('role_name', 'SUP')
        .single();

      if (roleError || !roleData) {
        console.error("Lỗi khi lấy role_id của SUP:", roleError);
        return [];
      }

      // 2. Lấy danh sách profiles có chứa role_id của SUP
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('role_id', roleData.role_id)
        .order('full_name');

      if (error) {
        console.error("Lỗi khi lấy danh sách profiles:", error);
        throw error;
      }
      return data;
    }
  });

  const { data: products = [] } = useQuery({
    queryKey: ['products_simple'],
    queryFn: async () => {
      const { data, error } = await supabase.from('products').select('product_id, product_name, product_group_id').order('product_name');
      if (error) throw error;
      return data;
    }
  });

  const { data: productGroups = [] } = useQuery({
    queryKey: ['product_groups'],
    queryFn: async () => {
      const { data, error } = await supabase.from('product_group').select('id, name, brand_id');
      if (error) throw error;
      return data;
    }
  });

  const { data: brands = [] } = useQuery({
    queryKey: ['brands', isSup, user?.id],
    queryFn: async () => {
      let query = supabase.from('brands').select('brand_id, brand_name');
      
      if (isSup && user?.id) {
        // Get assigned program IDs
        const { data: assigned } = await supabase
          .from('sup_programs')
          .select('program_id')
          .eq('sup_id', user.id);
        
        const assignedIds = assigned?.map(a => a.program_id) || [];
        if (assignedIds.length === 0) return [];
        
        // Get brands linked to these programs
        const { data: progBrands } = await supabase
          .from('program_brands')
          .select('brand_id')
          .in('program_id', assignedIds);
        
        const brandIds = progBrands?.map(b => b.brand_id) || [];
        if (brandIds.length === 0) return [];
        
        query = query.in('brand_id', brandIds);
      }

      const { data, error } = await query.order('brand_name');
      if (error) throw error;
      return data;
    }
  });

  const { data: inventories = [], isLoading } = useQuery({
    queryKey: ['inventories', user?.id],
    queryFn: async () => {
      let query = supabase
        .from('inventories')
        .select(`
          *,
          profiles:sup_id (full_name),
          products:product_id (product_name)
        `)
        .order('last_updated', { ascending: false });
        
      if (isSup && user?.id) {
        query = query.eq('sup_id', user.id);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      return data as Inventory[];
    }
  });

  // ĐÃ SỬA: table: 'inventory' -> table: 'inventories'
  useRealtimeSync(useMemo(() => ({ table: 'inventories', queryKey: ['inventories'], idColumn: 'id', selectQuery: '*, profiles:sup_id(full_name), products:product_id(product_name)' }), []));

  const filteredInventories = useMemo(() => {
    return inventories.filter(inv => {
      const matchesSearch = inv.products?.product_name?.toLowerCase().includes(searchQuery.toLowerCase()) || 
                            inv.profiles?.full_name?.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesSup = selectedSupFilter === '' || inv.sup_id === selectedSupFilter;
      const matchesProduct = selectedProductFilter === '' || inv.product_id === selectedProductFilter;
      return matchesSearch && matchesSup && matchesProduct;
    });
  }, [inventories, searchQuery, selectedSupFilter, selectedProductFilter]);

  const saveMutation = useMutation({
    mutationFn: async ({ payload }: { payload: any; isKeepOpen: boolean }) => {
      if (isAdding) {
        // ĐÃ SỬA: 'inventory' -> 'inventories'
        const { data, error } = await supabase.from('inventories').insert([payload]).select().single();
        if (error) throw error;
        return data;
      } else {
        // ĐÃ SỬA: 'inventory' -> 'inventories'
        const { data, error } = await supabase.from('inventories').update(payload).eq('id', editForm.id).select().single();
        if (error) throw error;
        return data;
      }
    },
    onSuccess: (_, variables) => {
      toast.success(isAdding ? 'Thêm tồn kho thành công!' : 'Cập nhật tồn kho thành công!');
      if (variables.isKeepOpen) {
        setEditForm(prev => ({ ...prev, quantity: 0 }));
      } else {
        setIsModalOpen(false);
      }
    },
    onError: (error: any) => toast.error(`Lỗi: ${error.message}`)
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      // ĐÃ SỬA: 'inventory' -> 'inventories'
      const { error } = await supabase.from('inventories').delete().eq('id', id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => toast.success('Đã xóa tồn kho!'),
    onError: (error: any) => toast.error(`Lỗi khi xóa: ${error.message}`)
  });

  const handleAdd = () => {
    setIsAdding(true);
    setEditForm({ 
      quantity: 0,
      sup_id: isSup ? user?.id : undefined
    });
    setSelectedModalBrand('');
    setIsModalOpen(true);
  };

  const handleEdit = (inv: Inventory) => {
    setIsAdding(false);
    setEditForm(inv);
    const prod = products.find(p => p.product_id === inv.product_id);
    const pg = prod ? productGroups.find(g => g.id === prod.product_group_id) : null;
    setSelectedModalBrand(pg ? pg.brand_id : '');
    setIsModalOpen(true);
  };

  const handleSave = async (isKeepOpen = false) => {
    if (!editForm.product_id) {
      toast.error("Vui lòng chọn sản phẩm.");
      return;
    }
    if (!editForm.sup_id && !isSup) {
      toast.error("Vui lòng chọn Supervisor.");
      return;
    }

    try {
      const payload = {
        sup_id: isSup ? user?.id : editForm.sup_id,
        product_id: editForm.product_id,
        quantity: editForm.quantity || 0,
      };

      saveMutation.mutate({ payload, isKeepOpen });
    } catch (err: any) {
      console.error(err);
      toast.error(`Lỗi lưu dữ liệu liên quan: ${err.message}`);
    }
  };

  const isSaving = saveMutation.isPending;

  if (isLoading) return <div className="p-8 text-center">Đang tải dữ liệu tồn kho...</div>;

  return (
    <div className="space-y-6">
      <div className="sm:flex sm:items-center sm:justify-between">
        <h2 className="text-2xl font-bold text-gray-900">Kho hàng Supervisor</h2>
        <button
          onClick={handleAdd}
          className="mt-3 sm:mt-0 inline-flex items-center justify-center rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700"
        >
          <Plus className="-ml-1 mr-2 h-5 w-5" />
          Thêm Tồn kho
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 bg-white p-4 rounded-lg shadow-sm border border-gray-200">
        <div className="flex-1">
          <label className="block text-sm font-medium text-gray-700 mb-1">Tìm kiếm</label>
          <input
            type="text"
            placeholder="Tìm theo sản phẩm hoặc SUP..."
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        {isAdmin && (
          <div className="w-full sm:w-48">
            <label className="block text-sm font-medium text-gray-700 mb-1">Lọc theo SUP</label>
            <select
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2 bg-white"
              value={selectedSupFilter}
              onChange={(e) => setSelectedSupFilter(e.target.value)}
            >
              <option value="">Tất cả SUP</option>
              {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
          </div>
        )}
        <div className="w-full sm:w-64">
          <label className="block text-sm font-medium text-gray-700 mb-1">Lọc theo Sản phẩm</label>
          <select
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2 bg-white"
            value={selectedProductFilter}
            onChange={(e) => setSelectedProductFilter(e.target.value)}
          >
            <option value="">Tất cả Sản phẩm</option>
            {products.map(p => <option key={p.product_id} value={p.product_id}>{p.product_name}</option>)}
          </select>
        </div>
      </div>

      <div className="mt-8 flex flex-col">
        <div className="-my-2 -mx-4 overflow-x-auto sm:-mx-6 lg:-mx-8">
          <div className="inline-block min-w-full py-2 align-middle md:px-6 lg:px-8">
            <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 md:rounded-lg">
              <table className="min-w-full divide-y divide-gray-300">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 sm:pl-6">Supervisor</th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Sản phẩm</th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Số lượng</th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Cập nhật lần cuối</th>
                    <th className="relative py-3.5 pl-3 pr-4 sm:pr-6"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {filteredInventories.map((inv) => (
                    <tr key={inv.id}>
                      <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-900 sm:pl-6">
                        {inv.profiles?.full_name || 'Không xác định'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                        {inv.products?.product_name || 'Sản phẩm đã xóa'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-900 font-semibold">
                        {inv.quantity}
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                        {new Date(inv.last_updated).toLocaleString('vi-VN')}
                      </td>
                      <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                        <button onClick={() => handleEdit(inv)} className="text-indigo-600 hover:text-indigo-900 mr-4"><Edit2 className="h-4 w-4" /></button>
                        <button onClick={() => setDeleteId(inv.id)} className="text-red-600 hover:text-red-900"><Trash2 className="h-4 w-4" /></button>
                      </td>
                    </tr>
                  ))}
                  {filteredInventories.length === 0 && (
                    <tr><td colSpan={5} className="py-8 text-center text-gray-500">Không có dữ liệu tồn kho.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={isAdding ? 'Thêm Tồn kho' : 'Sửa Tồn kho'}>
        <div className="space-y-4">
          {isAdmin && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Supervisor *</label>
              <select
                className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2 bg-white"
                value={editForm.sup_id || ''}
                onChange={e => setEditForm({ ...editForm, sup_id: e.target.value })}
              >
                <option value="">Chọn Supervisor</option>
                {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Thương hiệu (Lọc sản phẩm)</label>
            <select
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2 bg-white"
              value={selectedModalBrand}
              onChange={e => {
                setSelectedModalBrand(e.target.value);
                setEditForm({ ...editForm, product_id: '' });
              }}
            >
              <option value="">Tất cả Thương hiệu</option>
              {brands.map(b => <option key={b.brand_id} value={b.brand_id}>{b.brand_name}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Sản phẩm *</label>
            <select
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2 bg-white"
              value={editForm.product_id || ''}
              onChange={e => setEditForm({ ...editForm, product_id: e.target.value })}
              disabled={products.length === 0}
            >
              <option value="">Chọn Sản phẩm</option>
              {products
                .filter(p => {
                  if (!selectedModalBrand) return true;
                  const pg = productGroups.find(g => g.id === p.product_group_id);
                  return pg && pg.brand_id === selectedModalBrand;
                })
                .map(p => <option key={p.product_id} value={p.product_id}>{p.product_name}</option>)
              }
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Số lượng *</label>
            <input
              type="number"
              min="0"
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
              value={editForm.quantity ?? ''}
              onChange={e => setEditForm({ ...editForm, quantity: Number(e.target.value) })}
            />
          </div>

          <div className="flex justify-end space-x-3 mt-6">
            <button 
              onClick={() => setIsModalOpen(false)} 
              disabled={isSaving}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Hủy
            </button>
            {isAdding && (
              <button 
                onClick={() => handleSave(true)} 
                disabled={isSaving}
                className="rounded-md border border-transparent bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
              >
                {isSaving ? 'Đang lưu...' : 'Lưu & Thêm tiếp'}
              </button>
            )}
            <button 
              onClick={() => handleSave(false)} 
              disabled={isSaving}
              className="rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {isSaving ? 'Đang lưu...' : 'Lưu'}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => { if (deleteId) deleteMutation.mutate(deleteId); setDeleteId(null); }}
        title="Xóa Tồn kho"
        message="Bạn có chắc chắn muốn xóa bản ghi này không?"
      />
    </div>
  );
}