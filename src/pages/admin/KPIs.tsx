import React, { useState, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { Plus, Edit2, Trash2 } from 'lucide-react';
import { safeFormatDate } from '../../lib/utils';
import Modal from '../../components/Modal';
import ConfirmModal from '../../components/ConfirmModal';
import Pagination from '../../components/Pagination';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useRealtimeSync } from '../../hooks/useRealtimeSync';
import { useAuth } from '../../lib/AuthContext';

interface KPI {
  kpi_id: string;
  pg_id: string;
  start_date: string;
  end_date: string;
  sale_target: number;
  profiles: { full_name: string };
}

interface Profile {
  id: string;
  full_name: string;
}

export default function KPIs() {
  const { user } = useAuth();
  const isAdmin = user?.admin_role === true || 
                  user?.role_id === 'admin' || 
                  user?.role_name?.toUpperCase() === 'ADMIN' || 
                  user?.email?.toLowerCase() === 'can.toantri@gmail.com';
  const isSup = user?.role_name?.toUpperCase() === 'SUP' || user?.role_id === 'SUP';

  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editForm, setEditForm] = useState<Partial<KPI>>({});
  const [isAdding, setIsAdding] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPgFilter, setSelectedPgFilter] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

  // 1. Fetch Data
  const { data: kpis = [], isLoading: loadingKpis } = useQuery({
    queryKey: ['kpis', user?.id, isSup],
    queryFn: async () => {
      let query = supabase
        .from('kpis')
        .select('*, profiles(full_name, manager_id)')
        .order('start_date', { ascending: false });
      
      if (isSup && user?.id) {
        query = query.eq('profiles.manager_id', user.id);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as KPI[];
    }
  });

  const { data: profiles = [], isLoading: loadingProfiles } = useQuery({
    queryKey: ['profiles', user?.id, isSup],
    queryFn: async () => {
      let query = supabase
        .from('profiles')
        .select('id, full_name')
        .eq('admin_role', false);
      
      if (isSup && user?.id) {
        query = query.eq('manager_id', user.id);
      }

      const { data, error } = await query.order('full_name');
      if (error) throw error;
      return data as Profile[];
    }
  });

  // 3. Realtime Sync
  useRealtimeSync({
    table: 'kpis',
    queryKey: ['kpis'],
    idColumn: 'kpi_id',
    selectQuery: '*, profiles(full_name)'
  });

  const filteredKpis = useMemo(() => {
    return kpis.filter(k => {
      const matchesSearch = (k.profiles?.full_name || '').toLowerCase().includes(searchQuery.toLowerCase());
      const matchesPg = selectedPgFilter === '' || k.pg_id === selectedPgFilter;
      return matchesSearch && matchesPg;
    });
  }, [kpis, searchQuery, selectedPgFilter]);

  const totalPages = Math.ceil(filteredKpis.length / itemsPerPage);
  const paginatedKpis = filteredKpis.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  React.useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedPgFilter]);

  // 2. Mutations
  const saveMutation = useMutation({
    mutationFn: async ({ payload }: { payload: any; isKeepOpen: boolean }) => {
      if (isAdding) {
        const { data, error } = await supabase
          .from('kpis')
          .insert([payload])
          .select('*, profiles(full_name)')
          .single();
        if (error) throw error;
        return data as KPI;
      } else {
        const { data, error } = await supabase
          .from('kpis')
          .update(payload)
          .eq('kpi_id', editForm.kpi_id)
          .select('*, profiles(full_name)')
          .single();
        if (error) throw error;
        return data as KPI;
      }
    },
    onSuccess: (data, variables) => {
      if (isAdding) {
        queryClient.setQueryData(['kpis'], (old: KPI[] = []) => {
          const exists = old.some(k => k.kpi_id === data.kpi_id);
          if (exists) return old;
          return [data, ...old].sort((a, b) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime());
        });
      } else {
        queryClient.setQueryData(['kpis'], (old: KPI[] = []) => {
          return old.map(k => k.kpi_id === data.kpi_id ? data : k).sort((a, b) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime());
        });
      }

      toast.success(isAdding ? 'Thêm chỉ tiêu thành công!' : 'Cập nhật chỉ tiêu thành công!');
      
      if (variables.isKeepOpen && isAdding) {
        setEditForm(prev => ({
          ...prev,
          sale_target: 0
        }));
      } else {
        setIsModalOpen(false);
      }
    },
    onError: (error: any) => {
      console.error('Lỗi khi lưu KPI:', error);
      toast.error(`Không thể lưu: ${error.message}`);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('kpis').delete().eq('kpi_id', id);
      if (error) throw error;
      return id;
    },
    onSuccess: (id) => {
      queryClient.setQueryData(['kpis'], (old: KPI[] = []) => {
        return old.filter(k => k.kpi_id !== id);
      });
      toast.success('Đã xóa chỉ tiêu!');
    },
    onError: (error: any) => {
      console.error('Error deleting KPI:', error);
      toast.error(`Lỗi khi xóa: ${error.message}`);
    }
  });

  const handleAdd = () => {
    setIsAdding(true);
    setEditForm({});
    setIsModalOpen(true);
  };

  const handleEdit = (kpi: KPI) => {
    setIsAdding(false);
    setEditForm(kpi);
    setIsModalOpen(true);
  };

  const handleSave = (isKeepOpen = false) => {
    const payload = {
      pg_id: editForm.pg_id,
      start_date: editForm.start_date,
      end_date: editForm.end_date,
      sale_target: editForm.sale_target
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

  if (loadingKpis || loadingProfiles) return <div className="p-8 text-center text-indigo-600 font-semibold animate-pulse">Đang tải chỉ tiêu...</div>;

  return (
    <div className="space-y-6">
      <div className="sm:flex sm:items-center sm:justify-between">
        <h2 className="text-2xl font-bold text-gray-900">Chỉ tiêu doanh số</h2>
        <button
          onClick={handleAdd}
          className="mt-3 sm:mt-0 inline-flex items-center justify-center rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 sm:w-auto"
        >
          <Plus className="-ml-1 mr-2 h-5 w-5" />
          Thêm Chỉ tiêu
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 bg-white p-4 rounded-lg shadow-sm border border-gray-200">
        <div className="flex-1">
          <label className="block text-sm font-medium text-gray-700 mb-1">Tìm kiếm PG</label>
          <input
            type="text"
            placeholder="Nhập tên nhân viên PG..."
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="w-full sm:w-64">
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
      </div>

      <div className="mt-8 flex flex-col">
        <div className="-my-2 -mx-4 overflow-x-auto sm:-mx-6 lg:-mx-8">
          <div className="inline-block min-w-full py-2 align-middle md:px-6 lg:px-8">
            <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 md:rounded-lg">
              <table className="min-w-full divide-y divide-gray-300">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 sm:pl-6">Nhân viên PG</th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Ngày bắt đầu</th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Ngày kết thúc</th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Mục tiêu doanh số</th>
                    <th className="relative py-3.5 pl-3 pr-4 sm:pr-6"><span className="sr-only">Thao tác</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {paginatedKpis.map((kpi) => (
                    <tr key={kpi.kpi_id}>
                      <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-900 sm:pl-6">{kpi.profiles?.full_name}</td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{safeFormatDate(kpi.start_date, 'dd/MM/yyyy')}</td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{safeFormatDate(kpi.end_date, 'dd/MM/yyyy')}</td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(kpi.sale_target)}</td>
                      <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                        <button onClick={() => handleEdit(kpi)} className="text-indigo-600 hover:text-indigo-900 mr-4"><Edit2 className="h-4 w-4" /></button>
                        <button onClick={() => handleDelete(kpi.kpi_id)} className="text-red-600 hover:text-red-900"><Trash2 className="h-4 w-4" /></button>
                      </td>
                    </tr>
                  ))}
                  {paginatedKpis.length === 0 && (
                    <tr><td colSpan={5} className="px-6 py-8 text-center text-gray-500">Không tìm thấy chỉ tiêu nào.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            
            {totalPages > 1 && (
              <div className="mt-4">
                <Pagination
                  currentPage={currentPage}
                  totalPages={totalPages}
                  onPageChange={setCurrentPage}
                  totalItems={filteredKpis.length}
                  itemsPerPage={itemsPerPage}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={isAdding ? 'Thêm Chỉ tiêu' : 'Sửa Chỉ tiêu'}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Nhân viên PG</label>
            <select className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" value={editForm.pg_id || ''} onChange={e => setEditForm({...editForm, pg_id: e.target.value})}>
              <option value="">Chọn PG</option>
              {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
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
          <div>
            <label className="block text-sm font-medium text-gray-700">Mục tiêu doanh số</label>
            <input type="number" className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" value={editForm.sale_target || ''} onChange={e => setEditForm({...editForm, sale_target: Number(e.target.value)})} />
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
        title="Xóa Chỉ tiêu"
        message="Bạn có chắc chắn muốn xóa chỉ tiêu này không? Hành động này không thể hoàn tác."
      />
    </div>
  );
}
