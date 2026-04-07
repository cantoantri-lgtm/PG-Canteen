import React, { useState, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { Plus, Edit2, Trash2, ChevronDown, ChevronUp, MapPin, Calendar, User, LayoutTemplate } from 'lucide-react';
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
  program_id: string;
  start_date: string;
  end_date: string;
  profiles: { full_name: string };
  shops: { shop_name: string };
  programs?: { program_name: string };
}

interface Profile { id: string; full_name: string; }
interface Shop { shop_id: string; shop_name: string; }
interface Program { program_id: string; program_name: string; }

export default function Schedules() {
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Schedule>>({});
  const [isAdding, setIsAdding] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPgFilter, setSelectedPgFilter] = useState('');
  const [selectedShopFilter, setSelectedShopFilter] = useState('');
  
  const [expandedGroups, setExpandedGroups] = useState<string[]>([]);

  // 1. FETCH DATA
  const { data: schedules = [], isLoading: loadingSchedules } = useQuery({
    queryKey: ['schedules'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('schedules')
        .select('*, profiles(full_name), shops(shop_name), programs(program_name)')
        .order('start_date', { ascending: false });
      if (error) throw error;
      return data as Schedule[];
    }
  });

  const { data: profiles = [] } = useQuery({
    queryKey: ['profiles'],
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('id, full_name').eq('admin_role', false).order('full_name');
      return (data || []) as Profile[];
    }
  });

  const { data: shops = [] } = useQuery({
    queryKey: ['shops'],
    queryFn: async () => {
      const { data } = await supabase.from('shops').select('shop_id, shop_name').order('shop_name');
      return (data || []) as Shop[];
    }
  });

  const { data: programs = [] } = useQuery({
    queryKey: ['programs'],
    queryFn: async () => {
      const { data } = await supabase.from('programs').select('program_id, program_name').order('start_date', { ascending: false });
      return (data || []) as Program[];
    }
  });

  // 2. ĐỒNG BỘ REALTIME
  useRealtimeSync({
    table: 'schedules',
    queryKey: ['schedules'],
    idColumn: 'schedule_id',
    selectQuery: '*, profiles(full_name), shops(shop_name), programs(program_name)'
  });

  // 3. GOM NHÓM DỮ LIỆU
  const groupedSchedules = useMemo(() => {
    const filtered = schedules.filter(s => {
      const matchesSearch = (s.profiles?.full_name || '').toLowerCase().includes(searchQuery.toLowerCase()) || 
                            (s.shops?.shop_name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                            (s.programs?.program_name || '').toLowerCase().includes(searchQuery.toLowerCase());
      const matchesPg = selectedPgFilter === '' || s.pg_id === selectedPgFilter;
      const matchesShop = selectedShopFilter === '' || s.shop_id === selectedShopFilter;
      return matchesSearch && matchesPg && matchesShop;
    });

    const groups: Record<string, { program_name: string, schedules: Schedule[], minDate: string, maxDate: string }> = {};
    
    filtered.forEach(s => {
      const pName = s.programs?.program_name || 'Chưa gán chương trình';
      if (!groups[pName]) {
        groups[pName] = { program_name: pName, schedules: [], minDate: s.start_date, maxDate: s.end_date };
      }
      groups[pName].schedules.push(s);
      
      if (s.start_date < groups[pName].minDate) groups[pName].minDate = s.start_date;
      if (s.end_date > groups[pName].maxDate) groups[pName].maxDate = s.end_date;
    });

    return Object.values(groups);
  }, [schedules, searchQuery, selectedPgFilter, selectedShopFilter]);

  // 4. CÁC HÀM XỬ LÝ (MUTATIONS)
  const saveMutation = useMutation({
    mutationFn: async ({ payload }: { payload: any; isKeepOpen: boolean }) => {
      if (isAdding) {
        const { data, error } = await supabase.from('schedules').insert([payload]).select('*, profiles(full_name), shops(shop_name), programs(program_name)').single();
        if (error) throw error; return data as Schedule;
      } else {
        const { data, error } = await supabase.from('schedules').update(payload).eq('schedule_id', editForm.schedule_id).select('*, profiles(full_name), shops(shop_name), programs(program_name)').single();
        if (error) throw error; return data as Schedule;
      }
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
      toast.success(isAdding ? 'Thêm lịch thành công!' : 'Cập nhật lịch thành công!');
      if (variables.isKeepOpen && isAdding) {
        setEditForm(prev => ({ ...prev, shop_id: '' }));
      } else {
        setIsModalOpen(false);
      }
    },
    onError: (error: any) => toast.error(`Lỗi: ${error.message}`)
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('schedules').delete().eq('schedule_id', id);
      if (error) throw error; return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
      toast.success('Đã xóa lịch bán hàng!');
    }
  });

  const handleSave = (isKeepOpen = false) => {
    saveMutation.mutate({ 
      payload: { 
        pg_id: editForm.pg_id, shop_id: editForm.shop_id, 
        program_id: editForm.program_id, start_date: editForm.start_date, end_date: editForm.end_date 
      }, 
      isKeepOpen 
    });
  };

  const toggleGroup = (programName: string) => {
    setExpandedGroups(prev => prev.includes(programName) ? prev.filter(g => g !== programName) : [...prev, programName]);
  };

  const renderStatus = (minDate: string, maxDate: string) => {
    const today = new Date().toISOString().split('T')[0];
    if (today < minDate) return <span className="px-3 py-1 bg-blue-50 text-blue-700 text-xs font-semibold rounded-full border border-blue-100">Sắp diễn ra</span>;
    if (today > maxDate) return <span className="px-3 py-1 bg-gray-100 text-gray-600 text-xs font-semibold rounded-full border border-gray-200">Đã kết thúc</span>;
    return <span className="px-3 py-1 bg-green-50 text-green-700 text-xs font-semibold rounded-full border border-green-100">Đang diễn ra</span>;
  };

  if (loadingSchedules) return <div className="p-8 text-center text-indigo-600 font-semibold animate-pulse">Đang tải dữ liệu...</div>;

  return (
    <div className="space-y-6 pb-10">
      <div className="sm:flex sm:items-center sm:justify-between bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <LayoutTemplate className="h-6 w-6 text-indigo-600" />
            Lịch chạy Chương trình
          </h2>
          <p className="text-sm text-gray-500 mt-1">Quản lý lịch phân công PG theo từng chiến dịch</p>
        </div>
        <button
          onClick={() => { setIsAdding(true); setEditForm({}); setIsModalOpen(true); }}
          className="mt-3 sm:mt-0 inline-flex items-center justify-center rounded-xl border border-transparent bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white shadow-md shadow-indigo-200 hover:bg-indigo-700 transition-all active:scale-95"
        >
          <Plus className="-ml-1 mr-2 h-5 w-5" /> Thêm Lịch mới
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 bg-white p-4 rounded-xl shadow-sm border border-gray-100">
        <div className="flex-1 relative">
          <input
            type="text" placeholder="🔍 Tìm tên chương trình, PG, cửa hàng..."
            className="block w-full rounded-lg border-gray-200 bg-gray-50 p-2.5 text-sm focus:border-indigo-500 focus:ring-indigo-500 focus:bg-white transition-colors"
            value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <select className="w-full sm:w-48 rounded-lg border-gray-200 bg-gray-50 p-2.5 text-sm focus:border-indigo-500" value={selectedPgFilter} onChange={(e) => setSelectedPgFilter(e.target.value)}>
          <option value="">Tất cả PG</option>
          {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
        </select>
        <select className="w-full sm:w-48 rounded-lg border-gray-200 bg-gray-50 p-2.5 text-sm focus:border-indigo-500" value={selectedShopFilter} onChange={(e) => setSelectedShopFilter(e.target.value)}>
          <option value="">Tất cả Cửa hàng</option>
          {shops.map(s => <option key={s.shop_id} value={s.shop_id}>{s.shop_name}</option>)}
        </select>
      </div>

      <div className="space-y-4">
        {groupedSchedules.length === 0 ? (
          <div className="text-center py-10 bg-white rounded-2xl border border-dashed border-gray-300">
            <p className="text-gray-500">Chưa có lịch phân công nào phù hợp.</p>
          </div>
        ) : (
          groupedSchedules.map((group, index) => {
            const isExpanded = expandedGroups.includes(group.program_name);
            
            return (
              <div key={index} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden transition-all duration-200">
                <div onClick={() => toggleGroup(group.program_name)} className="p-5 flex flex-col sm:flex-row sm:items-center justify-between cursor-pointer hover:bg-gray-50/50 group">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600 font-bold">
                      {group.program_name.charAt(0)}
                    </div>
                    <div>
                      <h3 className="font-bold text-gray-900 text-lg group-hover:text-indigo-600 transition-colors">{group.program_name}</h3>
                      <div className="flex items-center gap-3 text-xs text-gray-500 mt-1">
                        <span className="flex items-center gap-1"><Calendar className="w-3 h-3"/> {safeFormatDate(group.minDate, 'dd/MM')} - {safeFormatDate(group.maxDate, 'dd/MM/yyyy')}</span>
                        <span>•</span>
                        <span className="font-medium text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">{group.schedules.length} ca làm việc</span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between sm:justify-end gap-6 mt-4 sm:mt-0">
                    {renderStatus(group.minDate, group.maxDate)}
                    <button className="text-gray-400 p-1.5 rounded-lg hover:bg-gray-100">
                      {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="p-5 bg-gray-50 border-t border-gray-100">
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Chi tiết phân bổ</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {group.schedules.map(schedule => (
                        <div key={schedule.schedule_id} className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm hover:border-indigo-300 transition-colors flex flex-col justify-between">
                          {/* Thông tin thẻ */}
                          <div>
                            <div className="flex items-center gap-2 mb-3">
                              <User className="w-4 h-4 text-indigo-500" />
                              <span className="font-bold text-gray-900 text-sm">{schedule.profiles?.full_name}</span>
                            </div>
                            <div className="space-y-2 text-sm text-gray-600">
                              <div className="flex items-start gap-2">
                                <MapPin className="w-4 h-4 text-orange-500 shrink-0 mt-0.5" />
                                <span className="line-clamp-2">{schedule.shops?.shop_name}</span>
                              </div>
                              <div className="flex items-center gap-2 bg-gray-50 w-fit px-2 py-1 rounded text-xs">
                                <Calendar className="w-3.5 h-3.5 text-gray-400" />
                                {safeFormatDate(schedule.start_date, 'dd/MM')} ➔ {safeFormatDate(schedule.end_date, 'dd/MM')}
                              </div>
                            </div>
                          </div>
                          
                          {/* NÚT THAO TÁC RÕ RÀNG */}
                          <div className="mt-4 pt-3 border-t border-gray-100 flex justify-end gap-2">
                            <button 
                              onClick={() => { setIsAdding(false); setEditForm(schedule); setIsModalOpen(true); }} 
                              className="flex items-center gap-1 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors"
                            >
                              <Edit2 className="w-3.5 h-3.5"/> Sửa
                            </button>
                            <button 
                              onClick={() => setDeleteId(schedule.schedule_id)} 
                              className="flex items-center gap-1 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-lg transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5"/> Xóa
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* MODAL THÊM/SỬA */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={isAdding ? 'Phân bổ Lịch làm việc' : 'Sửa Lịch làm việc'}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">Chương trình / Chiến dịch</label>
            <select className="w-full rounded-xl border-gray-300 bg-gray-50 focus:border-indigo-500 focus:bg-white p-2.5 text-sm" 
              value={editForm.program_id || ''} onChange={e => setEditForm({...editForm, program_id: e.target.value})}>
              <option value="">-- Chọn Chương trình --</option>
              {programs.map(p => <option key={p.program_id} value={p.program_id}>{p.program_name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Nhân viên PG</label>
              <select className="w-full rounded-xl border-gray-300 bg-gray-50 focus:border-indigo-500 focus:bg-white p-2.5 text-sm" 
                value={editForm.pg_id || ''} onChange={e => setEditForm({...editForm, pg_id: e.target.value})}>
                <option value="">Chọn PG</option>
                {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Cửa hàng</label>
              <select className="w-full rounded-xl border-gray-300 bg-gray-50 focus:border-indigo-500 focus:bg-white p-2.5 text-sm" 
                value={editForm.shop_id || ''} onChange={e => setEditForm({...editForm, shop_id: e.target.value})}>
                <option value="">Chọn Cửa hàng</option>
                {shops.map(s => <option key={s.shop_id} value={s.shop_id}>{s.shop_name}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Từ ngày</label>
              <input type="date" className="w-full rounded-xl border-gray-300 bg-gray-50 p-2.5 text-sm" 
                value={editForm.start_date || ''} onChange={e => setEditForm({...editForm, start_date: e.target.value})} />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Đến ngày</label>
              <input type="date" className="w-full rounded-xl border-gray-300 bg-gray-50 p-2.5 text-sm" 
                value={editForm.end_date || ''} onChange={e => setEditForm({...editForm, end_date: e.target.value})} />
            </div>
          </div>

          <div className="flex justify-end space-x-3 mt-8 pt-4 border-t border-gray-100">
            <button onClick={() => setIsModalOpen(false)} disabled={saveMutation.isPending} className="rounded-xl px-5 py-2.5 text-sm font-bold text-gray-600 hover:bg-gray-100">Đóng</button>
            {isAdding && (
              <button onClick={() => handleSave(true)} disabled={saveMutation.isPending} className="rounded-xl bg-blue-50 text-blue-700 px-5 py-2.5 text-sm font-bold hover:bg-blue-100">
                Lưu & Thêm tiếp
              </button>
            )}
            <button onClick={() => handleSave(false)} disabled={saveMutation.isPending} className="rounded-xl bg-indigo-600 text-white px-6 py-2.5 text-sm font-bold hover:bg-indigo-700 shadow-md">
              {saveMutation.isPending ? 'Đang lưu...' : 'Hoàn tất'}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmModal isOpen={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={() => { if(deleteId) deleteMutation.mutate(deleteId); setDeleteId(null); }}
        title="Xóa Lịch làm việc" message="Bạn có chắc chắn muốn xóa lịch này không? PG sẽ không còn thấy cửa hàng này trong danh sách của họ." />
    </div>
  );
}