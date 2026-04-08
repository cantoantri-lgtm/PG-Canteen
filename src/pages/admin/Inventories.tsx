import React, { useState, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { Plus, Edit2, Trash2 } from 'lucide-react';
import Modal from '../../components/Modal';
import ConfirmModal from '../../components/ConfirmModal';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useRealtimeSync } from '../../hooks/useRealtimeSync';

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
      const { data, error } = await supabase.from('profiles').select('*').order('full_name');
      if (error) throw error;
      return data;
    }
  });

  const { data: products = [] } = useQuery({
    queryKey: ['products'],
    queryFn: async () => {
      const { data, error } = await supabase.from('products').select('*').order('product_name');
      if (error) throw error;
      return data;
    }
  });

  const { data: brands = [] } = useQuery({
    queryKey: ['brands'],
    queryFn: async () => {
      const { data, error } = await supabase.from('brands').select('*').order('brand_name');
      if (error) throw error;
      return data;
    }
  });

  const { data: inventories = [], isLoading } = useQuery({
    queryKey: ['inventories'],
    queryFn: async () => {
      const { data, error } = await supabase.from('inventories').select('*, profiles(full_name), products(product_name)').order('last_updated', { ascending: false });
      if (error) throw error;
      return data as Inventory[];
    }
  });

  const inventorySyncConfig = useMemo(() => ({
    table: 'inventories',
    queryKey: ['inventories'],
    idColumn: 'id'
  }), []);

  useRealtimeSync(inventorySyncConfig);

  const filteredInventories = useMemo(() => {
    return inventories.filter(i => {
      const matchesSearch = (i.profiles?.full_name || '').toLowerCase().includes(searchQuery.toLowerCase()) || 
                           (i.products?.product_name || '').toLowerCase().includes(searchQuery.toLowerCase());
      const matchesSup = selectedSupFilter === '' || i.sup_id === selectedSupFilter;
      const matchesProduct = selectedProductFilter === '' || i.product_id === selectedProductFilter;
      return matchesSearch && matchesSup && matchesProduct;
    });
  }, [inventories, searchQuery, selectedSupFilter, selectedProductFilter]);

  const saveMutation = useMutation({
    mutationFn: async ({ payload }: { payload: any; isKeepOpen: boolean }) => {
      if (isAdding) {
        const { error } = await supabase.from('inventories').insert([payload]);
        if (error) throw error;
        return payload;
      } else {
        const { error } = await supabase.from('inventories').update(payload).eq('id', editForm.id);
        if (error) throw error;
        return payload;
      }
    },
    onSuccess: (_, variables) => {
      toast.success(isAdding ? 'Thêm inventory thành công!' : 'Cập nhật inventory thành công!');
      if (variables.isKeepOpen && isAdding) {
        setEditForm({ sup_id: '', product_id: '', quantity: 0 });
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
      const { error } = await supabase.from('inventories').delete().eq('id', id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => {
      toast.success('Đã xóa inventory!');
    },
    onError: (error: any) => {
      toast.error(`Lỗi khi xóa: ${error.message}`);
    }
  });

  const handleAdd = () => {
    setIsAdding(true);
    setEditForm({ quantity: 0 });
    setSelectedModalBrand('');
    setIsModalOpen(true);
  };

  const handleEdit = (inventory: Inventory) => {
    setIsAdding(false);
    setEditForm(inventory);
    
    // Find the brand of the product being edited
    const product = products.find((p: any) => p.product_id === inventory.product_id);
    if (product) {
      setSelectedModalBrand(product.brand_id || '');
    } else {
      setSelectedModalBrand('');
    }
    
    setIsModalOpen(true);
  };

  const handleSave = (isKeepOpen = false) => {
    if (!editForm.sup_id || !editForm.product_id) {
      toast.error("Vui lòng chọn SUP và Sản phẩm.");
      return;
    }

    const payload = {
      sup_id: editForm.sup_id,
      product_id: editForm.product_id,
      quantity: Number(editForm.quantity) || 0,
      last_updated: new Date().toISOString()
    };

    saveMutation.mutate({ payload, isKeepOpen });
  };

  const handleDelete = (id: string) => {
    setDeleteId(id);
  };

  const confirmDelete = () => {
    if (deleteId) {
      deleteMutation.mutate(deleteId);
      setDeleteId(null);
    }
  };

  const isSaving = saveMutation.isPending;

  if (isLoading) return <div className="p-8 text-center text-indigo-600 font-semibold animate-pulse">Đang tải danh sách inventory...</div>;

  return (
    <div className="space-y-6">
      <div className="sm:flex sm:items-center sm:justify-between">
        <h2 className="text-2xl font-bold text-gray-900">Inventories</h2>
        <button
          onClick={handleAdd}
          className="mt-3 sm:mt-0 inline-flex items-center justify-center rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 sm:w-auto"
        >
          <Plus className="-ml-1 mr-2 h-5 w-5" />
          Thêm Inventory
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 bg-white p-4 rounded-lg shadow-sm border border-gray-200">
        <div className="flex-1">
          <label className="block text-sm font-medium text-gray-700 mb-1">Tìm kiếm tồn kho</label>
          <input
            type="text"
            placeholder="Nhập tên SUP hoặc sản phẩm..."
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="w-full sm:w-48">
          <label className="block text-sm font-medium text-gray-700 mb-1">Lọc theo SUP</label>
          <select
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2 bg-white"
            value={selectedSupFilter}
            onChange={(e) => setSelectedSupFilter(e.target.value)}
          >
            <option value="">Tất cả SUP</option>
            {profiles.map((p: any) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        </div>
        <div className="w-full sm:w-48">
          <label className="block text-sm font-medium text-gray-700 mb-1">Lọc theo Sản phẩm</label>
          <select
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2 bg-white"
            value={selectedProductFilter}
            onChange={(e) => setSelectedProductFilter(e.target.value)}
          >
            <option value="">Tất cả Sản phẩm</option>
            {products.map((p: any) => <option key={p.product_id} value={p.product_id}>{p.product_name}</option>)}
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
                    <th className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 sm:pl-6">SUP</th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Sản phẩm</th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Số lượng</th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Cập nhật lần cuối</th>
                    <th className="relative py-3.5 pl-3 pr-4 sm:pr-6"><span className="sr-only">Thao tác</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {filteredInventories.map((inventory) => (
                    <tr key={inventory.id}>
                      <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-900 sm:pl-6">{inventory.profiles?.full_name}</td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{inventory.products?.product_name}</td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{inventory.quantity}</td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{new Date(inventory.last_updated).toLocaleString()}</td>
                      <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                        <button onClick={() => handleEdit(inventory)} className="text-indigo-600 hover:text-indigo-900 mr-4"><Edit2 className="h-4 w-4" /></button>
                        <button onClick={() => handleDelete(inventory.id)} className="text-red-600 hover:text-red-900"><Trash2 className="h-4 w-4" /></button>
                      </td>
                    </tr>
                  ))}
                  {filteredInventories.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-center">
                        Không tìm thấy dữ liệu tồn kho nào.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={isAdding ? 'Thêm Inventory' : 'Sửa Inventory'}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">SUP</label>
            <select
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
              value={editForm.sup_id || ''}
              onChange={e => setEditForm({...editForm, sup_id: e.target.value})}
            >
              <option value="">Chọn SUP</option>
              {profiles.map((p: any) => (
                <option key={p.id} value={p.id}>{p.full_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Nhãn hàng</label>
            <select
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
              value={selectedModalBrand}
              onChange={e => {
                setSelectedModalBrand(e.target.value);
                setEditForm({...editForm, product_id: ''}); // Reset product when brand changes
              }}
            >
              <option value="">-- Tất cả nhãn hàng --</option>
              {brands.map((b: any) => (
                <option key={b.brand_id} value={b.brand_id}>{b.brand_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Sản phẩm</label>
            <select
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
              value={editForm.product_id || ''}
              onChange={e => setEditForm({...editForm, product_id: e.target.value})}
            >
              <option value="">Chọn Sản phẩm</option>
              {products
                .filter((p: any) => selectedModalBrand === '' || p.brand_id === selectedModalBrand)
                .map((p: any) => (
                <option key={p.product_id} value={p.product_id}>{p.product_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Số lượng</label>
            <input 
              type="number" 
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" 
              value={editForm.quantity || 0} 
              onChange={e => setEditForm({...editForm, quantity: Number(e.target.value)})} 
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
        onConfirm={confirmDelete}
        title="Xóa Inventory"
        message="Bạn có chắc chắn muốn xóa inventory này không? Hành động này không thể hoàn tác."
      />
    </div>
  );
}
