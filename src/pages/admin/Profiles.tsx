import React, { useState, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { Plus, Edit2, Trash2 } from 'lucide-react';
import Modal from '../../components/Modal';
import ConfirmModal from '../../components/ConfirmModal';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useRealtimeSync } from '../../hooks/useRealtimeSync';

interface Profile {
  id: string;
  full_name: string;
  dob: string;
  phone_number: string;
  admin_role: boolean;
  email: string;
  login_pin: string;
}

export default function Profiles() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Profile>>({});
  const [isAdding, setIsAdding] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: profiles = [], isLoading: loadingProfiles } = useQuery({
    queryKey: ['profiles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('*').order('full_name');
      if (error) throw error;
      return data as Profile[];
    }
  });

  const profileSyncConfig = useMemo(() => ({
    table: 'profiles',
    queryKey: ['profiles'],
    idColumn: 'id'
  }), []);
  useRealtimeSync(profileSyncConfig);

  const saveMutation = useMutation({
    mutationFn: async (payload: Partial<Profile>) => {
      if (isAdding) {
        // Create user via RPC
        const { error: rpcError } = await supabase.rpc('create_user_by_admin', {
          p_dob: payload.dob || null,
          p_full_name: payload.full_name,
          p_login_id: payload.email || payload.phone_number,
          p_password: payload.login_pin || '123456',
          p_phone: payload.phone_number,
          p_role: payload.admin_role || false
        });
        if (rpcError) throw rpcError;

        // Update login_pin directly in profiles
        if (payload.login_pin) {
          await supabase.from('profiles').update({ login_pin: payload.login_pin }).eq('phone_number', payload.phone_number);
        }
        return payload;
      } else {
        const { id, ...updateData } = payload;
        const { error } = await supabase.from('profiles').update(updateData).eq('id', id);
        if (error) throw error;
        return payload;
      }
    },
    onSuccess: () => {
      toast.success(isAdding ? 'Thêm người dùng thành công!' : 'Cập nhật thành công!');
      setIsModalOpen(false);
    },
    onError: (error: any) => {
      toast.error(`Lỗi: ${error.message}`);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('delete_user_by_admin', { p_user_id: id });
      if (error) throw error;
      return id;
    },
    onSuccess: () => toast.success('Đã xóa người dùng!')
  });

  const handleAdd = () => {
    setIsAdding(true);
    setEditForm({ admin_role: false });
    setIsModalOpen(true);
  };

  const handleEdit = (profile: Profile) => {
    setIsAdding(false);
    setEditForm(profile);
    setIsModalOpen(true);
  };

  const handleSave = () => {
    if (!editForm.full_name || !editForm.phone_number) {
      toast.error("Vui lòng điền đầy đủ Họ tên và Số điện thoại");
      return;
    }
    saveMutation.mutate(editForm);
  };

  const confirmDelete = () => {
    if (deleteId) {
      deleteMutation.mutate(deleteId);
      setDeleteId(null);
    }
  };

  if (loadingProfiles) return <div className="p-8 text-center text-indigo-600 animate-pulse font-semibold">Đang tải người dùng...</div>;

  return (
    <div className="space-y-6">
      <div className="sm:flex sm:items-center sm:justify-between">
        <h2 className="text-2xl font-bold text-gray-900">Quản lý Người dùng</h2>
        <button onClick={handleAdd} className="mt-3 sm:mt-0 inline-flex items-center justify-center rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700">
          <Plus className="-ml-1 mr-2 h-5 w-5" />
          Thêm Người dùng
        </button>
      </div>

      <div className="mt-8 flex flex-col">
        <div className="-my-2 -mx-4 overflow-x-auto sm:-mx-6 lg:-mx-8">
          <div className="inline-block min-w-full py-2 align-middle md:px-6 lg:px-8">
            <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 md:rounded-lg">
              <table className="min-w-full divide-y divide-gray-300">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900">Họ tên</th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">SĐT</th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Email</th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Ngày sinh</th>
                    <th className="px-3 py-3.5 text-center text-sm font-semibold text-gray-900">Vai trò</th>
                    <th className="relative py-3.5 pl-3 pr-4 sm:pr-6"><span className="sr-only">Thao tác</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {profiles.map((profile) => (
                    <tr key={profile.id}>
                      <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-900">{profile.full_name}</td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{profile.phone_number}</td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{profile.email || '-'}</td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{profile.dob || '-'}</td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-center">
                        {profile.admin_role ? (
                          <span className="inline-flex items-center rounded-md bg-purple-50 px-2 py-1 text-xs font-medium text-purple-700 ring-1 ring-inset ring-purple-700/10">Admin</span>
                        ) : (
                          <span className="inline-flex items-center rounded-md bg-green-50 px-2 py-1 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-600/20">PG</span>
                        )}
                      </td>
                      <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                        <button onClick={() => handleEdit(profile)} className="text-indigo-600 hover:text-indigo-900 mr-4"><Edit2 className="h-4 w-4" /></button>
                        <button onClick={() => setDeleteId(profile.id)} className="text-red-600 hover:text-red-900"><Trash2 className="h-4 w-4" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={isAdding ? 'Thêm Người dùng' : 'Sửa Người dùng'}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Họ tên *</label>
            <input type="text" className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" value={editForm.full_name || ''} onChange={e => setEditForm({...editForm, full_name: e.target.value})} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Số điện thoại *</label>
              <input type="text" className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" value={editForm.phone_number || ''} onChange={e => setEditForm({...editForm, phone_number: e.target.value})} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Ngày sinh</label>
              <input type="date" className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" value={editForm.dob || ''} onChange={e => setEditForm({...editForm, dob: e.target.value})} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Email</label>
              <input type="email" className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" value={editForm.email || ''} onChange={e => setEditForm({...editForm, email: e.target.value})} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Mã PIN (6 số)</label>
              <input type="text" maxLength={6} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" value={editForm.login_pin || ''} onChange={e => setEditForm({...editForm, login_pin: e.target.value})} />
            </div>
          </div>
          <div className="flex items-center mt-4">
            <input id="admin_role" type="checkbox" className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" checked={editForm.admin_role || false} onChange={e => setEditForm({...editForm, admin_role: e.target.checked})} />
            <label htmlFor="admin_role" className="ml-2 block text-sm text-gray-900">Quyền Quản trị viên</label>
          </div>
          <div className="flex justify-end space-x-3 mt-6">
            <button onClick={() => setIsModalOpen(false)} disabled={saveMutation.isPending} className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Hủy</button>
            <button onClick={handleSave} disabled={saveMutation.isPending} className="rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
              {saveMutation.isPending ? 'Đang lưu...' : 'Lưu'}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmModal isOpen={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={confirmDelete} title="Xóa Người dùng" message="Bạn có chắc chắn muốn xóa người dùng này không?" />
    </div>
  );
}
