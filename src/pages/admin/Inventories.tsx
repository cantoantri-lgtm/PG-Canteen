import React, { useState, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { Plus, Edit2, Trash2 } from 'lucide-react';
import Modal from '../../components/Modal';
import ConfirmModal from '../../components/ConfirmModal';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useRealtimeSync } from '../../hooks/useRealtimeSync';

interface Inventory {
  id: string;
  sup_id: string;
  product_id: string;
  quantity: number;
  last_updated: string;
  profiles?: { full_name: string };
  products?: { product_name: string };
}

export default function Inventories() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Inventory>>({});
  const [isAdding, setIsAdding] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSupFilter, setSelectedSupFilter] = useState('');
  const [selectedProductFilter, setSelectedProductFilter] = useState('');
  const [selectedModalBrand, setSelectedModalBrand] = useState('');

  const { data: profiles = [] } = useQuery({
    queryKey: ['profiles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('*').order('full_name');
      if (error) throw error;
      return data;
    }
  });

  const { data: products = [] } = useQuery({
    queryKey: ['products'],
    queryFn: async () => {
      const { data, error } = await supabase.from('products').select('*').order('product_name');
      if (error) throw error;
      return data;
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

  const { data: inventories = [], isLoading } = useQuery({
    queryKey: ['inventories'],
    queryFn: async () => {
      const { data, error } = await supabase.from('inventories').select('*, profiles(full_name), products(product_name)').order('last_updated', { ascending: false });
      if (error) throw error;
      return data as Inventory[];
    }
  });

  const inventorySyncConfig = useMemo(() => ({
    table: 'inventories',
    queryKey: ['inventories'],
    idColumn: 'id'
  }), []);

  useRealtimeSync(inventorySyncConfig);

  const filteredInventories = useMemo(() => {
    return inventories.filter(i => {
      const matchesSearch = (i.profiles?.full_name || '').toLowerCase().includes(searchQuery.toLowerCase()) || 
                           (i.products?.product_name || '').toLowerCase().includes(searchQuery.toLowerCase());
      const matchesSup = selectedSupFilter === '' || i.sup_id === selectedSupFilter;
      const matchesProduct = selectedProductFilter === '' || i.product_id === selectedProductFilter;
      return matchesSearch && matchesSup && matchesProduct;
    });
  }, [inventories, searchQuery, selectedSupFilter, selectedProductFilter]);

  const saveMutation = useMutation({
    mutationFn: async ({ payload }: { payload: any; isKeepOpen: boolean }) => {
      if (isAdding) {
        const { error } = await supabase.from('inventories').insert([payload]);
        if (error) throw error;
        return payload;
      } else {
        const { error } = await supabase.from('inventories').update(payload).eq('id', editForm.id);
        if (error) throw error;
        return payload;
      }
    },
    onSuccess: (_, variables) => {
      toast.success(isAdding ? 'Thêm inventory thành công!' : 'Cập nhật inventory thành công!');
      if (variables.isKeepOpen && isAdding) {
        setEditForm({ sup_id: '', product_id: '', quantity: 0 });
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
      const { error } = await supabase.from('inventories').delete().eq('id', id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => {
      toast.success('Đã xóa inventory!');
    },
    onError: (error: any) => {
      toast.error(`Lỗi khi xóa: ${error.message}`);
    }
  });

  const handleAdd = () => {
    setIsAdding(true);
    setEditForm({ quantity: 0 });
    setSelectedModalBrand('');
    setIsModalOpen(true);
  };

  const handleEdit = (inventory: Inventory) => {
    setIsAdding(false);
    setEditForm(inventory);
    
    // Find the brand of the product being edited
    const product = products.find((p: any) => p.product_id === inventory.product_id);
    if (product) {
      setSelectedModalBrand(product.brand_id || '');
    } else {
      setSelectedModalBrand('');
    }
    
    setIsModalOpen(true);
  };

  const handleSave = (isKeepOpen = false) => {
    if (!editForm.sup_id || !editForm.product_id) {
      toast.error("Vui lòng chọn SUP và Sản phẩm.");
      return;
    }

    const payload = {
      sup_id: editForm.sup_id,
      product_id: editForm.product_id,
      quantity: Number(editForm.quantity) || 0,
      last_updated: new Date().toISOString()
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

  if (isLoading) return <div className="p-8 text-center text-indigo-600 font-semibold animate-pulse">Đang tải danh sách inventory...</div>;

  return (
    <div className="space-y-6">

  {/* 🔥 STATS */}
  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
    <div className="bg-white p-4 rounded-xl shadow-sm border">
      <p className="text-sm text-gray-500">Tổng sản phẩm</p>
      <p className="text-2xl font-bold">{inventories.length}</p>
    </div>

    <div className="bg-white p-4 rounded-xl shadow-sm border">
      <p className="text-sm text-gray-500">Tổng tồn kho</p>
      <p className="text-2xl font-bold">
        {inventories.reduce((sum, i) => sum + i.quantity, 0)}
      </p>
    </div>

    <div className="bg-white p-4 rounded-xl shadow-sm border">
      <p className="text-sm text-gray-500">Sắp hết</p>
      <p className="text-2xl font-bold text-red-500">
        {inventories.filter(i => i.quantity < 10).length}
      </p>
    </div>

    <div className="bg-white p-4 rounded-xl shadow-sm border">
      <p className="text-sm text-gray-500">Ổn định</p>
      <p className="text-2xl font-bold text-green-600">
        {inventories.filter(i => i.quantity >= 50).length}
      </p>
    </div>
  </div>

  {/* 🔍 SEARCH đẹp hơn */}
  <div className="relative">
    <input
      type="text"
      placeholder="Tìm SUP hoặc sản phẩm..."
      className="w-full pl-10 pr-4 py-2 border rounded-lg shadow-sm focus:ring-2 focus:ring-indigo-500"
      value={searchQuery}
      onChange={(e) => setSearchQuery(e.target.value)}
    />
    <span className="absolute left-3 top-2.5 text-gray-400">🔍</span>
  </div>

  {/* 🧱 CARD GRID */}
  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
    {filteredInventories.map((inventory) => {
      
      const status =
        inventory.quantity < 10
          ? { label: 'Sắp hết', color: 'red' }
          : inventory.quantity < 50
          ? { label: 'Trung bình', color: 'yellow' }
          : { label: 'Còn nhiều', color: 'green' };

      return (
        <div
          key={inventory.id}
          className="bg-white p-5 rounded-xl shadow-sm border hover:shadow-lg transition-all duration-200"
        >
          {/* HEADER */}
          <div className="flex justify-between items-start">
            <div>
              <h3 className="font-semibold text-gray-900">
                {inventory.products?.product_name}
              </h3>
              <p className="text-sm text-gray-400">
                {inventory.profiles?.full_name}
              </p>
            </div>

            {/* BADGE */}
            <span
              className={`text-xs px-2 py-1 rounded-full ${
                status.color === 'red'
                  ? 'bg-red-100 text-red-600'
                  : status.color === 'yellow'
                  ? 'bg-yellow-100 text-yellow-600'
                  : 'bg-green-100 text-green-600'
              }`}
            >
              {status.label}
            </span>
          </div>

          {/* QUANTITY */}
          <div className="mt-4">
            <p className="text-3xl font-bold text-gray-800">
              {inventory.quantity}
            </p>
          </div>

          {/* PROGRESS */}
          <div className="mt-3">
            <div className="w-full bg-gray-200 h-2 rounded-full">
              <div
                className={`h-2 rounded-full ${
                  status.color === 'red'
                    ? 'bg-red-500'
                    : status.color === 'yellow'
                    ? 'bg-yellow-500'
                    : 'bg-green-500'
                }`}
                style={{
                  width: `${Math.min(inventory.quantity, 100)}%`
                }}
              />
            </div>
          </div>

          {/* FOOTER */}
          <div className="mt-4 flex justify-between items-center text-xs text-gray-400">
            <span>
              {new Date(inventory.last_updated).toLocaleString()}
            </span>

            <div className="flex gap-3">
              <button
                onClick={() => handleEdit(inventory)}
                className="text-indigo-500 hover:scale-110 transition"
              >
                <Edit2 size={16} />
              </button>

              <button
                onClick={() => handleDelete(inventory.id)}
                className="text-red-500 hover:scale-110 transition"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        </div>
      );
    })}
  </div>

  {/* EMPTY */}
  {filteredInventories.length === 0 && (
    <div className="text-center text-gray-400 py-10">
      Không có dữ liệu tồn kho 😢
    </div>
  )}
</div>
  );
}
