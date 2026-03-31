import React, { useState, useRef, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { Plus, Edit2, Trash2 } from 'lucide-react';
import Modal from '../../components/Modal';
import ConfirmModal from '../../components/ConfirmModal';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useRealtimeSync } from '../../hooks/useRealtimeSync';

interface Product {
  product_id: string;
  product_name: string;
  brand_id: string;
  value: number;
  brands: { brand_name: string };
}

interface Brand {
  brand_id: string;
  brand_name: string;
}

export default function Products() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Product>>({});
  const [isAdding, setIsAdding] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  
  const inputRef = useRef<HTMLInputElement>(null);

  // 1. Fetch Data ban đầu với React Query
  const { data: products = [], isLoading: loadingProducts } = useQuery({
    queryKey: ['products'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('*, brands(brand_name)')
        .order('product_name');
      if (error) throw error;
      return data as Product[];
    }
  });

  const { data: brands = [], isLoading: loadingBrands } = useQuery({
    queryKey: ['brands'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('brands')
        .select('*')
        .order('brand_name');
      if (error) throw error;
      return data as Brand[];
    }
  });

  // 2. Realtime Sync (Sử dụng useMemo để tránh re-render và memory leak)
  const productSyncConfig = useMemo(() => ({
    table: 'products',
    queryKey: ['products'],
    idColumn: 'product_id',
    selectQuery: '*, brands(brand_name)'
  }), []);

  const brandSyncConfig = useMemo(() => ({
    table: 'brands',
    queryKey: ['brands'],
    idColumn: 'brand_id'
  }), []);

  useRealtimeSync(productSyncConfig);
  useRealtimeSync(brandSyncConfig);

  // 3. Mutations (Chỉ Đẩy dữ liệu lên Supabase, UI sẽ tự cập nhật qua Realtime)
  const saveMutation = useMutation({
    mutationFn: async ({ payload }: { payload: any; isKeepOpen: boolean }) => {
      if (isAdding) {
        const { data, error } = await supabase
          .from('products')
          .insert([payload])
          .select()
          .single();
        if (error) throw error;
        return data as Product;
      } else {
        const { data, error } = await supabase
          .from('products')
          .update(payload)
          .eq('product_id', editForm.product_id)
          .select()
          .single();
        if (error) throw error;
        return data as Product;
      }
    },
    onSuccess: (_, variables) => {
      // KHÔNG TỰ CẬP NHẬT CACHE NỮA - Realtime sẽ lo việc đó
      toast.success(isAdding ? 'Thêm sản phẩm thành công!' : 'Cập nhật sản phẩm thành công!');
      
      if (variables.isKeepOpen) {
        setEditForm(prev => ({ ...prev, product_name: '', value: 0 }));
        setTimeout(() => inputRef.current?.focus(), 100);
      } else {
        setIsModalOpen(false);
      }
    },
    onError: (error: any) => {
      console.error('Error saving product:', error);
      toast.error(`Không thể lưu: ${error.message}`);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('products').delete().eq('product_id', id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => {
      // KHÔNG TỰ CẬP NHẬT CACHE NỮA - Realtime sẽ lo việc đó
      toast.success('Đã xóa sản phẩm!');
    },
    onError: (error: any) => {
      toast.error(`Lỗi khi xóa: ${error.message}`);
    }
  });

  // 4. Handlers
  const handleAdd = () => {
    setIsAdding(true);
    setEditForm({ value: 0 }); 
    setIsModalOpen(true);
  };

  const handleEdit = (product: Product) => {
    setIsAdding(false);
    setEditForm(product);
    setIsModalOpen(true);
  };

  const handleSave = (isKeepOpen = false) => {
    if (!editForm.product_name?.trim() || !editForm.brand_id) {
      toast.error("Vui lòng nhập Tên sản phẩm và chọn Thương hiệu.");
      return;
    }

    const payload = {
      product_name: editForm.product_name.trim(),
      brand_id: editForm.brand_id,
      value: editForm.value || 0,
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

  const isLoading = loadingProducts || loadingBrands;
  const isSaving = saveMutation.isPending;

  if (isLoading) return <div className="p-8 text-center">Đang tải danh sách sản phẩm...</div>;

  return (
    <div className="space-y-6">
      <div className="sm:flex sm:items-center sm:justify-between">
        <h2 className="text-2xl font-bold text-gray-900">Sản phẩm</h2>
        <button
          onClick={handleAdd}
          className="mt-3 sm:mt-0 inline-flex items-center justify-center rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700"
        >
          <Plus className="-ml-1 mr-2 h-5 w-5" />
          Thêm Sản phẩm
        </button>
      </div>

      <div className="mt-8 flex flex-col">
        <div className="-my-2 -mx-4 overflow-x-auto sm:-mx-6 lg:-mx-8">
          <div className="inline-block min-w-full py-2 align-middle md:px-6 lg:px-8">
            <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 md:rounded-lg">
              <table className="min-w-full divide-y divide-gray-300">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 sm:pl-6">Tên Sản phẩm</th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Thương hiệu</th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Giá trị quy chuẩn</th>
                    <th className="relative py-3.5 pl-3 pr-4 sm:pr-6"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {products.map((product) => (
                    <tr key={product.product_id}>
                      <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-900 sm:pl-6">{product.product_name}</td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{product.brands?.brand_name}</td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm font-semibold text-gray-900">
                        {new Intl.NumberFormat('vi-VN').format(product.value)} VNĐ
                      </td>
                      <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                        <button onClick={() => handleEdit(product)} className="text-indigo-600 hover:text-indigo-900 mr-4"><Edit2 className="h-4 w-4" /></button>
                        <button onClick={() => handleDelete(product.product_id)} className="text-red-600 hover:text-red-900"><Trash2 className="h-4 w-4" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={isAdding ? 'Thêm Sản phẩm' : 'Sửa Sản phẩm'}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Tên Sản phẩm *</label>
            <input 
              type="text" 
              ref={inputRef}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" 
              value={editForm.product_name || ''} 
              onChange={e => setEditForm({...editForm, product_name: e.target.value})} 
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Thương hiệu *</label>
            <select 
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2 bg-white" 
              value={editForm.brand_id || ''} 
              onChange={e => setEditForm({...editForm, brand_id: e.target.value})}
            >
              <option value="">-- Chọn Thương hiệu --</option>
              {brands.map(b => <option key={b.brand_id} value={b.brand_id}>{b.brand_name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Giá trị quy chuẩn (VNĐ)</label>
            <input 
              type="number" 
              min="0"
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" 
              value={editForm.value ?? ''} 
              onChange={e => setEditForm({...editForm, value: Number(e.target.value)})} 
            />
          </div>
          <div className="flex justify-end space-x-3 mt-6">
            <button 
              onClick={() => setIsModalOpen(false)} 
              disabled={isSaving}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Hủy
            </button>
            {isAdding && (
              <button 
                onClick={() => handleSave(true)} 
                disabled={isSaving}
                className="rounded-md border border-transparent bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
              >
                {isSaving ? 'Đang lưu...' : 'Lưu & Thêm tiếp'}
              </button>
            )}
            <button 
              onClick={() => handleSave(false)} 
              disabled={isSaving}
              className="rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
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
        title="Xóa Sản phẩm"
        message="Bạn có chắc chắn muốn xóa sản phẩm này không? Hành động này không thể hoàn tác."
      />
    </div>
  );
}