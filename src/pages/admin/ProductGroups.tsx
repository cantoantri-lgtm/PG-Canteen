import React, { useState, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { Plus, Edit2, Trash2 } from 'lucide-react';
import Modal from '../../components/Modal';
import ConfirmModal from '../../components/ConfirmModal';
import Pagination from '../../components/Pagination';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useRealtimeSync } from '../../hooks/useRealtimeSync';

interface ProductGroup {
  id: string;
  name: string;
  brand_id: string;
  brands?: { brand_name: string };
}

interface Brand {
  brand_id: string;
  brand_name: string;
}

export default function ProductGroups() {
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editForm, setEditForm] = useState<Partial<ProductGroup>>({});
  const [isAdding, setIsAdding] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

  // 1. Fetch Data with React Query
  const { data: productGroups = [], isLoading } = useQuery({
    queryKey: ['product_groups'],
    queryFn: async () => {
      const { data, error } = await supabase.from('product_group').select('*, brands(brand_name)').order('name');
      if (error) throw error;
      return data as ProductGroup[];
    }
  });

  const { data: brands = [] } = useQuery({
    queryKey: ['brands'],
    queryFn: async () => {
      const { data, error } = await supabase.from('brands').select('*').order('brand_name');
      if (error) throw error;
      return data as Brand[];
    }
  });

  // 3. Realtime Sync
  useRealtimeSync({
    table: 'product_group',
    queryKey: ['product_groups'],
    idColumn: 'id',
    selectQuery: '*, brands(brand_name)'
  });

  const filteredGroups = useMemo(() => {
    return productGroups.filter(pg => 
      (pg.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (pg.brands?.brand_name || '').toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [productGroups, searchQuery]);

  const totalPages = Math.ceil(filteredGroups.length / itemsPerPage);
  const paginatedGroups = filteredGroups.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  React.useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  // 2. Mutations
  const saveMutation = useMutation({
    mutationFn: async ({ payload }: { payload: any; isKeepOpen: boolean }) => {
      if (isAdding) {
        const { data, error } = await supabase
          .from('product_group')
          .insert([payload])
          .select('*, brands(brand_name)')
          .single();
        if (error) throw error;
        return data as ProductGroup;
      } else {
        const { data, error } = await supabase
          .from('product_group')
          .update(payload)
          .eq('id', editForm.id)
          .select('*, brands(brand_name)')
          .single();
        if (error) throw error;
        return data as ProductGroup;
      }
    },
    onSuccess: (data, variables) => {
      toast.success(isAdding ? 'Thêm nhóm hàng thành công!' : 'Cập nhật nhóm hàng thành công!');
      
      if (variables.isKeepOpen && isAdding) {
        setEditForm({ name: '', brand_id: editForm.brand_id });
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
      const { error } = await supabase.from('product_group').delete().eq('id', id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => {
      toast.success('Đã xóa nhóm hàng!');
    },
    onError: (error: any) => {
      console.error('Error deleting:', error);
      toast.error(`Lỗi khi xóa: ${error.message}`);
    }
  });

  const handleAdd = () => {
    setIsAdding(true);
    setEditForm({});
    setIsModalOpen(true);
  };

  const handleEdit = (group: ProductGroup) => {
    setIsAdding(false);
    setEditForm(group);
    setIsModalOpen(true);
  };

  const handleSave = (isKeepOpen = false) => {
    if (!editForm.name?.trim()) {
      toast.error("Vui lòng nhập tên Nhóm hàng.");
      return;
    }
    if (!editForm.brand_id) {
      toast.error("Vui lòng chọn Nhãn hàng.");
      return;
    }

    const payload = {
      name: editForm.name.trim(),
      brand_id: editForm.brand_id
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

  if (isLoading) return <div className="p-8 text-center">Đang tải danh sách nhóm hàng...</div>;

  return (
    <div className="space-y-6">
      <div className="sm:flex sm:items-center sm:justify-between">
        <h2 className="text-2xl font-bold text-gray-900">Nhóm hàng</h2>
        <button
          onClick={handleAdd}
          className="mt-3 sm:mt-0 inline-flex items-center justify-center rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 sm:w-auto"
        >
          <Plus className="-ml-1 mr-2 h-5 w-5" />
          Thêm Nhóm hàng
        </button>
      </div>

      <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
        <label className="block text-sm font-medium text-gray-700 mb-1">Tìm kiếm nhóm hàng</label>
        <input
          type="text"
          placeholder="Nhập tên nhóm hàng hoặc nhãn hàng..."
          className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <div className="mt-8 flex flex-col">
        <div className="-my-2 -mx-4 overflow-x-auto sm:-mx-6 lg:-mx-8">
          <div className="inline-block min-w-full py-2 align-middle md:px-6 lg:px-8">
            <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 md:rounded-lg">
              <table className="min-w-full divide-y divide-gray-300">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 sm:pl-6">Tên Nhóm hàng</th>
                    <th className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 sm:pl-6">Nhãn hàng</th>
                    <th className="relative py-3.5 pl-3 pr-4 sm:pr-6"><span className="sr-only">Thao tác</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {paginatedGroups.map((group) => (
                    <tr key={group.id}>
                      <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-900 sm:pl-6">{group.name}</td>
                      <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm text-gray-500 sm:pl-6">{group.brands?.brand_name}</td>
                      <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                        <button onClick={() => handleEdit(group)} className="text-indigo-600 hover:text-indigo-900 mr-4"><Edit2 className="h-4 w-4" /></button>
                        <button onClick={() => handleDelete(group.id)} className="text-red-600 hover:text-red-900"><Trash2 className="h-4 w-4" /></button>
                      </td>
                    </tr>
                  ))}
                  {paginatedGroups.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-center">
                        Không tìm thấy nhóm hàng nào.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={setCurrentPage}
              totalItems={filteredGroups.length}
              itemsPerPage={itemsPerPage}
            />
          </div>
        </div>
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={isAdding ? 'Thêm Nhóm hàng' : 'Sửa Nhóm hàng'}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Tên Nhóm hàng *</label>
            <input 
              type="text" 
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" 
              value={editForm.name || ''} 
              onChange={e => setEditForm({...editForm, name: e.target.value})} 
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Nhãn hàng *</label>
            <select 
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2 bg-white" 
              value={editForm.brand_id || ''} 
              onChange={e => setEditForm({...editForm, brand_id: e.target.value})}
            >
              <option value="">-- Chọn Nhãn hàng --</option>
              {brands.map(b => <option key={b.brand_id} value={b.brand_id}>{b.brand_name}</option>)}
            </select>
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
        title="Xóa Nhóm hàng"
        message="Bạn có chắc chắn muốn xóa nhóm hàng này không? Hành động này không thể hoàn tác."
      />
    </div>
  );
}
