import React, { useState, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { Plus, Edit2, Trash2, ChevronDown, ChevronUp, Search, Filter, RefreshCw, Gift } from 'lucide-react';
import Modal from '../../components/Modal';
import ConfirmModal from '../../components/ConfirmModal';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useRealtimeSync } from '../../hooks/useRealtimeSync';

interface PromotionCondition {
  id?: string;
  tier_id?: string;
  condition_type: string;
  target_values: string | string[];
  min_target_value: number;
}

interface PromotionTierGift {
  gift_product_id: string;
  gift_quantity: number;
  product_name?: string;
}

interface PromotionTier {
  id?: string;
  promotion_id?: string;
  tier_name: string;
  tier_type: string;
  support_amount: number;
  gift_product_id?: string;
  gift_quantity?: number;
  min_total_qty: number;
  override_end_date?: string;
  conditions: PromotionCondition[];
  products?: { product_name: string };
  gifts?: PromotionTierGift[];
}

interface Promotion {
  promotion_id: string;
  program_id: string;
  promotion_name: string;
  promotion_type: string;
  mechanic_rules: any;
  channel_id: string;
  account_id: string;
  shop_id: string;
  programs?: { program_name: string, start_date?: string, end_date?: string };
  channels?: { channel_name: string };
  accounts?: { account_name: string };
  shops?: { shop_name: string };
  tiers?: PromotionTier[];
}

export default function Promotions() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Promotion>>({});
  const [isAdding, setIsAdding] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProgramFilter, setSelectedProgramFilter] = useState('');
  const [isSelectionModalOpen, setIsSelectionModalOpen] = useState(false);
  const [selectionType, setSelectionType] = useState<'Nhãn hàng' | 'Sản phẩm cụ thể'>('Nhãn hàng');
  const [activeTierIdx, setActiveTierIdx] = useState<number | null>(null);
  const [activeCondIdx, setActiveCondIdx] = useState<number | null>(null);
  const [expandedPromotionId, setExpandedPromotionId] = useState<string | null>(null);

  const { data: programs = [] } = useQuery({
    queryKey: ['programs'],
    queryFn: async () => {
      const { data, error } = await supabase.from('programs').select('*').order('program_name');
      if (error) throw error;
      return data;
    }
  });

  const { data: channels = [] } = useQuery({
    queryKey: ['channels'],
    queryFn: async () => {
      const { data, error } = await supabase.from('channels').select('*').order('channel_name');
      if (error) throw error;
      return data;
    }
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('accounts').select('*').order('account_name');
      if (error) throw error;
      return data;
    }
  });

  const { data: shops = [] } = useQuery({
    queryKey: ['shops'],
    queryFn: async () => {
      const { data, error } = await supabase.from('shops').select('*').order('shop_name');
      if (error) throw error;
      return data;
    }
  });

  const { data: brands = [] } = useQuery({
    queryKey: ['brands_list'],
    queryFn: async () => {
      const { data, error } = await supabase.from('brands').select('*').order('brand_name');
      if (error) throw error;
      return data;
    }
  });

  const { data: products = [] } = useQuery({
    queryKey: ['products_list'],
    queryFn: async () => {
      const { data, error } = await supabase.from('products').select('*, brands(brand_name)').order('product_name');
      if (error) throw error;
      return data;
    }
  });

  const { data: promotions = [], isLoading } = useQuery({
    queryKey: ['promotions'],
    queryFn: async () => {
      const { data, error } = await supabase.from('promotions').select('*, programs(program_name, start_date, end_date), channels(channel_name), accounts(account_name), shops(shop_name)').order('promotion_name');
      if (error) throw error;
      
      // Fetch tiers and conditions for each promotion
      const promotionsWithDetails = await Promise.all((data as Promotion[]).map(async (p) => {
        const { data: tiersData } = await supabase.from('promotion_tiers').select('*, products:gift_product_id(product_name)').eq('promotion_id', p.promotion_id);
        const rawTiers = await Promise.all((tiersData || []).map(async (t) => {
          const { data: conditionsData } = await supabase.from('promotion_conditions').select('*').eq('tier_id', t.id);
          return { ...t, conditions: conditionsData || [] };
        }));
        
        const groupedTiers: PromotionTier[] = [];
        const tierMap = new Map<string, PromotionTier>();
        
        for (const t of rawTiers) {
          const key = `${t.tier_name}|${t.tier_type}|${t.support_amount}|${t.min_total_qty}|${t.override_end_date}`;
          if (tierMap.has(key)) {
            const existing = tierMap.get(key)!;
            if (t.gift_product_id) {
              existing.gifts = existing.gifts || [];
              existing.gifts.push({
                gift_product_id: t.gift_product_id,
                gift_quantity: t.gift_quantity,
                product_name: t.products?.product_name
              });
            }
          } else {
            const newTier: PromotionTier = { ...t, gifts: [] };
            if (t.gift_product_id) {
              newTier.gifts!.push({
                gift_product_id: t.gift_product_id,
                gift_quantity: t.gift_quantity,
                product_name: t.products?.product_name
              });
            }
            tierMap.set(key, newTier);
            groupedTiers.push(newTier);
          }
        }
        
        return { ...p, tiers: groupedTiers };
      }));
      
      return promotionsWithDetails;
    }
  });

  const promotionSyncConfig = useMemo(() => ({
    table: 'promotions',
    queryKey: ['promotions'],
    idColumn: 'promotion_id'
  }), []);

  useRealtimeSync(promotionSyncConfig);

  const filteredPromotions = useMemo(() => {
    return promotions.filter(p => {
      const matchesSearch = p.promotion_name.toLowerCase().includes(searchQuery.toLowerCase());
      
      const now = new Date();
      const startDate = p.programs?.start_date ? new Date(p.programs.start_date) : null;
      const endDate = p.programs?.end_date ? new Date(p.programs.end_date) : null;
      
      let status = 'active';
      if (startDate && now < startDate) status = 'upcoming';
      else if (endDate && now > endDate) status = 'expired';

      const matchesStatus = selectedProgramFilter === '' || status === selectedProgramFilter;
      return matchesSearch && matchesStatus;
    });
  }, [promotions, searchQuery, selectedProgramFilter]);

  const saveMutation = useMutation({
    mutationFn: async ({ payload, tiers }: { payload: any; tiers: PromotionTier[]; isKeepOpen: boolean }) => {
      let promotionId = editForm.promotion_id;
      
      if (isAdding) {
        const { data, error } = await supabase.from('promotions').insert([payload]).select();
        if (error) throw error;
        promotionId = data[0].promotion_id;
      } else {
        const { error } = await supabase.from('promotions').update(payload).eq('promotion_id', promotionId);
        if (error) throw error;
        
        // Delete existing tiers and conditions
        const { data: existingTiers } = await supabase.from('promotion_tiers').select('id').eq('promotion_id', promotionId);
        if (existingTiers && existingTiers.length > 0) {
          const tierIds = existingTiers.map(t => t.id);
          await supabase.from('promotion_conditions').delete().in('tier_id', tierIds);
          await supabase.from('promotion_tiers').delete().eq('promotion_id', promotionId);
        }
      }

      // Insert new tiers and conditions
      for (const tier of tiers) {
        const { conditions, id, products, gifts, ...tierData } = tier;
        
        const giftsToSave = gifts && gifts.length > 0 ? gifts : [{ gift_product_id: tierData.gift_product_id, gift_quantity: tierData.gift_quantity || 1 }];
        
        for (const gift of giftsToSave) {
          const { data: newTier, error: tierError } = await supabase.from('promotion_tiers').insert([{
            ...tierData,
            gift_product_id: gift.gift_product_id || null,
            gift_quantity: gift.gift_quantity || 1,
            promotion_id: promotionId
          }]).select();
          
          if (tierError) throw tierError;
          
          if (conditions && conditions.length > 0) {
            const conditionsToInsert = conditions.map(c => {
              const { id, ...cData } = c;
              // Convert target_values string to array for Postgres text[] column
              let targetValuesArray: string[] = [];
              if (Array.isArray(cData.target_values)) {
                targetValuesArray = cData.target_values;
              } else if (typeof cData.target_values === 'string') {
                targetValuesArray = cData.target_values.split(',').map(v => v.trim()).filter(Boolean);
              }
              
              return { 
                ...cData, 
                target_values: targetValuesArray,
                tier_id: newTier[0].id 
              };
            });
            const { error: condError } = await supabase.from('promotion_conditions').insert(conditionsToInsert);
            if (condError) throw condError;
          }
        }
      }
      
      return payload;
    },
    onSuccess: (_, variables) => {
      toast.success(isAdding ? 'Thêm promotion thành công!' : 'Cập nhật promotion thành công!');
      if (variables.isKeepOpen && isAdding) {
        setEditForm({ promotion_name: '', promotion_type: '', program_id: '', channel_id: '', account_id: '', shop_id: '', mechanic_rules: {}, tiers: [] });
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
      const { error } = await supabase.from('promotions').delete().eq('promotion_id', id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => {
      toast.success('Đã xóa promotion!');
    },
    onError: (error: any) => {
      toast.error(`Lỗi khi xóa: ${error.message}`);
    }
  });

  const handleAdd = () => {
    setIsAdding(true);
    setEditForm({ 
      mechanic_rules: {}, 
      tiers: [{ 
        tier_name: '', 
        tier_type: 'Chiết khấu số lượng', 
        support_amount: 0, 
        min_total_qty: 0, 
        conditions: [{ condition_type: 'Dòng sản phẩm', target_values: '', min_target_value: 1 }] 
      }] 
    });
    setIsModalOpen(true);
  };

  const handleEdit = (promotion: Promotion) => {
    setIsAdding(false);
    setEditForm(promotion);
    setIsModalOpen(true);
  };

  const handleSave = (isKeepOpen = false) => {
    if (!editForm.promotion_name?.trim() || !editForm.program_id) {
      toast.error("Vui lòng nhập Tên Promotion và chọn Program.");
      return;
    }

    const payload = {
      promotion_name: editForm.promotion_name.trim(),
      promotion_type: editForm.promotion_type?.trim() || '',
      program_id: editForm.program_id,
      channel_id: editForm.channel_id || null,
      account_id: editForm.account_id || null,
      shop_id: editForm.shop_id || null,
      mechanic_rules: {
        ...editForm.mechanic_rules,
        start_date: editForm.start_date,
        end_date: editForm.end_date
      }
    };

    saveMutation.mutate({ payload, tiers: editForm.tiers || [], isKeepOpen });
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

  if (isLoading) return <div className="p-8 text-center text-indigo-600 font-semibold animate-pulse">Đang tải danh sách promotion...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-2">
          <div className="p-2 bg-indigo-50 rounded-lg">
            <RefreshCw className="h-5 w-5 text-indigo-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-900">Danh sách Chương trình Khuyến mãi</h2>
        </div>
        <div className="flex items-center space-x-4">
          <button 
            onClick={() => {}} 
            className="text-sm text-blue-600 hover:text-blue-800 flex items-center"
          >
            Làm mới dữ liệu
          </button>
          <button
            onClick={handleAdd}
            className="inline-flex items-center justify-center rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700"
          >
            <Plus className="-ml-1 mr-2 h-5 w-5" />
            Tạo KM mới
          </button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 mb-8">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Tìm kiếm tên chương trình..."
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border pl-10 pr-3 py-2"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="w-full sm:w-64 relative">
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <select
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border pl-10 pr-3 py-2 bg-white appearance-none"
            value={selectedProgramFilter}
            onChange={(e) => setSelectedProgramFilter(e.target.value)}
          >
            <option value="">Tất cả trạng thái</option>
            <option value="active">Đang diễn ra</option>
            <option value="upcoming">Sắp diễn ra</option>
            <option value="expired">Đã kết thúc</option>
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
        </div>
      </div>

      <div className="space-y-4">
        {/* Header Row */}
        <div className="grid grid-cols-12 px-6 py-3 text-sm font-semibold text-gray-500 border-b border-gray-100">
          <div className="col-span-4">Tên chương trình</div>
          <div className="col-span-3 text-center">Thời gian áp dụng</div>
          <div className="col-span-2 text-center">Trạng thái</div>
          <div className="col-span-2 text-center">Số lượng Gói</div>
          <div className="col-span-1"></div>
        </div>

        {filteredPromotions.map((promotion) => {
          const isExpanded = expandedPromotionId === promotion.promotion_id;
          const now = new Date();
          const startDate = promotion.programs?.start_date ? new Date(promotion.programs.start_date) : null;
          const endDate = promotion.programs?.end_date ? new Date(promotion.programs.end_date) : null;
          
          let status = 'Đang diễn ra';
          let statusColor = 'bg-green-100 text-green-700';
          
          if (startDate && now < startDate) {
            status = 'Sắp diễn ra';
            statusColor = 'bg-blue-100 text-blue-700';
          } else if (endDate && now > endDate) {
            status = 'Đã kết thúc';
            statusColor = 'bg-gray-100 text-gray-700';
          }

          return (
            <div key={promotion.promotion_id} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div 
                className="grid grid-cols-12 px-6 py-5 items-center cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => setExpandedPromotionId(isExpanded ? null : promotion.promotion_id)}
              >
                <div className="col-span-4 font-bold text-gray-900">{promotion.promotion_name}</div>
                <div className="col-span-3 text-center text-sm text-gray-500 flex items-center justify-center">
                  <RefreshCw className="h-4 w-4 mr-2 text-gray-300" />
                  {promotion.programs?.start_date ? new Date(promotion.programs.start_date).toLocaleDateString('vi-VN') : 'N/A'} - {promotion.programs?.end_date ? new Date(promotion.programs.end_date).toLocaleDateString('vi-VN') : 'N/A'}
                </div>
                <div className="col-span-2 text-center">
                  <span className={`px-3 py-1 rounded-full text-xs font-bold ${statusColor}`}>
                    {status}
                  </span>
                </div>
                <div className="col-span-2 text-center text-sm text-gray-600 font-medium">
                  {promotion.tiers?.length || 0} gói
                  {promotion.tiers?.some(t => t.tier_type === 'Quà tặng') && (
                    <div className="text-[10px] text-pink-500 font-bold flex items-center justify-center mt-1">
                      <Gift className="h-3 w-3 mr-1" />
                      Có quà tặng
                    </div>
                  )}
                </div>
                <div className="col-span-1 flex justify-end space-x-2">
                  <button 
                    onClick={(e) => { e.stopPropagation(); handleEdit(promotion); }} 
                    className="p-1 text-gray-400 hover:text-indigo-600 transition-colors"
                  >
                    <Edit2 className="h-4 w-4" />
                  </button>
                  <button 
                    onClick={(e) => { e.stopPropagation(); handleDelete(promotion.promotion_id); }} 
                    className="p-1 text-gray-400 hover:text-red-600 transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                  <div className="p-1 text-gray-400">
                    {isExpanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                  </div>
                </div>
              </div>

              {isExpanded && (
                <div className="bg-gray-50/50 px-8 py-6 border-t border-gray-50">
                  <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">Chi tiết các gói hỗ trợ</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {promotion.tiers?.map((tier, idx) => (
                      <div key={idx} className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm relative overflow-hidden">
                        <div className="flex justify-between items-start mb-4">
                          <div className="flex items-start">
                            {tier.tier_type === 'Quà tặng' && <Gift className="h-5 w-5 text-pink-500 mr-2 mt-0.5" />}
                            <h5 className="font-bold text-blue-800">{tier.tier_name}</h5>
                          </div>
                          {tier.support_amount > 0 && (
                            <div className="text-right">
                              <div className="text-green-600 font-bold text-lg">
                                +{new Intl.NumberFormat('vi-VN').format(tier.support_amount)} đ/bộ
                              </div>
                            </div>
                          )}
                        </div>
                        
                        <div className="space-y-2 text-sm">
                          <div className="text-gray-500">
                            Loại: {tier.tier_type}
                          </div>
                          {tier.tier_type === 'Quà tặng' && (tier.gifts && tier.gifts.length > 0 ? tier.gifts : [{ gift_product_id: tier.gift_product_id, gift_quantity: tier.gift_quantity || 1, product_name: (tier.products as any)?.product_name }]).map((gift, gIdx) => gift.product_name && (
                            <div key={gIdx} className="text-pink-700 font-bold flex items-center bg-pink-50 px-3 py-2 rounded-lg border border-pink-100 mt-2">
                              <Gift className="h-4 w-4 mr-2 text-pink-500" />
                              <span className="text-xs uppercase tracking-wider mr-2">Quà tặng:</span>
                              <span className="text-lg mr-1">{gift.gift_quantity || 1}x</span> {gift.product_name}
                            </div>
                          ))}
                          <div className="text-gray-700 mt-3 bg-blue-50 p-2 rounded border border-blue-100">
                            <span className="text-xs uppercase text-blue-600 font-bold mr-2">Tổng số tiền tối thiểu:</span> 
                            <span className="font-bold text-blue-800 text-lg">{new Intl.NumberFormat('vi-VN').format(tier.min_total_qty)} đ</span>
                          </div>
                          
                          {tier.conditions && tier.conditions.length > 0 && tier.conditions.some(c => c.target_values && c.target_values.length > 0) && (
                            <div className="mt-4 pt-4 border-t border-gray-50">
                              <div className="font-bold text-gray-800 mb-2 bg-gray-100 inline-block px-2 py-1 rounded text-xs uppercase tracking-wider">Điều kiện áp dụng:</div>
                              <ul className="space-y-2 mt-2">
                                {tier.conditions.filter(c => c.target_values && c.target_values.length > 0).map((cond, cIdx) => (
                                  <li key={cIdx} className="flex items-start text-gray-800 font-medium bg-gray-50 p-2 rounded border border-gray-100">
                                    <span className="mr-2 mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0"></span>
                                    <span>
                                      <span className="text-blue-700">{cond.condition_type}:</span> {Array.isArray(cond.target_values) ? cond.target_values.join(', ') : cond.target_values} 
                                      <span className="text-gray-500 ml-1 text-xs font-normal">(Tối thiểu {cond.min_target_value} bộ)</span>
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {filteredPromotions.length === 0 && (
          <div className="bg-white p-12 rounded-xl border border-dashed border-gray-200 text-center text-gray-400">
            Không tìm thấy chương trình khuyến mãi nào.
          </div>
        )}
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={isAdding ? 'Tạo Chương Trình Khuyến Mãi Mới' : 'Sửa Chương Trình Khuyến Mãi'} maxWidth="max-w-4xl">
        <div className="space-y-6 max-h-[80vh] overflow-y-auto p-1">
          {/* Header section */}
          <div className="bg-gray-50 p-4 rounded-lg space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Tên chương trình</label>
              <input 
                type="text" 
                placeholder="VD: Hỗ trợ bán hàng Quý 1/2026"
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" 
                value={editForm.promotion_name || ''} 
                onChange={e => setEditForm({...editForm, promotion_name: e.target.value})} 
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Ngày bắt đầu</label>
                <input 
                  type="date" 
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" 
                  value={editForm.start_date || (editForm.mechanic_rules?.start_date || '')} 
                  onChange={e => setEditForm({...editForm, start_date: e.target.value})} 
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Ngày kết thúc</label>
                <input 
                  type="date" 
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" 
                  value={editForm.end_date || (editForm.mechanic_rules?.end_date || '')} 
                  onChange={e => setEditForm({...editForm, end_date: e.target.value})} 
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Program</label>
                <select
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
                  value={editForm.program_id || ''}
                  onChange={e => setEditForm({...editForm, program_id: e.target.value})}
                >
                  <option value="">Chọn Program</option>
                  {programs.map((p: any) => (
                    <option key={p.program_id} value={p.program_id}>{p.program_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Loại Promotion</label>
                <input 
                  type="text" 
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" 
                  value={editForm.promotion_type || ''} 
                  onChange={e => setEditForm({...editForm, promotion_type: e.target.value})} 
                />
              </div>
            </div>
          </div>

          {/* Tiers section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Các Gói Hỗ Trợ (Tiers)</h3>
              <button
                type="button"
                onClick={() => {
                  const newTiers = [...(editForm.tiers || [])];
                  newTiers.push({ 
                    tier_name: '', 
                    tier_type: 'Chiết khấu số lượng', 
                    support_amount: 0, 
                    min_total_qty: 0, 
                    conditions: [{ condition_type: 'Dòng sản phẩm', target_values: '', min_target_value: 1 }] 
                  });
                  setEditForm({...editForm, tiers: newTiers});
                }}
                className="inline-flex items-center text-indigo-600 hover:text-indigo-900 text-sm font-medium"
              >
                <Plus className="h-4 w-4 mr-1" /> Thêm Gói
              </button>
            </div>

            {(editForm.tiers || []).map((tier, tIdx) => (
              <div key={tIdx} className="border border-indigo-100 rounded-lg p-4 bg-white shadow-sm relative">
                <button 
                  onClick={() => {
                    const newTiers = [...(editForm.tiers || [])];
                    newTiers.splice(tIdx, 1);
                    setEditForm({...editForm, tiers: newTiers});
                  }}
                  className="absolute top-2 right-2 text-gray-400 hover:text-red-500"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
                
                <h4 className="text-indigo-600 font-bold mb-4">Gói #{tIdx + 1}</h4>
                
                <div className="grid grid-cols-3 gap-4 mb-4">
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-gray-500 uppercase">Tên gói</label>
                    <input 
                      type="text" 
                      placeholder="VD: Gói 10 bộ cơ bản"
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" 
                      value={tier.tier_name}
                      onChange={e => {
                        const newTiers = [...(editForm.tiers || [])];
                        newTiers[tIdx].tier_name = e.target.value;
                        setEditForm({...editForm, tiers: newTiers});
                      }}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 uppercase">Loại gói</label>
                    <select
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
                      value={tier.tier_type}
                      onChange={e => {
                        const newTiers = [...(editForm.tiers || [])];
                        newTiers[tIdx].tier_type = e.target.value;
                        setEditForm({...editForm, tiers: newTiers});
                      }}
                    >
                      <option value="Chiết khấu số lượng">Chiết khấu số lượng</option>
                      <option value="Quà tặng">Quà tặng</option>
                      <option value="Thưởng nóng">Thưởng nóng</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4 mb-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 uppercase">Mức hỗ trợ (VNĐ/bộ)</label>
                    <input 
                      type="text" 
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" 
                      value={tier.support_amount !== undefined && tier.support_amount !== null ? new Intl.NumberFormat('vi-VN').format(tier.support_amount) : ''}
                      onChange={e => {
                        const val = e.target.value.replace(/\D/g, '');
                        const newTiers = [...(editForm.tiers || [])];
                        newTiers[tIdx].support_amount = Number(val);
                        setEditForm({...editForm, tiers: newTiers});
                      }}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 uppercase">Tổng số tiền tối thiểu</label>
                    <input 
                      type="text" 
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" 
                      value={tier.min_total_qty !== undefined && tier.min_total_qty !== null ? new Intl.NumberFormat('vi-VN').format(tier.min_total_qty) : ''}
                      onChange={e => {
                        const val = e.target.value.replace(/\D/g, '');
                        const newTiers = [...(editForm.tiers || [])];
                        newTiers[tIdx].min_total_qty = Number(val);
                        setEditForm({...editForm, tiers: newTiers});
                      }}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 uppercase">Ngày kết thúc riêng (Tùy chọn)</label>
                    <input 
                      type="date" 
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" 
                      value={tier.override_end_date || ''}
                      onChange={e => {
                        const newTiers = [...(editForm.tiers || [])];
                        newTiers[tIdx].override_end_date = e.target.value;
                        setEditForm({...editForm, tiers: newTiers});
                      }}
                    />
                  </div>
                </div>

                {tier.tier_type === 'Quà tặng' && (
                  <div className="mb-4 p-3 bg-pink-50 rounded-lg border border-pink-100">
                    <div className="flex justify-between items-center mb-3">
                      <h5 className="text-sm font-bold text-pink-800">Danh sách quà tặng</h5>
                      <button
                        type="button"
                        onClick={() => {
                          const newTiers = [...(editForm.tiers || [])];
                          if (!newTiers[tIdx].gifts) {
                            newTiers[tIdx].gifts = [{ gift_product_id: newTiers[tIdx].gift_product_id || '', gift_quantity: newTiers[tIdx].gift_quantity || 1 }];
                          }
                          newTiers[tIdx].gifts!.push({ gift_product_id: '', gift_quantity: 1 });
                          setEditForm({...editForm, tiers: newTiers});
                        }}
                        className="inline-flex items-center text-pink-600 hover:text-pink-800 text-xs font-medium"
                      >
                        <Plus className="h-3 w-3 mr-1" /> Thêm quà
                      </button>
                    </div>
                    
                    {(tier.gifts || [{ gift_product_id: tier.gift_product_id || '', gift_quantity: tier.gift_quantity || 1 }]).map((gift, gIdx) => (
                      <div key={gIdx} className="grid grid-cols-12 gap-3 mb-3 items-end relative">
                        <div className="col-span-8">
                          <label className="block text-[10px] font-medium text-pink-700 uppercase">Sản phẩm quà tặng</label>
                          <select
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2 bg-white"
                            value={gift.gift_product_id || ''}
                            onChange={e => {
                              const newTiers = [...(editForm.tiers || [])];
                              if (!newTiers[tIdx].gifts) {
                                newTiers[tIdx].gifts = [{ gift_product_id: newTiers[tIdx].gift_product_id || '', gift_quantity: newTiers[tIdx].gift_quantity || 1 }];
                              }
                              newTiers[tIdx].gifts![gIdx].gift_product_id = e.target.value;
                              // Also update the root fields for backward compatibility if it's the first item
                              if (gIdx === 0) {
                                newTiers[tIdx].gift_product_id = e.target.value;
                              }
                              setEditForm({...editForm, tiers: newTiers});
                            }}
                          >
                            <option value="">Chọn sản phẩm quà tặng</option>
                            {products
                              .filter((p: any) => {
                                const isGiftOrSample = p.item_type === 'Quà tặng' || p.item_type === 'Mẫu thử';
                                if (!isGiftOrSample) return false;
                                
                                const brandConditions = tier.conditions.filter(c => c.condition_type === 'Nhãn hàng');
                                if (brandConditions.length === 0) return true;

                                const allowedBrands = brandConditions.flatMap(c => {
                                  if (Array.isArray(c.target_values)) return c.target_values;
                                  if (typeof c.target_values === 'string') return c.target_values.split(',').map(v => v.trim()).filter(Boolean);
                                  return [];
                                });

                                return allowedBrands.includes(p.brands?.brand_name);
                              })
                              .map((p: any) => (
                                <option key={p.product_id} value={p.product_id}>{p.product_name}</option>
                              ))
                            }
                          </select>
                        </div>
                        <div className="col-span-3">
                          <label className="block text-[10px] font-medium text-pink-700 uppercase">Số lượng</label>
                          <input 
                            type="number" 
                            min="1"
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2" 
                            value={gift.gift_quantity || 1}
                            onChange={e => {
                              const newTiers = [...(editForm.tiers || [])];
                              if (!newTiers[tIdx].gifts) {
                                newTiers[tIdx].gifts = [{ gift_product_id: newTiers[tIdx].gift_product_id || '', gift_quantity: newTiers[tIdx].gift_quantity || 1 }];
                              }
                              newTiers[tIdx].gifts![gIdx].gift_quantity = Number(e.target.value);
                              if (gIdx === 0) {
                                newTiers[tIdx].gift_quantity = Number(e.target.value);
                              }
                              setEditForm({...editForm, tiers: newTiers});
                            }}
                          />
                        </div>
                        <div className="col-span-1 pb-2">
                          {(tier.gifts?.length || 1) > 1 && (
                            <button
                              type="button"
                              onClick={() => {
                                const newTiers = [...(editForm.tiers || [])];
                                newTiers[tIdx].gifts!.splice(gIdx, 1);
                                if (gIdx === 0 && newTiers[tIdx].gifts!.length > 0) {
                                  newTiers[tIdx].gift_product_id = newTiers[tIdx].gifts![0].gift_product_id;
                                  newTiers[tIdx].gift_quantity = newTiers[tIdx].gifts![0].gift_quantity;
                                }
                                setEditForm({...editForm, tiers: newTiers});
                              }}
                              className="text-gray-400 hover:text-red-500"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Conditions sub-section */}
                <div className="mt-4 border-l-2 border-indigo-200 pl-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h5 className="text-sm font-medium text-gray-700">Điều kiện đi kèm</h5>
                    <button
                      type="button"
                      onClick={() => {
                        const newTiers = [...(editForm.tiers || [])];
                        newTiers[tIdx].conditions.push({ condition_type: 'Dòng sản phẩm', target_values: '', min_target_value: 1 });
                        setEditForm({...editForm, tiers: newTiers});
                      }}
                      className="inline-flex items-center text-indigo-500 hover:text-indigo-700 text-xs font-medium"
                    >
                      <Plus className="h-3 w-3 mr-1" /> Thêm điều kiện
                    </button>
                  </div>

                  {tier.conditions.map((cond, cIdx) => (
                    <div key={cIdx} className="grid grid-cols-12 gap-3 items-end bg-gray-50 p-2 rounded">
                      <div className="col-span-4">
                        <label className="block text-[10px] font-medium text-gray-400 uppercase">LOẠI ĐK</label>
                        <select
                          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-xs border p-1.5"
                          value={cond.condition_type}
                          onChange={e => {
                            const newTiers = [...(editForm.tiers || [])];
                            newTiers[tIdx].conditions[cIdx].condition_type = e.target.value;
                            setEditForm({...editForm, tiers: newTiers});
                          }}
                        >
                          <option value="Dòng sản phẩm">Dòng sản phẩm</option>
                          <option value="Sản phẩm cụ thể">Sản phẩm cụ thể</option>
                          <option value="Nhãn hàng">Nhãn hàng</option>
                        </select>
                      </div>
                      <div className="col-span-5 relative">
                        <label className="block text-[10px] font-medium text-gray-400 uppercase">GIÁ TRỊ (CÁCH NHAU DẤU PHẨY)</label>
                        <div className="flex gap-1">
                          <input 
                            type="text" 
                            placeholder="VD: FTKZ, FTKM"
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-xs border p-1.5" 
                            value={cond.target_values}
                            onChange={e => {
                              const newTiers = [...(editForm.tiers || [])];
                              newTiers[tIdx].conditions[cIdx].target_values = e.target.value;
                              setEditForm({...editForm, tiers: newTiers});
                            }}
                          />
                          {(cond.condition_type === 'Nhãn hàng' || cond.condition_type === 'Sản phẩm cụ thể') && (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectionType(cond.condition_type as any);
                                setActiveTierIdx(tIdx);
                                setActiveCondIdx(cIdx);
                                setIsSelectionModalOpen(true);
                              }}
                              className="mt-1 p-1.5 bg-indigo-50 text-indigo-600 rounded-md border border-indigo-200 hover:bg-indigo-100"
                              title="Chọn từ danh sách"
                            >
                              <Plus className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="col-span-2">
                        <label className="block text-[10px] font-medium text-gray-400 uppercase">SỐ TIỀN TỐI THIỂU</label>
                        <input 
                          type="number" 
                          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-xs border p-1.5" 
                          value={cond.min_target_value}
                          onChange={e => {
                            const newTiers = [...(editForm.tiers || [])];
                            newTiers[tIdx].conditions[cIdx].min_target_value = Number(e.target.value);
                            setEditForm({...editForm, tiers: newTiers});
                          }}
                        />
                      </div>
                      <div className="col-span-1 flex justify-center pb-1">
                        <button 
                          onClick={() => {
                            const newTiers = [...(editForm.tiers || [])];
                            newTiers[tIdx].conditions.splice(cIdx, 1);
                            setEditForm({...editForm, tiers: newTiers});
                          }}
                          className="text-gray-400 hover:text-red-500"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="bg-gray-50 p-4 rounded-lg grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Channel</label>
              <select
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
                value={editForm.channel_id || ''}
                onChange={e => setEditForm({...editForm, channel_id: e.target.value})}
              >
                <option value="">Tất cả</option>
                {channels.map((c: any) => (
                  <option key={c.channel_id} value={c.channel_id}>{c.channel_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Account</label>
              <select
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
                value={editForm.account_id || ''}
                onChange={e => setEditForm({...editForm, account_id: e.target.value})}
              >
                <option value="">Tất cả</option>
                {accounts.map((a: any) => (
                  <option key={a.account_id} value={a.account_id}>{a.account_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Shop</label>
              <select
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
                value={editForm.shop_id || ''}
                onChange={e => setEditForm({...editForm, shop_id: e.target.value})}
              >
                <option value="">Tất cả</option>
                {shops.map((s: any) => (
                  <option key={s.shop_id} value={s.shop_id}>{s.shop_name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex justify-end space-x-3 pt-4 border-t sticky bottom-0 bg-white pb-2">
            <button 
              onClick={() => setIsModalOpen(false)} 
              disabled={isSaving}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Hủy
            </button>
            <button 
              onClick={() => handleSave(false)} 
              disabled={isSaving}
              className="rounded-md border border-transparent bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 flex items-center"
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"></path></svg>
              {isSaving ? 'Đang lưu...' : 'Lưu Chương Trình Khuyến Mãi'}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={confirmDelete}
        title="Xóa Promotion"
        message="Bạn có chắc chắn muốn xóa promotion này không? Hành động này không thể hoàn tác."
      />

      <Modal 
        isOpen={isSelectionModalOpen} 
        onClose={() => setIsSelectionModalOpen(false)} 
        title={`Chọn ${selectionType}`}
        maxWidth="max-w-md"
      >
        <div className="space-y-4">
          <div className="max-h-96 overflow-y-auto border rounded-md">
            {selectionType === 'Nhãn hàng' ? (
              <div className="divide-y">
                {brands.map((b: any) => (
                  <label key={b.brand_id} className="flex items-center p-3 hover:bg-gray-50 cursor-pointer">
                    <input
                      type="checkbox"
                      className="rounded text-indigo-600 mr-3"
                      checked={(() => {
                        const val = editForm.tiers?.[activeTierIdx!]?.conditions[activeCondIdx!]?.target_values;
                        const currentValues = Array.isArray(val) ? val : (val || '').split(',').map(v => v.trim()).filter(Boolean);
                        return currentValues.includes(b.brand_name);
                      })()}
                      onChange={(e) => {
                        const val = editForm.tiers?.[activeTierIdx!]?.conditions[activeCondIdx!]?.target_values;
                        const currentValues = Array.isArray(val) ? val : (val || '').split(',').map(v => v.trim()).filter(Boolean);
                        let newValues;
                        if (e.target.checked) {
                          newValues = [...currentValues, b.brand_name];
                        } else {
                          newValues = currentValues.filter(v => v !== b.brand_name);
                        }
                        const newTiers = [...(editForm.tiers || [])];
                        newTiers[activeTierIdx!].conditions[activeCondIdx!].target_values = newValues.join(', ');
                        setEditForm({...editForm, tiers: newTiers});
                      }}
                    />
                    <span className="text-sm text-gray-700">{b.brand_name}</span>
                  </label>
                ))}
              </div>
            ) : (
              <div className="divide-y">
                {products.map((p: any) => (
                  <label key={p.product_id} className="flex items-center p-3 hover:bg-gray-50 cursor-pointer">
                    <input
                      type="checkbox"
                      className="rounded text-indigo-600 mr-3"
                      checked={(() => {
                        const val = editForm.tiers?.[activeTierIdx!]?.conditions[activeCondIdx!]?.target_values;
                        const currentValues = Array.isArray(val) ? val : (val || '').split(',').map(v => v.trim()).filter(Boolean);
                        return currentValues.includes(p.product_name);
                      })()}
                      onChange={(e) => {
                        const val = editForm.tiers?.[activeTierIdx!]?.conditions[activeCondIdx!]?.target_values;
                        const currentValues = Array.isArray(val) ? val : (val || '').split(',').map(v => v.trim()).filter(Boolean);
                        let newValues;
                        if (e.target.checked) {
                          newValues = [...currentValues, p.product_name];
                        } else {
                          newValues = currentValues.filter(v => v !== p.product_name);
                        }
                        const newTiers = [...(editForm.tiers || [])];
                        newTiers[activeTierIdx!].conditions[activeCondIdx!].target_values = newValues.join(', ');
                        setEditForm({...editForm, tiers: newTiers});
                      }}
                    />
                    <span className="text-sm text-gray-700">{p.product_name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="flex justify-end">
            <button
              onClick={() => setIsSelectionModalOpen(false)}
              className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 text-sm font-medium"
            >
              Xong
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
