import React, { useState, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { Plus, Edit2, Trash2 } from 'lucide-react';
import Modal from '../../components/Modal';
import ConfirmModal from '../../components/ConfirmModal';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useRealtimeSync } from '../../hooks/useRealtimeSync';

interface Canteen {
  canteen_id: string;
  canteen_name: string;
  hospital_name: string;
}

export default function Canteens() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Canteen>>({});
  const [isAdding, setIsAdding] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // 1. Fetch Data with React Query
  const { data: canteens = [], isLoading } = useQuery({
    queryKey: ['canteens'],
    queryFn: async () => {
      const { data, error } = await supabase.from('canteens').select('*').order('canteen_name');
      if (error) throw error;
      return data as Canteen[];
    }
  });

  // 2. Realtime Sync
  const canteenSyncConfig = useMemo(() => ({
    table: 'canteens',
    queryKey: ['canteens'],
    idColumn: 'canteen_id'
  }), []);

  useRealtimeSync(canteenSyncConfig);

  // 3. Mutations (Đã loại bỏ .select().single() để tránh kẹt RLS)
  const saveMutation = useMutation({
    mutationFn: async ({ payload }: { payload: any; isKeepOpen: boolean }) => {
      if (isAdding) {
        // Chỉ đẩy lệnh Insert, không yêu cầu Select trả về
        const { error } = await supabase
          .from('canteens')
          .insert([payload]);
        if (error) throw error;
        return payload;
      } else {
        // Chỉ đẩy lệnh Update, không yêu cầu Select trả về
        const { error } = await supabase
          .from('canteens')
          .update(payload)
          .eq('canteen_id', editForm.canteen_id);
        if (error) throw error;
        return payload;
      }
    },
    onSuccess: (_, variables) => {
      toast.success(isAdding ? 'Thêm căn tin thành công!' : 'Cập nhật căn tin thành công!');
      
      if (variables.isKeepOpen && isAdding) {
        setEditForm({ canteen_name: '', hospital_name: '' });
      } else {
        setIsModalOpen(false);
      }
    },
    onError: (error: any) => {
      console.error('Lỗi khi lưu căn tin:', error);
      toast.error(`Không thể lưu: ${error.message}`);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('canteens').delete().eq('canteen_id', id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => {
      toast.success('Đã xóa căn tin!');
    },
    onError: (error: any) => {
      console.error('Error deleting canteen:', error);
      toast.error(`Lỗi khi xóa: ${error.message}`);
    }
  });

  const handleAdd = () => {
    setIsAdding(true);
    setEditForm({});
    setIsModalOpen(true);
  };

  const handleEdit = (canteen: Canteen) => {
    setIsAdding(false);
    setEditForm(canteen);
    setIsModalOpen(true);
  };

  const handleSave = (isKeepOpen = false) => {
    if (!editForm.canteen_name?.trim() || !editForm.hospital_name?.trim()) {
      toast.error("Vui lòng nhập đầy đủ Tên Căn tin và Tên Bệnh viện.");
      return;
    }

    const payload = {
      canteen_name: editForm.canteen_name.trim(),
      hospital_name: editForm.hospital_name.trim()
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

  if (isLoading) return <div className="p-8 text-center text-indigo-600 font-semibold animate-pulse">Đang tải danh sách căn tin...</div>;

  return (
    <div className="space-y-6">
      <div className="sm:flex sm:items-center sm:justify-between">
        <h2 className="text-2xl font-bold text-gray-900">Căn tin</h2>
        <button
          onClick={handleAdd}
          className="mt-3 sm:mt-0 inline-flex items-center justify-center rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 sm:w-auto"
        >
          <Plus className="-ml-1 mr-2 h-5 w-5" />
          Thêm Căn tin
        </button>
      </div>

      <div className="mt-8 flex flex-col">
        <div className="-my-2 -mx-4 overflow-x-auto sm:-mx-6 lg:-mx-8">
          <div className="inline-block min-w-full py-2 align-middle md:px-6 lg:px-8">
            <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 md:rounded-lg">
              <table className="min-w-full divide-y divide-gray-300">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 sm:pl-6">Tên Căn tin</th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Tên Bệnh viện</th>
                    <th className="relative py-3.5 pl-3 pr-4 sm:pr-6"><span className="sr-only">Thao tác</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {canteens.map((canteen) => (
                    <tr key={canteen.canteen_id}>
                      <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-900 sm:pl-6">{canteen.canteen_name}</td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{canteen.hospital_name}</td>
                      <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                        <button onClick={() => handleEdit(canteen)} className="text-indigo-600 hover:text-indigo-900 mr-4"><Edit2 className="h-4 w-4" /></button>
                        <button onClick={() => handleDelete(canteen.canteen_id)} className="text-red-600 hover:text-red-900"><Trash2 className="h-4 w-4" /></button>
                      </td>
                    </tr>
                  ))}
                  {canteens.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-center">
                        Chưa có dữ liệu căn tin.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={isAdding ? 'Thêm Căn tin' : 'Sửa Căn tin'}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Tên Căn tin</label>
            <input 
              type="text" 
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" 
              value={editForm.canteen_name || ''} 
              onChange={e => setEditForm({...editForm, canteen_name: e.target.value})} 
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Tên Bệnh viện</label>
            <input 
              type="text" 
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" 
              value={editForm.hospital_name || ''} 
              onChange={e => setEditForm({...editForm, hospital_name: e.target.value})} 
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
        title="Xóa Căn tin"
        message="Bạn có chắc chắn muốn xóa căn tin này không? Hành động này không thể hoàn tác."
      />
    </div>
  );
}