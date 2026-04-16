import React, { useState, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { Plus, Edit2, Trash2 } from 'lucide-react';
import Modal from '../../components/Modal';
import ConfirmModal from '../../components/ConfirmModal';
import Pagination from '../../components/Pagination';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useRealtimeSync } from '../../hooks/useRealtimeSync';
import { useAuth } from '../../lib/AuthContext';

interface Profile {
  id: string;
  full_name: string;
  dob: string;
  phone_number: string;
  admin_role: boolean;
  role_id?: string;
  email: string;
  login_pin: string;
  manager_id?: string;
  status?: boolean;
  created_by?: string;
  created_date?: string;
}

export default function Profiles() {
  const { user } = useAuth();
  const isAdmin = user?.admin_role === true || 
                  user?.role_id === 'admin' || 
                  user?.role_name?.toUpperCase() === 'ADMIN' || 
                  user?.email?.toLowerCase() === 'can.toantri@gmail.com';
  const isSup = user?.role_name?.toUpperCase() === 'SUP' || user?.role_id === 'SUP';

  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Profile>>({});
  const [isAdding, setIsAdding] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRoleFilter, setSelectedRoleFilter] = useState('');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

  const { data: profiles = [], isLoading: loadingProfiles } = useQuery({
    queryKey: ['profiles', user?.id, isSup],
    queryFn: async () => {
      let query = supabase.from('profiles').select('*').order('full_name');
      if (isSup && user?.id) {
        query = query.eq('manager_id', user.id);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data as Profile[];
    }
  });

  const { data: roles = [] } = useQuery({
    queryKey: ['roles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('roles').select('*').order('role_name');
      if (error) throw error;
      return data as { role_id: string, role_name: string }[];
    }
  });

  const profileSyncConfig = useMemo(() => ({
    table: 'profiles',
    queryKey: ['profiles'],
    idColumn: 'id'
  }), []);
  useRealtimeSync(profileSyncConfig);

  const filteredProfiles = useMemo(() => {
    return profiles.filter(p => {
      const matchesSearch = p.full_name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                           p.phone_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
                           (p.email || '').toLowerCase().includes(searchQuery.toLowerCase());
      const matchesRole = selectedRoleFilter === '' || p.role_id === selectedRoleFilter;
      const matchesStatus = selectedStatusFilter === 'all' || 
                            (selectedStatusFilter === 'on' && p.status !== false) || 
                            (selectedStatusFilter === 'off' && p.status === false);
      return matchesSearch && matchesRole && matchesStatus;
    }).map(p => ({
      ...p,
      manager_name: profiles.find(m => m.id === p.manager_id)?.full_name
    }));
  }, [profiles, searchQuery, selectedRoleFilter, selectedStatusFilter]);

  const totalPages = Math.ceil(filteredProfiles.length / itemsPerPage);
  const paginatedProfiles = filteredProfiles.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  // Reset to page 1 when filters change
  React.useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedRoleFilter, selectedStatusFilter]);

  const saveMutation = useMutation({
    mutationFn: async (payload: Partial<Profile>) => {
      if (isAdding) {
        // 1. Create user via RPC
        const { error: rpcError } = await supabase.rpc('create_user_by_admin', {
          p_dob: payload.dob || null,
          p_full_name: payload.full_name,
          p_login_id: payload.email || payload.phone_number,
          p_password: payload.login_pin || '123456',
          p_phone: payload.phone_number,
          p_role: payload.admin_role || false
        });
        if (rpcError) throw rpcError;

        // 2. Fetch the newly created profile to get its ID (safer than updating by phone)
        const { data: newProfile } = await supabase
          .from('profiles')
          .select('id')
          .eq('phone_number', payload.phone_number)
          .maybeSingle();

        // 3. Update additional fields
        const updateData: any = {};
        if (payload.login_pin) updateData.login_pin = payload.login_pin;
        
        // Determine role and manager
        const pgRole = roles.find(r => r.role_name.toUpperCase() === 'PG');
        
        if (isSup) {
          // Force PG role and current SUP as manager if creator is SUP
          const roleId = pgRole?.role_id || payload.role_id;
          if (roleId) {
            updateData.role_id = roleId;
          }
          updateData.manager_id = user?.id;
        } else {
          // Admin can specify
          if (payload.role_id) {
            updateData.role_id = payload.role_id;
          }
          if (payload.manager_id) updateData.manager_id = payload.manager_id;
        }

        updateData.created_by = user?.id;
        updateData.status = payload.status !== undefined ? payload.status : true;
        
        if (Object.keys(updateData).length > 0) {
          const updateQuery = newProfile?.id 
            ? supabase.from('profiles').update(updateData).eq('id', newProfile.id)
            : supabase.from('profiles').update(updateData).eq('phone_number', payload.phone_number);
          
          const { error: updateError } = await updateQuery;
          if (updateError) {
            console.error('Error updating profile:', updateError);
            throw new Error(`Lỗi cập nhật thông tin bổ sung: ${updateError.message}`);
          }
        }
        return payload;
      } else {
        const { id, manager_name, ...updateData } = payload as any;
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
      toast.success('Đã xóa người dùng!');
    },
    onError: (error: any) => {
      toast.error(`Lỗi khi xóa: ${error.message}`);
    }
  });

  const handleAdd = () => {
    setIsAdding(true);
    const isSupUser = user?.role_name?.toUpperCase() === 'SUP' || user?.role_id === 'SUP';
    const pgRole = roles.find(r => r.role_name.toUpperCase() === 'PG');
    setEditForm({ 
      admin_role: false, 
      status: true,
      role_id: isSupUser && pgRole ? pgRole.role_id : undefined,
      manager_id: isSupUser ? user?.id : undefined
    });
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
        {isAdmin && (
          <button onClick={handleAdd} className="mt-3 sm:mt-0 inline-flex items-center justify-center rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700">
            <Plus className="-ml-1 mr-2 h-5 w-5" />
            Thêm Người dùng
          </button>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-4 bg-white p-4 rounded-lg shadow-sm border border-gray-200">
        <div className="flex-1">
          <label className="block text-sm font-medium text-gray-700 mb-1">Tìm kiếm người dùng</label>
          <input
            type="text"
            placeholder="Nhập tên, SĐT hoặc email..."
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="w-full sm:w-48">
          <label className="block text-sm font-medium text-gray-700 mb-1">Tình trạng</label>
          <select
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2 bg-white"
            value={selectedStatusFilter}
            onChange={(e) => setSelectedStatusFilter(e.target.value)}
          >
            <option value="all">Tất cả</option>
            <option value="on">Đang hoạt động</option>
            <option value="off">Ngưng hoạt động</option>
          </select>
        </div>
        <div className="w-full sm:w-64">
          <label className="block text-sm font-medium text-gray-700 mb-1">Lọc theo Vai trò</label>
          <select
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2 bg-white"
            value={selectedRoleFilter}
            onChange={(e) => setSelectedRoleFilter(e.target.value)}
          >
            <option value="">Tất cả Vai trò</option>
            {roles.map(r => <option key={r.role_id} value={r.role_id}>{r.role_name}</option>)}
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
                    <th className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900">Họ tên</th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">SĐT</th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Quản lý</th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Email</th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Ngày sinh</th>
                    <th className="px-3 py-3.5 text-center text-sm font-semibold text-gray-900">Vai trò</th>
                    <th className="px-3 py-3.5 text-center text-sm font-semibold text-gray-900">Trạng thái</th>
                    <th className="relative py-3.5 pl-3 pr-4 sm:pr-6"><span className="sr-only">Thao tác</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {paginatedProfiles.map((profile) => (
                    <tr key={profile.id}>
                      <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-900">{profile.full_name}</td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{profile.phone_number}</td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-indigo-600 font-medium">{profile.manager_name || '-'}</td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{profile.email || '-'}</td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{profile.dob || '-'}</td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-center">
                        {profile.role_id ? (
                          <span className="inline-flex items-center rounded-md bg-green-50 px-2 py-1 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-600/20">
                            {roles.find(r => r.role_id === profile.role_id)?.role_name || profile.role_id}
                          </span>
                        ) : profile.admin_role ? (
                          <span className="inline-flex items-center rounded-md bg-purple-50 px-2 py-1 text-xs font-medium text-purple-700 ring-1 ring-inset ring-purple-700/10">Admin</span>
                        ) : (
                          <span className="inline-flex items-center rounded-md bg-gray-50 px-2 py-1 text-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-600/20">Chưa có</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-center">
                        {profile.status !== false ? (
                          <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-600/20">Hoạt động</span>
                        ) : (
                          <span className="inline-flex items-center rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-600/20">Ngưng</span>
                        )}
                      </td>
                      <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                        <button onClick={() => handleEdit(profile)} className="text-indigo-600 hover:text-indigo-900 mr-4"><Edit2 className="h-4 w-4" /></button>
                        <button onClick={() => setDeleteId(profile.id)} className="text-red-600 hover:text-red-900"><Trash2 className="h-4 w-4" /></button>
                      </td>
                    </tr>
                  ))}
                  {paginatedProfiles.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-center">
                        Không tìm thấy người dùng nào.
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
              totalItems={filteredProfiles.length}
              itemsPerPage={itemsPerPage}
            />
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
          {!isSup && (
            <div>
              <label className="block text-sm font-medium text-gray-700">Vai trò</label>
              <select className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2 bg-white" value={editForm.role_id || ''} onChange={e => setEditForm({...editForm, role_id: e.target.value})}>
                <option value="">-- Chọn vai trò --</option>
                {roles.map(r => <option key={r.role_id} value={r.role_id}>{r.role_name}</option>)}
              </select>
            </div>
          )}
          {!isSup && (
            <div>
              <label className="block text-sm font-medium text-gray-700">Người quản lý</label>
              <select 
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2 bg-white" 
                value={editForm.manager_id || ''} 
                onChange={e => setEditForm({...editForm, manager_id: e.target.value})}
              >
                <option value="">-- Không có quản lý --</option>
                {profiles
                  .filter(p => p.id !== editForm.id) // Không tự quản lý chính mình
                  .filter(p => {
                    const roleName = roles.find(r => r.role_id === p.role_id)?.role_name || '';
                    return p.admin_role || roleName.toUpperCase() === 'SUP' || roleName.toUpperCase() === 'ADMIN';
                  })
                  .map(p => (
                    <option key={p.id} value={p.id}>
                      {p.full_name} ({p.phone_number})
                    </option>
                  ))
                }
              </select>
            </div>
          )}
          <div className="flex items-center mt-4 justify-between">
            {!isSup && (
              <div className="flex items-center">
                <input id="admin_role" type="checkbox" className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" checked={editForm.admin_role || false} onChange={e => setEditForm({...editForm, admin_role: e.target.checked})} />
                <label htmlFor="admin_role" className="ml-2 block text-sm text-gray-900">Quyền Quản trị viên</label>
              </div>
            )}
            <div className="flex items-center">
              <label className="mr-3 text-sm font-medium text-gray-700">Trạng thái hoạt động</label>
              <button
                type="button"
                onClick={() => setEditForm({...editForm, status: editForm.status === false ? true : false})}
                className={`${
                  editForm.status !== false ? 'bg-indigo-600' : 'bg-gray-200'
                } relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2`}
              >
                <span
                  aria-hidden="true"
                  className={`${
                    editForm.status !== false ? 'translate-x-5' : 'translate-x-0'
                  } pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                />
              </button>
            </div>
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
