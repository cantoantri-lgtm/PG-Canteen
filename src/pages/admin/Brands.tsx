import React, { useState, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { Plus, Edit2, Trash2 } from 'lucide-react';
import Modal from '../../components/Modal';
import ConfirmModal from '../../components/ConfirmModal';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useRealtimeSync } from '../../hooks/useRealtimeSync';
import CreatableSelect from 'react-select/creatable';

interface Brand {
  brand_id: string;
  brand_name: string;
  category_id?: number;
  categories?: {
    id: number;
    name: string;
  };
}

export default function Brands() {
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Brand>>({});
  const [selectedCategory, setSelectedCategory] = useState<{value: string | number, label: string, __isNew__?: boolean} | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState('');

  // 1. Fetch Data with React Query
  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const { data, error } = await supabase.from('categories').select('*').order('name');
      if (error) throw error;
      return data;
    }
  });

  const { data: brands = [], isLoading } = useQuery({
    queryKey: ['brands'],
    queryFn: async () => {
      const { data, error } = await supabase.from('brands').select('*, categories(id, name)').order('brand_name');
      if (error) throw error;
      return data as Brand[];
    }
  });

  // 3. Realtime Sync
  useRealtimeSync({ table: 'categories', queryKey: ['categories'], idColumn: 'id' });
  useRealtimeSync({
    table: 'brands',
    queryKey: ['brands'],
    idColumn: 'brand_id',
    selectQuery: '*, categories(id, name)'
  });

  const filteredBrands = useMemo(() => {
    return brands.filter(b => {
      const matchesSearch = (b.brand_name || '').toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory = selectedCategoryFilter === '' || b.category_id?.toString() === selectedCategoryFilter;
      return matchesSearch && matchesCategory;
    });
  }, [brands, searchQuery, selectedCategoryFilter]);

  // 2. Mutations
  const saveMutation = useMutation({
    mutationFn: async ({ payload }: { payload: any; isKeepOpen: boolean }) => {
      if (isAdding) {
        const { data, error } = await supabase
          .from('brands')
          .insert([payload])
          .select('*, categories(id, name)')
          .single();
        if (error) throw error;
        return data as Brand;
      } else {
        const { data, error } = await supabase
          .from('brands')
          .update(payload)
          .eq('brand_id', editForm.brand_id)
          .select('*, categories(id, name)')
          .single();
        if (error) throw error;
        return data as Brand;
      }
    },
    onSuccess: (data, variables) => {
      if (isAdding) {
        queryClient.setQueryData(['brands'], (old: Brand[] = []) => {
          const exists = old.some(b => b.brand_id === data.brand_id);
          if (exists) return old;
          return [...old, data].sort((a, b) => (a.brand_name || '').localeCompare(b.brand_name || ''));
        });
      } else {
        queryClient.setQueryData(['brands'], (old: Brand[] = []) => {
          return old.map(b => b.brand_id === data.brand_id ? data : b).sort((a, b) => (a.brand_name || '').localeCompare(b.brand_name || ''));
        });
      }

      toast.success(isAdding ? 'Thêm thương hiệu thành công!' : 'Cập nhật thương hiệu thành công!');
      
      if (variables.isKeepOpen && isAdding) {
        setEditForm({ brand_name: '' });
      } else {
        setIsModalOpen(false);
      }
    },
    onError: (error: any) => {
      console.error('Lỗi khi lưu:', error);
      toast.error(`Không thể lưu: ${error.message}`);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('brands').delete().eq('brand_id', id);
      if (error) throw error;
      return id;
    },
    onSuccess: (id) => {
      queryClient.setQueryData(['brands'], (old: Brand[] = []) => {
        return old.filter(b => b.brand_id !== id);
      });
      toast.success('Đã xóa thương hiệu!');
    },
    onError: (error: any) => {
      console.error('Error deleting:', error);
      toast.error(`Lỗi khi xóa: ${error.message}`);
    }
  });

  const handleAdd = () => {
    setIsAdding(true);
    setEditForm({});
    setSelectedCategory(null);
    setIsModalOpen(true);
  };

  const handleEdit = (brand: Brand) => {
    setIsAdding(false);
    setEditForm(brand);
    if (brand.category_id && brand.categories) {
      setSelectedCategory({ value: brand.category_id, label: brand.categories.name });
    } else {
      setSelectedCategory(null);
    }
    setIsModalOpen(true);
  };

  const handleSave = async (isKeepOpen = false) => {
    if (!editForm.brand_name?.trim()) {
      toast.error("Vui lòng nhập tên Thương hiệu.");
      return;
    }

    let finalCategoryId = selectedCategory?.value;

    try {
      if (selectedCategory && selectedCategory.__isNew__) {
        const { data: newCat, error } = await supabase
          .from('categories')
          .insert([{ name: selectedCategory.label }])
          .select()
          .single();
        if (error) throw error;
        finalCategoryId = newCat.id;
      }

      const payload = {
        brand_name: editForm.brand_name.trim(),
        category_id: finalCategoryId || null
      };

      saveMutation.mutate({ payload, isKeepOpen });
    } catch (error: any) {
      console.error('Error saving category:', error);
      toast.error(`Lỗi khi lưu ngành hàng: ${error.message}`);
    }
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

  if (isLoading) return <div className="p-8 text-center">Đang tải danh sách thương hiệu...</div>;

  return (
    <div className="space-y-6">
      <div className="sm:flex sm:items-center sm:justify-between">
        <h2 className="text-2xl font-bold text-gray-900">Thương hiệu</h2>
        <button
          onClick={handleAdd}
          className="mt-3 sm:mt-0 inline-flex items-center justify-center rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 sm:w-auto"
        >
          <Plus className="-ml-1 mr-2 h-5 w-5" />
          Thêm Thương hiệu
        </button>
      </div>

      <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 flex flex-col sm:flex-row gap-4">
        <div className="flex-1">
          <label className="block text-sm font-medium text-gray-700 mb-1">Tìm kiếm thương hiệu</label>
          <input
            type="text"
            placeholder="Nhập tên thương hiệu..."
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="w-full sm:w-64">
          <label className="block text-sm font-medium text-gray-700 mb-1">Lọc theo Ngành hàng</label>
          <select
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2 bg-white"
            value={selectedCategoryFilter}
            onChange={(e) => setSelectedCategoryFilter(e.target.value)}
          >
            <option value="">Tất cả ngành hàng</option>
            {categories.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
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
                    <th className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 sm:pl-6">Tên Thương hiệu</th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Ngành hàng</th>
                    <th className="relative py-3.5 pl-3 pr-4 sm:pr-6"><span className="sr-only">Thao tác</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {filteredBrands.map((brand) => (
                    <tr key={brand.brand_id}>
                      <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-900 sm:pl-6">{brand.brand_name}</td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{brand.categories?.name || '-'}</td>
                      <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                        <button onClick={() => handleEdit(brand)} className="text-indigo-600 hover:text-indigo-900 mr-4"><Edit2 className="h-4 w-4" /></button>
                        <button onClick={() => handleDelete(brand.brand_id)} className="text-red-600 hover:text-red-900"><Trash2 className="h-4 w-4" /></button>
                      </td>
                    </tr>
                  ))}
                  {filteredBrands.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-center">
                        Không tìm thấy thương hiệu nào.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={isAdding ? 'Thêm Thương hiệu' : 'Sửa Thương hiệu'}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Ngành hàng</label>
            <CreatableSelect
              isClearable
              placeholder="Chọn hoặc nhập ngành hàng mới..."
              options={categories.map((c: any) => ({ value: c.id, label: c.name }))}
              value={selectedCategory}
              onChange={(newValue) => setSelectedCategory(newValue)}
              className="text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Tên Thương hiệu *</label>
            <input 
              type="text" 
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" 
              value={editForm.brand_name || ''} 
              onChange={e => setEditForm({...editForm, brand_name: e.target.value})} 
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
        title="Xóa Thương hiệu"
        message="Bạn có chắc chắn muốn xóa thương hiệu này không? Hành động này không thể hoàn tác."
      />
    </div>
  );
}