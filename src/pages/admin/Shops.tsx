import React, { useState, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { Plus, Edit2, Trash2 } from 'lucide-react';
import Modal from '../../components/Modal';
import ConfirmModal from '../../components/ConfirmModal';
import Pagination from '../../components/Pagination';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useRealtimeSync } from '../../hooks/useRealtimeSync';

interface Shop {
  shop_id: string;
  shop_name: string;
  account_id: string;
  latitude?: number;
  longitude?: number;
  allowed_distance?: number;
  accounts?: { account_name: string };
}

export default function Shops() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Shop>>({});
  const [isAdding, setIsAdding] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAccountFilter, setSelectedAccountFilter] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('accounts').select('*').order('account_name');
      if (error) throw error;
      return data;
    }
  });

  // 1. Fetch Data with React Query
  const { data: shops = [], isLoading } = useQuery({
    queryKey: ['shops'],
    queryFn: async () => {
      const { data, error } = await supabase.from('shops').select('*, accounts(account_name)').order('shop_name');
      if (error) throw error;
      return data as Shop[];
    }
  });

  // 2. Realtime Sync
  const shopSyncConfig = useMemo(() => ({
    table: 'shops',
    queryKey: ['shops'],
    idColumn: 'shop_id'
  }), []);

  useRealtimeSync(shopSyncConfig);

  const filteredShops = useMemo(() => {
    return shops.filter(s => {
      const matchesSearch = s.shop_name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesAccount = selectedAccountFilter === '' || s.account_id === selectedAccountFilter;
      return matchesSearch && matchesAccount;
    });
  }, [shops, searchQuery, selectedAccountFilter]);

  const totalPages = Math.ceil(filteredShops.length / itemsPerPage);
  const paginatedShops = filteredShops.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  React.useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedAccountFilter]);

  // 3. Mutations
  const saveMutation = useMutation({
    mutationFn: async ({ payload }: { payload: any; isKeepOpen: boolean }) => {
      if (isAdding) {
        const { error } = await supabase.from('shops').insert([payload]);
        if (error) throw error;
        return payload;
      } else {
        const { error } = await supabase.from('shops').update(payload).eq('shop_id', editForm.shop_id);
        if (error) throw error;
        return payload;
      }
    },
    onSuccess: (_, variables) => {
      toast.success(isAdding ? 'Thêm cửa hàng thành công!' : 'Cập nhật cửa hàng thành công!');
      if (variables.isKeepOpen && isAdding) {
        setEditForm({ shop_name: '', account_id: '' });
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
      const { error } = await supabase.from('shops').delete().eq('shop_id', id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => {
      toast.success('Đã xóa cửa hàng!');
    },
    onError: (error: any) => {
      toast.error(`Lỗi khi xóa: ${error.message}`);
    }
  });

  const handleAdd = () => {
    setIsAdding(true);
    setEditForm({});
    setIsModalOpen(true);
  };

  const handleEdit = (shop: Shop) => {
    setIsAdding(false);
    setEditForm(shop);
    setIsModalOpen(true);
  };

  const handleSave = (isKeepOpen = false) => {
    if (!editForm.shop_name?.trim() || !editForm.account_id) {
      toast.error("Vui lòng nhập đầy đủ Tên Cửa hàng và chọn Account.");
      return;
    }

    const payload = {
      shop_name: editForm.shop_name.trim(),
      account_id: editForm.account_id,
      latitude: editForm.latitude || null,
      longitude: editForm.longitude || null,
      allowed_distance: editForm.allowed_distance || 500
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

  if (isLoading) return <div className="p-8 text-center text-indigo-600 font-semibold animate-pulse">Đang tải danh sách cửa hàng...</div>;

  return (
    <div className="space-y-6">
      <div className="sm:flex sm:items-center sm:justify-between">
        <h2 className="text-2xl font-bold text-gray-900">Cửa hàng (Shop/Canteen)</h2>
        <button
          onClick={handleAdd}
          className="mt-3 sm:mt-0 inline-flex items-center justify-center rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 sm:w-auto"
        >
          <Plus className="-ml-1 mr-2 h-5 w-5" />
          Thêm Cửa hàng
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 bg-white p-4 rounded-lg shadow-sm border border-gray-200">
        <div className="flex-1">
          <label className="block text-sm font-medium text-gray-700 mb-1">Tìm kiếm cửa hàng</label>
          <input
            type="text"
            placeholder="Nhập tên cửa hàng..."
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="w-full sm:w-64">
          <label className="block text-sm font-medium text-gray-700 mb-1">Lọc theo Account</label>
          <select
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2 bg-white"
            value={selectedAccountFilter}
            onChange={(e) => setSelectedAccountFilter(e.target.value)}
          >
            <option value="">Tất cả Account</option>
            {accounts.map((acc: any) => <option key={acc.account_id} value={acc.account_id}>{acc.account_name}</option>)}
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
                    <th className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 sm:pl-6">Tên Cửa hàng</th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Account</th>
                    <th className="relative py-3.5 pl-3 pr-4 sm:pr-6"><span className="sr-only">Thao tác</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {paginatedShops.map((shop) => (
                    <tr key={shop.shop_id}>
                      <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-900 sm:pl-6">{shop.shop_name}</td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{shop.accounts?.account_name}</td>
                      <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                        <button onClick={() => handleEdit(shop)} className="text-indigo-600 hover:text-indigo-900 mr-4"><Edit2 className="h-4 w-4" /></button>
                        <button onClick={() => handleDelete(shop.shop_id)} className="text-red-600 hover:text-red-900"><Trash2 className="h-4 w-4" /></button>
                      </td>
                    </tr>
                  ))}
                  {paginatedShops.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-center">
                        Không tìm thấy cửa hàng nào.
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
              totalItems={filteredShops.length}
              itemsPerPage={itemsPerPage}
            />
          </div>
        </div>
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={isAdding ? 'Thêm Cửa hàng' : 'Sửa Cửa hàng'}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Tên Cửa hàng</label>
            <input 
              type="text" 
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" 
              value={editForm.shop_name || ''} 
              onChange={e => setEditForm({...editForm, shop_name: e.target.value})} 
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Account</label>
            <select
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
              value={editForm.account_id || ''}
              onChange={e => setEditForm({...editForm, account_id: e.target.value})}
            >
              <option value="">Chọn Account</option>
              {accounts.map((acc: any) => (
                <option key={acc.account_id} value={acc.account_id}>{acc.account_name}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Vĩ độ (Latitude)</label>
              <input 
                type="number" step="any"
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" 
                value={editForm.latitude || ''} 
                onChange={e => setEditForm({...editForm, latitude: parseFloat(e.target.value)})} 
                placeholder="Ví dụ: 10.762622"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Kinh độ (Longitude)</label>
              <input 
                type="number" step="any"
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" 
                value={editForm.longitude || ''} 
                onChange={e => setEditForm({...editForm, longitude: parseFloat(e.target.value)})} 
                placeholder="Ví dụ: 106.660172"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Khoảng cách cho phép (mét)</label>
            <input 
              type="number" 
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" 
              value={editForm.allowed_distance || 500} 
              onChange={e => setEditForm({...editForm, allowed_distance: parseInt(e.target.value)})} 
            />
            <p className="mt-1 text-xs text-gray-500">Khoảng cách tối đa PG có thể lưu đơn hàng so với vị trí shop.</p>
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
        title="Xóa Cửa hàng"
        message="Bạn có chắc chắn muốn xóa cửa hàng này không? Hành động này không thể hoàn tác."
      />
    </div>
  );
}