import React, { useState, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { Plus, Edit2, Trash2 } from 'lucide-react';
import { safeFormatDate } from '../../lib/utils';
import Modal from '../../components/Modal';
import ConfirmModal from '../../components/ConfirmModal';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useRealtimeSync } from '../../hooks/useRealtimeSync';

interface Schedule {
  schedule_id: string;
  pg_id: string;
  shop_id: string;
  start_date: string;
  end_date: string;
  profiles: { full_name: string };
  shops: { shop_name: string };
}

interface Profile {
  id: string;
  full_name: string;
}

interface Shop {
  shop_id: string;
  shop_name: string;
}

export default function Schedules() {
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Schedule>>({});
  const [isAdding, setIsAdding] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPgFilter, setSelectedPgFilter] = useState('');
  const [selectedShopFilter, setSelectedShopFilter] = useState('');

  // 1. Fetch Data
  const { data: schedules = [], isLoading: loadingSchedules } = useQuery({
    queryKey: ['schedules'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('schedules')
        .select('*, profiles(full_name), shops(shop_name)')
        .order('start_date', { ascending: false });
      if (error) throw error;
      return data as Schedule[];
    }
  });

  const { data: profiles = [], isLoading: loadingProfiles } = useQuery({
    queryKey: ['profiles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('admin_role', false)
        .order('full_name');
      if (error) throw error;
      return data as Profile[];
    }
  });

  const { data: shops = [], isLoading: loadingShops } = useQuery({
    queryKey: ['shops'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shops')
        .select('shop_id, shop_name')
        .order('shop_name');
      if (error) throw error;
      return data as Shop[];
    }
  });

  // 3. Realtime Sync
  useRealtimeSync({
    table: 'schedules',
    queryKey: ['schedules'],
    idColumn: 'schedule_id',
    selectQuery: '*, profiles(full_name), shops(shop_name)'
  });

  const filteredSchedules = useMemo(() => {
    return schedules.filter(s => {
      const matchesSearch = (s.profiles?.full_name || '').toLowerCase().includes(searchQuery.toLowerCase()) || 
                           (s.shops?.shop_name || '').toLowerCase().includes(searchQuery.toLowerCase());
      const matchesPg = selectedPgFilter === '' || s.pg_id === selectedPgFilter;
      const matchesShop = selectedShopFilter === '' || s.shop_id === selectedShopFilter;
      return matchesSearch && matchesPg && matchesShop;
    });
  }, [schedules, searchQuery, selectedPgFilter, selectedShopFilter]);

  // 2. Mutations
  const saveMutation = useMutation({
    mutationFn: async ({ payload }: { payload: any; isKeepOpen: boolean }) => {
      if (isAdding) {
        const { data, error } = await supabase
          .from('schedules')
          .insert([payload])
          .select('*, profiles(full_name), shops(shop_name)')
          .single();
        if (error) throw error;
        return data as Schedule;
      } else {
        const { data, error } = await supabase
          .from('schedules')
          .update(payload)
          .eq('schedule_id', editForm.schedule_id)
          .select('*, profiles(full_name), shops(shop_name)')
          .single();
        if (error) throw error;
        return data as Schedule;
      }
    },
    onSuccess: (data, variables) => {
      if (isAdding) {
        queryClient.setQueryData(['schedules'], (old: Schedule[] = []) => {
          const exists = old.some(s => s.schedule_id === data.schedule_id);
          if (exists) return old;
          return [data, ...old].sort((a, b) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime());
        });
      } else {
        queryClient.setQueryData(['schedules'], (old: Schedule[] = []) => {
          return old.map(s => s.schedule_id === data.schedule_id ? data : s).sort((a, b) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime());
        });
      }

      toast.success(isAdding ? 'Thêm lịch bán hàng thành công!' : 'Cập nhật lịch bán hàng thành công!');
      
      if (variables.isKeepOpen && isAdding) {
        setEditForm(prev => ({
          ...prev,
          shop_id: ''
        }));
      } else {
        setIsModalOpen(false);
      }
    },
    onError: (error: any) => {
      console.error('Lỗi khi lưu lịch:', error);
      toast.error(`Không thể lưu: ${error.message}`);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('schedules').delete().eq('schedule_id', id);
      if (error) throw error;
      return id;
    },
    onSuccess: (id) => {
      queryClient.setQueryData(['schedules'], (old: Schedule[] = []) => {
        return old.filter(s => s.schedule_id !== id);
      });
      toast.success('Đã xóa lịch bán hàng!');
    },
    onError: (error: any) => {
      console.error('Error deleting schedule:', error);
      toast.error(`Lỗi khi xóa: ${error.message}`);
    }
  });

  const handleAdd = () => {
    setIsAdding(true);
    setEditForm({});
    setIsModalOpen(true);
  };

  const handleEdit = (schedule: Schedule) => {
    setIsAdding(false);
    setEditForm(schedule);
    setIsModalOpen(true);
  };

  const handleSave = (isKeepOpen = false) => {
    const payload = {
      pg_id: editForm.pg_id,
      shop_id: editForm.shop_id,
      start_date: editForm.start_date,
      end_date: editForm.end_date
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

  if (loadingSchedules || loadingProfiles || loadingShops) return <div className="p-8 text-center text-indigo-600 font-semibold animate-pulse">Đang tải lịch bán hàng...</div>;

  return (
    <div className="space-y-6">
      <div className="sm:flex sm:items-center sm:justify-between">
        <h2 className="text-2xl font-bold text-gray-900">Lịch bán hàng</h2>
        <button
          onClick={handleAdd}
          className="mt-3 sm:mt-0 inline-flex items-center justify-center rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 sm:w-auto"
        >
          <Plus className="-ml-1 mr-2 h-5 w-5" />
          Thêm Lịch
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 bg-white p-4 rounded-lg shadow-sm border border-gray-200">
        <div className="flex-1">
          <label className="block text-sm font-medium text-gray-700 mb-1">Tìm kiếm lịch</label>
          <input
            type="text"
            placeholder="Nhập tên PG hoặc cửa hàng..."
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
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
          <label className="block text-sm font-medium text-gray-700 mb-1">Lọc theo Cửa hàng</label>
          <select
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2 bg-white"
            value={selectedShopFilter}
            onChange={(e) => setSelectedShopFilter(e.target.value)}
          >
            <option value="">Tất cả Cửa hàng</option>
            {shops.map(s => <option key={s.shop_id} value={s.shop_id}>{s.shop_name}</option>)}
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
                    <th className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 sm:pl-6">Nhân viên PG</th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Cửa hàng</th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Ngày bắt đầu</th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Ngày kết thúc</th>
                    <th className="relative py-3.5 pl-3 pr-4 sm:pr-6"><span className="sr-only">Thao tác</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {filteredSchedules.map((schedule) => (
                    <tr key={schedule.schedule_id}>
                      <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-900 sm:pl-6">{schedule.profiles?.full_name}</td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{schedule.shops?.shop_name}</td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{safeFormatDate(schedule.start_date, 'dd/MM/yyyy')}</td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{safeFormatDate(schedule.end_date, 'dd/MM/yyyy')}</td>
                      <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                        <button onClick={() => handleEdit(schedule)} className="text-indigo-600 hover:text-indigo-900 mr-4"><Edit2 className="h-4 w-4" /></button>
                        <button onClick={() => handleDelete(schedule.schedule_id)} className="text-red-600 hover:text-red-900"><Trash2 className="h-4 w-4" /></button>
                      </td>
                    </tr>
                  ))}
                  {filteredSchedules.length === 0 && (
                    <tr><td colSpan={5} className="px-6 py-8 text-center text-gray-500">Không tìm thấy lịch bán hàng nào.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={isAdding ? 'Thêm Lịch bán hàng' : 'Sửa Lịch bán hàng'}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Nhân viên PG</label>
            <select className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" value={editForm.pg_id || ''} onChange={e => setEditForm({...editForm, pg_id: e.target.value})}>
              <option value="">Chọn PG</option>
              {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Cửa hàng</label>
            <select className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" value={editForm.shop_id || ''} onChange={e => setEditForm({...editForm, shop_id: e.target.value})}>
              <option value="">Chọn Cửa hàng</option>
              {shops.map(s => <option key={s.shop_id} value={s.shop_id}>{s.shop_name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Ngày bắt đầu</label>
            <input type="date" className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" value={editForm.start_date || ''} onChange={e => setEditForm({...editForm, start_date: e.target.value})} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Ngày kết thúc</label>
            <input type="date" className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" value={editForm.end_date || ''} onChange={e => setEditForm({...editForm, end_date: e.target.value})} />
          </div>
          <div className="flex justify-end space-x-3 mt-6">
            <button onClick={() => setIsModalOpen(false)} disabled={saveMutation.isPending} className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">Hủy</button>
            {isAdding && (
              <button onClick={() => handleSave(true)} disabled={saveMutation.isPending} className="rounded-md border border-transparent bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50">
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
        title="Xóa Lịch bán hàng"
        message="Bạn có chắc chắn muốn xóa lịch này không? Hành động này không thể hoàn tác."
      />
    </div>
  );
}
