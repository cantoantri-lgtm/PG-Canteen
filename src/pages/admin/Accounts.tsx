import React, { useState, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { Plus, Edit2, Trash2 } from 'lucide-react';
import Modal from '../../components/Modal';
import ConfirmModal from '../../components/ConfirmModal';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useRealtimeSync } from '../../hooks/useRealtimeSync';

interface Account {
  account_id: string;
  account_code: string;
  account_name: string;
  channel_id: string;
  channels?: { channel_name: string };
}

export default function Accounts() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Account>>({});
  const [isAdding, setIsAdding] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedChannelFilter, setSelectedChannelFilter] = useState('');

  const { data: channels = [] } = useQuery({
    queryKey: ['channels'],
    queryFn: async () => {
      const { data, error } = await supabase.from('channels').select('*').order('channel_name');
      if (error) throw error;
      return data;
    }
  });

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('accounts').select('*, channels(channel_name)').order('account_name');
      if (error) throw error;
      return data as Account[];
    }
  });

  const accountSyncConfig = useMemo(() => ({
    table: 'accounts',
    queryKey: ['accounts'],
    idColumn: 'account_id'
  }), []);

  useRealtimeSync(accountSyncConfig);

  const filteredAccounts = useMemo(() => {
    return accounts.filter(a => {
      const matchesSearch = a.account_name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                           a.account_code.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesChannel = selectedChannelFilter === '' || a.channel_id === selectedChannelFilter;
      return matchesSearch && matchesChannel;
    });
  }, [accounts, searchQuery, selectedChannelFilter]);

  const saveMutation = useMutation({
    mutationFn: async ({ payload }: { payload: any; isKeepOpen: boolean }) => {
      if (isAdding) {
        const { error } = await supabase.from('accounts').insert([payload]);
        if (error) throw error;
        return payload;
      } else {
        const { error } = await supabase.from('accounts').update(payload).eq('account_id', editForm.account_id);
        if (error) throw error;
        return payload;
      }
    },
    onSuccess: (_, variables) => {
      toast.success(isAdding ? 'Thêm account thành công!' : 'Cập nhật account thành công!');
      if (variables.isKeepOpen && isAdding) {
        setEditForm({ account_code: '', account_name: '', channel_id: '' });
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
      const { error } = await supabase.from('accounts').delete().eq('account_id', id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => {
      toast.success('Đã xóa account!');
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

  const handleEdit = (account: Account) => {
    setIsAdding(false);
    setEditForm(account);
    setIsModalOpen(true);
  };

  const handleSave = (isKeepOpen = false) => {
    if (!editForm.account_code?.trim() || !editForm.account_name?.trim() || !editForm.channel_id) {
      toast.error("Vui lòng nhập đầy đủ Mã Account, Tên Account và chọn Channel.");
      return;
    }

    const payload = {
      account_code: editForm.account_code.trim(),
      account_name: editForm.account_name.trim(),
      channel_id: editForm.channel_id
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

  if (isLoading) return <div className="p-8 text-center text-indigo-600 font-semibold animate-pulse">Đang tải danh sách account...</div>;

  return (
    <div className="space-y-6">
      <div className="sm:flex sm:items-center sm:justify-between">
        <h2 className="text-2xl font-bold text-gray-900">Accounts</h2>
        <button
          onClick={handleAdd}
          className="mt-3 sm:mt-0 inline-flex items-center justify-center rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 sm:w-auto"
        >
          <Plus className="-ml-1 mr-2 h-5 w-5" />
          Thêm Account
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 bg-white p-4 rounded-lg shadow-sm border border-gray-200">
        <div className="flex-1">
          <label className="block text-sm font-medium text-gray-700 mb-1">Tìm kiếm account</label>
          <input
            type="text"
            placeholder="Nhập tên hoặc mã account..."
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="w-full sm:w-64">
          <label className="block text-sm font-medium text-gray-700 mb-1">Lọc theo Channel</label>
          <select
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2 bg-white"
            value={selectedChannelFilter}
            onChange={(e) => setSelectedChannelFilter(e.target.value)}
          >
            <option value="">Tất cả Channel</option>
            {channels.map((ch: any) => <option key={ch.channel_id} value={ch.channel_id}>{ch.channel_name}</option>)}
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
                    <th className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 sm:pl-6">Mã Account</th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Tên Account</th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Channel</th>
                    <th className="relative py-3.5 pl-3 pr-4 sm:pr-6"><span className="sr-only">Thao tác</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {filteredAccounts.map((account) => (
                    <tr key={account.account_id}>
                      <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-900 sm:pl-6">{account.account_code}</td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{account.account_name}</td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{account.channels?.channel_name}</td>
                      <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                        <button onClick={() => handleEdit(account)} className="text-indigo-600 hover:text-indigo-900 mr-4"><Edit2 className="h-4 w-4" /></button>
                        <button onClick={() => handleDelete(account.account_id)} className="text-red-600 hover:text-red-900"><Trash2 className="h-4 w-4" /></button>
                      </td>
                    </tr>
                  ))}
                  {filteredAccounts.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-center">
                        Không tìm thấy account nào.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={isAdding ? 'Thêm Account' : 'Sửa Account'}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Mã Account</label>
            <input 
              type="text" 
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" 
              value={editForm.account_code || ''} 
              onChange={e => setEditForm({...editForm, account_code: e.target.value})} 
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Tên Account</label>
            <input 
              type="text" 
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" 
              value={editForm.account_name || ''} 
              onChange={e => setEditForm({...editForm, account_name: e.target.value})} 
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Channel</label>
            <select
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
              value={editForm.channel_id || ''}
              onChange={e => setEditForm({...editForm, channel_id: e.target.value})}
            >
              <option value="">Chọn Channel</option>
              {channels.map((ch: any) => (
                <option key={ch.channel_id} value={ch.channel_id}>{ch.channel_name}</option>
              ))}
            </select>
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
        title="Xóa Account"
        message="Bạn có chắc chắn muốn xóa account này không? Hành động này không thể hoàn tác."
      />
    </div>
  );
}
