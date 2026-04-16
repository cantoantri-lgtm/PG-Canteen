import React, { useState, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { Plus, Edit2, Trash2, ChevronDown, ChevronRight, Check } from 'lucide-react';
import Modal from '../../components/Modal';
import ConfirmModal from '../../components/ConfirmModal';
import Pagination from '../../components/Pagination';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useRealtimeSync } from '../../hooks/useRealtimeSync';
import { useAuth } from '../../lib/AuthContext';

interface Program {
  program_id: string;
  program_name: string;
  start_date: string;
  end_date: string;
  description: string;
  status: string;
  require_bill_image?: boolean;
}

export default function Programs() {
  const { user } = useAuth();
  const isAdmin = user?.admin_role === true || 
                  user?.role_id === 'admin' || 
                  user?.role_name?.toUpperCase() === 'ADMIN' || 
                  user?.email?.toLowerCase() === 'can.toantri@gmail.com';
  const isSup = user?.role_name?.toUpperCase() === 'SUP' || user?.role_id === 'SUP';

  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Program>>({});
  const [isAdding, setIsAdding] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [expandedProgramId, setExpandedProgramId] = useState<string | null>(null);
  const [selectedBrandId, setSelectedBrandId] = useState<string>('');
  const [selectedSupId, setSelectedSupId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [assignSupProgramId, setAssignSupProgramId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

  const { data: programs = [], isLoading } = useQuery({
    queryKey: ['programs', isSup, user?.id],
    queryFn: async () => {
      let query = supabase.from('programs').select('*').order('start_date', { ascending: false });
      
      if (isSup && user?.id) {
        // Get assigned program IDs first
        const { data: assigned } = await supabase
          .from('sup_programs')
          .select('program_id')
          .eq('sup_id', user.id);
        
        const assignedIds = assigned?.map(a => a.program_id) || [];
        if (assignedIds.length === 0) return [];
        
        query = query.in('program_id', assignedIds);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as Program[];
    }
  });

  const { data: brands = [] } = useQuery({
    queryKey: ['brands'],
    queryFn: async () => {
      const { data, error } = await supabase.from('brands').select('*').order('brand_name');
      if (error) throw error;
      return data;
    }
  });

  const { data: programBrands = [] } = useQuery({
    queryKey: ['program_brands', expandedProgramId],
    queryFn: async () => {
      if (!expandedProgramId) return [];
      const { data, error } = await supabase
        .from('program_brands')
        .select('*, brands(brand_name)')
        .eq('program_id', expandedProgramId);
      if (error) throw error;
      return data;
    },
    enabled: !!expandedProgramId
  });

  const { data: roles = [] } = useQuery({
    queryKey: ['roles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('roles').select('*');
      if (error) throw error;
      return data;
    },
    enabled: isAdmin
  });

  const { data: supUsers = [] } = useQuery({
    queryKey: ['sup_users'],
    queryFn: async () => {
      const supRole = roles.find((r: any) => r.role_name.toUpperCase() === 'SUP');
      if (!supRole) return [];
      const { data, error } = await supabase.from('profiles').select('*').eq('role_id', supRole.role_id);
      if (error) throw error;
      return data;
    },
    enabled: isAdmin && roles.length > 0
  });

  const { data: programSups = [] } = useQuery({
    queryKey: ['program_sups', expandedProgramId, assignSupProgramId],
    queryFn: async () => {
      const targetId = assignSupProgramId || expandedProgramId;
      if (!targetId) return [];
      const { data, error } = await supabase
        .from('sup_programs')
        .select('*')
        .eq('program_id', targetId);
      if (error) throw error;
      return data;
    },
    enabled: (!!expandedProgramId || !!assignSupProgramId) && isAdmin
  });

  const { data: supPrograms = [] } = useQuery({
    queryKey: ['sup_programs', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase.from('sup_programs').select('program_id').eq('sup_id', user.id);
      if (error) throw error;
      return data.map(sp => sp.program_id);
    },
    enabled: isSup && !!user?.id
  });

  const registerProgramMutation = useMutation({
    mutationFn: async (programId: string) => {
      if (!user?.id) throw new Error('User ID not found');
      const { error } = await supabase.from('sup_programs').insert({
        sup_id: user.id,
        program_id: programId
      });
      if (error) throw error;
      return programId;
    },
    onSuccess: () => {
      toast.success('Đăng ký chương trình thành công!');
      queryClient.invalidateQueries({ queryKey: ['sup_programs', user?.id] });
    },
    onError: (error: any) => {
      toast.error(`Lỗi: ${error.message}`);
    }
  });

  const programSyncConfig = useMemo(() => ({
    table: 'programs',
    queryKey: ['programs'],
    idColumn: 'program_id'
  }), []);

  useRealtimeSync(programSyncConfig);

  const filteredPrograms = useMemo(() => {
    return programs.filter(p => 
      p.program_name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [programs, searchQuery]);

  const totalPages = Math.ceil(filteredPrograms.length / itemsPerPage);
  const paginatedPrograms = filteredPrograms.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  React.useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  const saveMutation = useMutation({
    mutationFn: async ({ payload }: { payload: any; isKeepOpen: boolean }) => {
      if (isAdding) {
        const { error } = await supabase.from('programs').insert([payload]);
        if (error) throw error;
        return payload;
      } else {
        const { error } = await supabase.from('programs').update(payload).eq('program_id', editForm.program_id);
        if (error) throw error;
        return payload;
      }
    },
    onSuccess: (_, variables) => {
      toast.success(isAdding ? 'Thêm program thành công!' : 'Cập nhật program thành công!');
      if (variables.isKeepOpen && isAdding) {
        setEditForm({ program_name: '', start_date: '', end_date: '', description: '', status: 'active' });
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
      const { error } = await supabase.from('programs').delete().eq('program_id', id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => {
      toast.success('Đã xóa program!');
    },
    onError: (error: any) => {
      toast.error(`Lỗi khi xóa: ${error.message}`);
    }
  });

  const addBrandMutation = useMutation({
    mutationFn: async () => {
      if (!expandedProgramId || !selectedBrandId) return;
      const { error } = await supabase.from('program_brands').insert([{
        program_id: expandedProgramId,
        brand_id: selectedBrandId
      }]);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Đã thêm nhãn hàng vào chương trình!');
      setSelectedBrandId('');
      queryClient.invalidateQueries({ queryKey: ['program_brands', expandedProgramId] });
    },
    onError: (error: any) => {
      toast.error(`Lỗi: ${error.message}`);
    }
  });

  const removeBrandMutation = useMutation({
    mutationFn: async (brandId: string) => {
      if (!expandedProgramId) return;
      // We don't have an id column, so we delete by program_id and brand_id
      const { error } = await supabase.from('program_brands')
        .delete()
        .eq('program_id', expandedProgramId)
        .eq('brand_id', brandId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Đã xóa nhãn hàng khỏi chương trình!');
      queryClient.invalidateQueries({ queryKey: ['program_brands', expandedProgramId] });
    },
    onError: (error: any) => {
      toast.error(`Lỗi: ${error.message}`);
    }
  });

  const addAllBrandsMutation = useMutation({
    mutationFn: async () => {
      if (!expandedProgramId) return;
      const existingBrandIds = programBrands.map(pb => pb.brand_id);
      const brandsToAdd = brands.filter(b => !existingBrandIds.includes(b.brand_id));
      
      if (brandsToAdd.length === 0) return;

      const payload = brandsToAdd.map(b => ({
        program_id: expandedProgramId,
        brand_id: b.brand_id
      }));

      const { error } = await supabase.from('program_brands').insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Đã thêm tất cả nhãn hàng vào chương trình!');
      queryClient.invalidateQueries({ queryKey: ['program_brands', expandedProgramId] });
    },
    onError: (error: any) => {
      toast.error(`Lỗi: ${error.message}`);
    }
  });

  const addSupMutation = useMutation({
    mutationFn: async () => {
      const targetId = assignSupProgramId || expandedProgramId;
      if (!targetId || !selectedSupId) return;
      const { error } = await supabase.from('sup_programs').insert([{
        program_id: targetId,
        sup_id: selectedSupId
      }]);
      if (error) throw error;
      return targetId;
    },
    onSuccess: (targetId) => {
      toast.success('Đã thêm SUP vào chương trình!');
      setSelectedSupId('');
      queryClient.invalidateQueries({ queryKey: ['program_sups', expandedProgramId, assignSupProgramId] });
    },
    onError: (error: any) => {
      toast.error(`Lỗi: ${error.message}`);
    }
  });

  const removeSupMutation = useMutation({
    mutationFn: async (supId: string) => {
      const targetId = assignSupProgramId || expandedProgramId;
      if (!targetId) return;
      const { error } = await supabase.from('sup_programs')
        .delete()
        .eq('program_id', targetId)
        .eq('sup_id', supId);
      if (error) throw error;
      return targetId;
    },
    onSuccess: (targetId) => {
      toast.success('Đã xóa SUP khỏi chương trình!');
      queryClient.invalidateQueries({ queryKey: ['program_sups', expandedProgramId, assignSupProgramId] });
    },
    onError: (error: any) => {
      toast.error(`Lỗi: ${error.message}`);
    }
  });

  const handleAdd = () => {
    setIsAdding(true);
    setEditForm({ status: 'active' });
    setIsModalOpen(true);
  };

  const handleEdit = (program: Program) => {
    setIsAdding(false);
    setEditForm(program);
    setIsModalOpen(true);
  };

  const handleSave = (isKeepOpen = false) => {
    if (!editForm.program_name?.trim() || !editForm.start_date || !editForm.end_date) {
      toast.error("Vui lòng nhập đầy đủ Tên, Ngày bắt đầu và Ngày kết thúc.");
      return;
    }

    const payload = {
      program_name: editForm.program_name.trim(),
      start_date: editForm.start_date,
      end_date: editForm.end_date,
      description: editForm.description?.trim() || '',
      status: editForm.status || 'active',
      require_bill_image: editForm.require_bill_image || false
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

  if (isLoading) return <div className="p-8 text-center text-indigo-600 font-semibold animate-pulse">Đang tải danh sách program...</div>;

  return (
    <div className="space-y-6">
      <div className="sm:flex sm:items-center sm:justify-between">
        <h2 className="text-2xl font-bold text-gray-900">{isSup ? 'Đăng ký Chương trình' : 'Programs'}</h2>
        {isAdmin && (
          <button
            onClick={handleAdd}
            className="mt-3 sm:mt-0 inline-flex items-center justify-center rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 sm:w-auto"
          >
            <Plus className="-ml-1 mr-2 h-5 w-5" />
            Thêm Program
          </button>
        )}
      </div>

      <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
        <label className="block text-sm font-medium text-gray-700 mb-1">Tìm kiếm chương trình</label>
        <input
          type="text"
          placeholder="Nhập tên chương trình..."
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
                    <th className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 sm:pl-6">Tên Program</th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Từ ngày</th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Đến ngày</th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Trạng thái</th>
                    <th className="px-3 py-3.5 text-center text-sm font-semibold text-gray-900">Bắt buộc chụp Bill</th>
                    <th className="relative py-3.5 pl-3 pr-4 sm:pr-6"><span className="sr-only">Thao tác</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {paginatedPrograms.map((program) => (
                    <React.Fragment key={program.program_id}>
                      <tr className={expandedProgramId === program.program_id ? 'bg-indigo-50' : ''}>
                        <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-900 sm:pl-6">
                          <button 
                            onClick={() => setExpandedProgramId(expandedProgramId === program.program_id ? null : program.program_id)}
                            className="flex items-center text-indigo-600 hover:text-indigo-900 focus:outline-none"
                          >
                            {expandedProgramId === program.program_id ? <ChevronDown className="h-4 w-4 mr-1" /> : <ChevronRight className="h-4 w-4 mr-1" />}
                            {program.program_name}
                          </button>
                        </td>
                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{program.start_date}</td>
                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{program.end_date}</td>
                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{program.status}</td>
                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500 text-center">
                          {program.require_bill_image ? (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                              Có
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                              Không
                            </span>
                          )}
                        </td>
                        <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                          {isAdmin && (
                            <>
                              <button onClick={() => setAssignSupProgramId(program.program_id)} className="text-green-600 hover:text-green-900 mr-4" title="Phân công SUP">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                  <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
                                </svg>
                              </button>
                              <button onClick={() => handleEdit(program)} className="text-indigo-600 hover:text-indigo-900 mr-4" title="Sửa"><Edit2 className="h-4 w-4" /></button>
                              <button onClick={() => handleDelete(program.program_id)} className="text-red-600 hover:text-red-900" title="Xóa"><Trash2 className="h-4 w-4" /></button>
                            </>
                          )}
                        </td>
                      </tr>
                      {expandedProgramId === program.program_id && (
                        <tr>
                          <td colSpan={6} className="px-6 py-4 bg-gray-50">
                            <div className="border border-gray-200 rounded-lg p-4 bg-white shadow-sm">
                              <h4 className="text-sm font-medium text-gray-900 mb-3">Nhãn hàng trong chương trình</h4>
                              
                              {isAdmin && (
                                <div className="flex items-center space-x-2 mb-4">
                                  <select
                                    className="block w-64 rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
                                    value={selectedBrandId}
                                    onChange={(e) => setSelectedBrandId(e.target.value)}
                                  >
                                    <option value="">-- Chọn nhãn hàng --</option>
                                    {brands.filter(b => !programBrands.some(pb => pb.brand_id === b.brand_id)).map(brand => (
                                      <option key={brand.brand_id} value={brand.brand_id}>{brand.brand_name}</option>
                                    ))}
                                  </select>
                                  <button
                                    onClick={() => addBrandMutation.mutate()}
                                    disabled={!selectedBrandId || addBrandMutation.isPending}
                                    className="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none disabled:opacity-50"
                                  >
                                    <Plus className="h-4 w-4 mr-1" /> Thêm
                                  </button>
                                  <button
                                    onClick={() => addAllBrandsMutation.mutate()}
                                    disabled={addAllBrandsMutation.isPending || brands.length === programBrands.length}
                                    className="inline-flex items-center px-3 py-2 border border-gray-300 text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none disabled:opacity-50"
                                  >
                                    Chọn tất cả
                                  </button>
                                </div>
                              )}

                              {programBrands.length > 0 ? (
                                <div className="flex flex-wrap gap-2">
                                  {programBrands.map((pb: any) => (
                                    <span key={pb.brand_id} className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800">
                                      {pb.brands?.brand_name}
                                      {isAdmin && (
                                        <button
                                          type="button"
                                          onClick={() => removeBrandMutation.mutate(pb.brand_id)}
                                          className="flex-shrink-0 ml-1.5 h-4 w-4 rounded-full inline-flex items-center justify-center text-indigo-400 hover:bg-indigo-200 hover:text-indigo-500 focus:outline-none focus:bg-indigo-500 focus:text-white"
                                        >
                                          <span className="sr-only">Xóa nhãn hàng</span>
                                          <svg className="h-2 w-2" stroke="currentColor" fill="none" viewBox="0 0 8 8">
                                            <path strokeLinecap="round" strokeWidth="1.5" d="M1 1l6 6m0-6L1 7" />
                                          </svg>
                                        </button>
                                      )}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-sm text-gray-500 italic">Chưa có nhãn hàng nào được thêm.</p>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                  {paginatedPrograms.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-center">
                        Không tìm thấy chương trình nào.
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
              totalItems={filteredPrograms.length}
              itemsPerPage={itemsPerPage}
            />
          </div>
        </div>
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={isAdding ? 'Thêm Program' : 'Sửa Program'}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Tên Program</label>
            <input 
              type="text" 
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" 
              value={editForm.program_name || ''} 
              onChange={e => setEditForm({...editForm, program_name: e.target.value})} 
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Từ ngày</label>
              <input 
                type="date" 
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" 
                value={editForm.start_date || ''} 
                onChange={e => setEditForm({...editForm, start_date: e.target.value})} 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Đến ngày</label>
              <input 
                type="date" 
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" 
                value={editForm.end_date || ''} 
                onChange={e => setEditForm({...editForm, end_date: e.target.value})} 
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Trạng thái</label>
            <select
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
              value={editForm.status || 'active'}
              onChange={e => setEditForm({...editForm, status: e.target.value})}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <div className="flex items-center">
            <input
              id="require_bill_image"
              type="checkbox"
              className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
              checked={editForm.require_bill_image || false}
              onChange={e => setEditForm({ ...editForm, require_bill_image: e.target.checked })}
            />
            <label htmlFor="require_bill_image" className="ml-2 block text-sm text-gray-900">
              Bắt buộc chụp ảnh bill
            </label>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Mô tả</label>
            <textarea 
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" 
              value={editForm.description || ''} 
              onChange={e => setEditForm({...editForm, description: e.target.value})} 
              rows={3}
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
        title="Xóa Program"
        message="Bạn có chắc chắn muốn xóa program này không? Hành động này không thể hoàn tác."
      />

      <Modal isOpen={!!assignSupProgramId} onClose={() => setAssignSupProgramId(null)} title="Phân công SUP cho Chương trình">
        <div className="space-y-4">
          <div className="flex items-center space-x-2 mb-4">
            <select
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
              value={selectedSupId}
              onChange={(e) => setSelectedSupId(e.target.value)}
            >
              <option value="">-- Chọn SUP --</option>
              {supUsers.filter((sup: any) => !programSups.some((ps: any) => ps.sup_id === sup.id)).map((sup: any) => (
                <option key={sup.id} value={sup.id}>{sup.full_name} {sup.phone_number ? `(${sup.phone_number})` : ''}</option>
              ))}
            </select>
            <button
              onClick={() => addSupMutation.mutate()}
              disabled={!selectedSupId || addSupMutation.isPending}
              className="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none disabled:opacity-50"
            >
              <Plus className="h-4 w-4 mr-1" /> Thêm
            </button>
          </div>

          <div className="mt-4">
            <h4 className="text-sm font-medium text-gray-900 mb-2">Danh sách SUP phụ trách:</h4>
            {programSups.length > 0 ? (
              <ul className="divide-y divide-gray-200 border border-gray-200 rounded-md">
                {programSups.map((ps: any) => {
                  const supUser = supUsers.find((u: any) => u.id === ps.sup_id);
                  return (
                    <li key={ps.sup_id} className="flex items-center justify-between py-3 pl-3 pr-4 text-sm">
                      <div className="flex w-0 flex-1 items-center">
                        <span className="truncate font-medium">{supUser?.full_name || 'Unknown SUP'}</span>
                        {supUser?.phone_number && <span className="ml-2 text-gray-500">({supUser.phone_number})</span>}
                      </div>
                      <div className="ml-4 flex-shrink-0">
                        <button
                          onClick={() => removeSupMutation.mutate(ps.sup_id)}
                          className="font-medium text-red-600 hover:text-red-500"
                        >
                          Xóa
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-gray-500 italic">Chưa có SUP nào được phân công.</p>
            )}
          </div>
          
          <div className="mt-6 flex justify-end">
            <button
              onClick={() => setAssignSupProgramId(null)}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Đóng
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
