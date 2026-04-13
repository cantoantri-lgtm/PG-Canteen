import React, { useState, useRef, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { Plus, Edit2, Trash2 } from 'lucide-react';
import Modal from '../../components/Modal';
import ConfirmModal from '../../components/ConfirmModal';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useRealtimeSync } from '../../hooks/useRealtimeSync';
import CreatableSelect from 'react-select/creatable';

interface Category {
  id: number;
  name: string;
}

interface Brand {
  brand_id: string;
  brand_name: string;
  category_id: number | null;
}

interface ProductGroup {
  id: string;
  name: string;
  brand_id: string;
}

interface Product {
  product_id: string;
  product_name: string;
  product_group_id: string;
  product_group: string; // Đã thêm trường này dựa theo DB schema
  value: number;
  item_type: 'NORMAL_PRODUCT' | 'Quà tặng' | 'Mẫu thử';
  product_group_rel?: { // Đổi tên để không trùng với cột text product_group
    name: string, 
    brands?: { 
      brand_name: string, 
      brand_id: string,
      categories?: {
        id: number,
        name: string
      }
    } 
  };
}

export default function Products() {
  const navigate = useNavigate();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Product>>({});
  
  // States for unified form
  const [selectedCategory, setSelectedCategory] = useState<{value: string | number, label: string, __isNew__?: boolean} | null>(null);
  const [selectedBrand, setSelectedBrand] = useState<{value: string, label: string, __isNew__?: boolean} | null>(null);
  const [selectedProductGroup, setSelectedProductGroup] = useState<{value: string, label: string, __isNew__?: boolean} | null>(null);

  const [isAdding, setIsAdding] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBrandFilter, setSelectedBrandFilter] = useState('');
  const [selectedTypeFilter, setSelectedTypeFilter] = useState('');
  
  const inputRef = useRef<HTMLInputElement>(null);

  // 1. Fetch Data ban đầu với React Query
  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const { data, error } = await supabase.from('categories').select('*').order('name');
      if (error) throw error;
      return data as Category[];
    }
  });

  const { data: brands = [] } = useQuery({
    queryKey: ['brands'],
    queryFn: async () => {
      const { data, error } = await supabase.from('brands').select('*').order('brand_name');
      if (error) throw error;
      return data as Brand[];
    }
  });

  const { data: productGroups = [], isLoading: loadingProductGroups } = useQuery({
    queryKey: ['product_groups'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('product_group')
        .select('*')
        .order('name');
      if (error) throw error;
      return data as ProductGroup[];
    }
  });

  const { data: products = [], isLoading: loadingProducts } = useQuery({
    queryKey: ['products_simple'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .order('product_name');
      if (error) throw error;
      return data as Product[];
    }
  });

  // 2. Realtime Sync
  useRealtimeSync(useMemo(() => ({ table: 'categories', queryKey: ['categories'], idColumn: 'id' }), []));
  useRealtimeSync(useMemo(() => ({ table: 'brands', queryKey: ['brands'], idColumn: 'brand_id' }), []));
  useRealtimeSync(useMemo(() => ({ table: 'product_group', queryKey: ['product_groups'], idColumn: 'id' }), []));
  useRealtimeSync(useMemo(() => ({
    table: 'products',
    queryKey: ['products_simple'],
    idColumn: 'product_id',
    selectQuery: '*'
  }), []));

  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      const pg = productGroups.find(g => g.id === p.product_group_id);
      const matchesSearch = p.product_name?.toLowerCase().includes(searchQuery.toLowerCase()) || pg?.name?.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesBrand = selectedBrandFilter === '' || pg?.brand_id === selectedBrandFilter;
      const matchesType = selectedTypeFilter === '' || p.item_type === selectedTypeFilter;
      return matchesSearch && matchesBrand && matchesType;
    });
  }, [products, productGroups, searchQuery, selectedBrandFilter, selectedTypeFilter]);

  const uniqueBrands = useMemo(() => {
    const brandsMap = new Map();
    products.forEach(p => {
      const pg = productGroups.find(g => g.id === p.product_group_id);
      if (pg?.brand_id) {
        const brand = brands.find(b => b.brand_id === pg.brand_id);
        if (brand) {
          brandsMap.set(brand.brand_id, brand.brand_name);
        }
      }
    });
    return Array.from(brandsMap.entries()).map(([id, name]) => ({ id, name }));
  }, [products, productGroups, brands]);

  // 3. Mutations (Chỉ Đẩy dữ liệu lên Supabase, UI sẽ tự cập nhật qua Realtime)
  const saveMutation = useMutation({
    mutationFn: async ({ payload }: { payload: any; isKeepOpen: boolean }) => {
      if (isAdding) {
        const { data, error } = await supabase
          .from('products')
          .insert([payload])
          .select()
          .single();
 
        if (error) throw error;
        return data as Product;
      } else {
        const { data, error } = await supabase
          .from('products')
          .update(payload)
          .eq('product_id', editForm.product_id)
          .select()
          .single();
     
        if (error) throw error;
        return data as Product;
      }
    },
    onSuccess: (_, variables) => {
      toast.success(isAdding ? 'Thêm sản phẩm thành công!' : 'Cập nhật sản phẩm thành công!');
      
      if (variables.isKeepOpen) {
        setEditForm(prev => ({ ...prev, product_name: '', value: 0 }));
        setTimeout(() => inputRef.current?.focus(), 100);
      } else {
        setIsModalOpen(false);
      }
    },
    onError: (error: any) => {
      console.error('Error saving product:', error);
      toast.error(`Không thể lưu: ${error.message}`);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('products').delete().eq('product_id', id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => {
      toast.success('Đã xóa sản phẩm!');
    },
    onError: (error: any) => {
      toast.error(`Lỗi khi xóa: ${error.message}`);
    }
  });

  // 4. Handlers
  const handleAdd = () => {
    setIsAdding(true);
    setEditForm({ value: 0, item_type: 'NORMAL_PRODUCT' });
    setSelectedCategory(null);
    setSelectedBrand(null);
    setSelectedProductGroup(null);
    setIsModalOpen(true);
  };

  const handleEdit = (product: Product) => {
    setIsAdding(false);
    setEditForm(product);
    const pg = productGroups.find(g => g.id === product.product_group_id);
    if (pg) {
      setSelectedProductGroup({ value: pg.id, label: pg.name });
      const brand = brands.find(b => b.brand_id === pg.brand_id);
      if (brand) {
        setSelectedBrand({ value: brand.brand_id, label: brand.brand_name });
        const category = categories.find(c => c.id === brand.category_id);
        if (category) {
          setSelectedCategory({ value: category.id, label: category.name });
        } else {
          setSelectedCategory(null);
        }
      } else {
        setSelectedBrand(null);
        setSelectedCategory(null);
      }
    } else {
      setSelectedProductGroup(null);
      setSelectedBrand(null);
      setSelectedCategory(null);
    }
    
    setIsModalOpen(true);
  };

  const handleSave = async (isKeepOpen = false) => {
    if (!selectedProductGroup) {
      toast.error("Vui lòng chọn hoặc nhập Nhóm sản phẩm.");
      return;
    }

    let finalCategoryId = selectedCategory?.value;
    let finalBrandId = selectedBrand?.value;
    let finalProductGroupId = selectedProductGroup?.value;

    try {
      // 1. Create Category if new
      if (selectedCategory && selectedCategory.__isNew__) {
        const { data: newCat, error } = await supabase
          .from('categories')
          .insert([{ name: selectedCategory.label }])
          .select()
          .single();
        if (error) throw error;
        finalCategoryId = newCat.id;
      }

      // 2. Create Brand if new
      if (selectedBrand && selectedBrand.__isNew__) {
        const { data: newBrand, error } = await supabase
          .from('brands')
          .insert([{ brand_name: selectedBrand.label, category_id: finalCategoryId || null }])
          .select()
          .single();
        if (error) throw error;
        finalBrandId = newBrand.brand_id;
      }

      // 3. Create Product Group if new
      if (selectedProductGroup && selectedProductGroup.__isNew__) {
        if (!finalBrandId) {
          toast.error("Vui lòng chọn Thương hiệu cho Nhóm sản phẩm mới.");
          return;
        }
        const { data: newPg, error } = await supabase
          .from('product_group')
          .insert([{ name: selectedProductGroup.label, brand_id: finalBrandId }])
          .select()
          .single();
        if (error) throw error;
        finalProductGroupId = newPg.id;
      }

      // ĐÃ CHỈNH SỬA: Thêm trường product_group vào payload
      const payload = {
        product_name: editForm.product_name?.trim() || null,
        product_group_id: finalProductGroupId,
        product_group: selectedProductGroup.label, // Cột bắt buộc theo DB schema
        value: editForm.value || 0,
        item_type: (editForm.item_type as 'NORMAL_PRODUCT' | 'Quà tặng' | 'Mẫu thử') || 'NORMAL_PRODUCT',
      };

      saveMutation.mutate({ payload, isKeepOpen });
    } catch (err: any) {
      console.error(err);
      toast.error(`Lỗi khi tạo dữ liệu liên quan: ${err.message}`);
    }
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

  const isLoading = loadingProducts || loadingProductGroups;
  const isSaving = saveMutation.isPending;

  if (isLoading) return <div className="p-8 text-center">Đang tải danh sách sản phẩm...</div>;

  return (
    <div className="space-y-6">
      <div className="sm:flex sm:items-center sm:justify-between">
        <h2 className="text-2xl font-bold text-gray-900">Sản phẩm</h2>
        <div className="mt-3 sm:mt-0 flex space-x-3">
          <button
            onClick={() => navigate('/dashboard/admin/brands')}
            className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
          >
            Quản lý Nhãn hàng
          </button>
          <button
            onClick={() => navigate('/dashboard/admin/product-groups')}
            className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
          >
            Quản lý Nhóm hàng
          </button>
          <button
            onClick={handleAdd}
            className="inline-flex items-center justify-center rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700"
          >
            <Plus className="-ml-1 mr-2 h-5 w-5" />
            Thêm Sản phẩm
          </button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 bg-white p-4 rounded-lg shadow-sm border border-gray-200">
        <div className="flex-1">
          <label className="block text-sm font-medium text-gray-700 mb-1">Tìm kiếm sản phẩm</label>
          <input
            type="text"
            placeholder="Nhập tên sản phẩm..."
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="w-full sm:w-48">
          <label className="block text-sm font-medium text-gray-700 mb-1">Lọc theo loại</label>
          <select
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2 bg-white"
            value={selectedTypeFilter}
            onChange={(e) => setSelectedTypeFilter(e.target.value)}
          >
            <option value="">Tất cả loại</option>
            <option value="NORMAL_PRODUCT">Sản phẩm thường</option>
            <option value="Quà tặng">Quà tặng</option>
            <option value="Mẫu thử">Mẫu thử</option>
          </select>
        </div>
        <div className="w-full sm:w-64">
          <label className="block text-sm font-medium text-gray-700 mb-1">Lọc theo thương hiệu</label>
          <select
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2 bg-white"
            value={selectedBrandFilter}
            onChange={(e) => setSelectedBrandFilter(e.target.value)}
          >
            <option value="">Tất cả thương hiệu</option>
            {uniqueBrands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
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
                    <th className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 sm:pl-6">Nhóm Sản phẩm</th>
                    <th className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 sm:pl-6">Chi tiết Sản phẩm</th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Thương hiệu</th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Loại</th>
                    <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">Giá trị quy chuẩn</th>
                    <th className="relative py-3.5 pl-3 pr-4 sm:pr-6"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {filteredProducts.map((product) => {
                    const pg = productGroups.find(g => g.id === product.product_group_id);
                    const brand = pg ? brands.find(b => b.brand_id === pg.brand_id) : null;
                    return (
                    <tr key={product.product_id}>
                      <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-900 sm:pl-6">{pg?.name}</td>
                      <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm text-gray-500 sm:pl-6">{product.product_name || '-'}</td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{brand?.brand_name}</td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          product.item_type === 'Quà tặng' ? 'bg-pink-100 text-pink-800' :
                          product.item_type === 'Mẫu thử' ? 'bg-yellow-100 text-yellow-800' :
                          'bg-green-100 text-green-800'
                        }`}>
                          {product.item_type || 'NORMAL_PRODUCT'}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm font-semibold text-gray-900">
                        {new Intl.NumberFormat('vi-VN').format(product.value)} VNĐ
                      </td>
                      <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                        <button onClick={() => handleEdit(product)} className="text-indigo-600 hover:text-indigo-900 mr-4"><Edit2 className="h-4 w-4" /></button>
                        <button onClick={() => handleDelete(product.product_id)} className="text-red-600 hover:text-red-900"><Trash2 className="h-4 w-4" /></button>
                      </td>
                    </tr>
                  )})}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={isAdding ? 'Thêm Sản phẩm' : 'Sửa Sản phẩm'}>
        <div className="space-y-5">
          
          {/* Phân cấp danh mục */}
          <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 space-y-4">
            <h3 className="text-sm font-bold text-gray-800 uppercase tracking-wider mb-2">Phân loại sản phẩm</h3>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Ngành hàng</label>
              <CreatableSelect
                isClearable
                placeholder="Chọn hoặc nhập ngành hàng mới..."
                options={categories.map(c => ({ value: c.id, label: c.name }))}
                value={selectedCategory}
                onChange={(newValue) => {
                  setSelectedCategory(newValue);
                  setSelectedBrand(null);
                  setSelectedProductGroup(null);
                }}
                className="text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Thương hiệu</label>
              <CreatableSelect
                isClearable
                placeholder="Chọn hoặc nhập thương hiệu mới..."
                options={brands
                  .filter(b => !selectedCategory || b.category_id === selectedCategory.value)
                  .map(b => ({ value: b.brand_id, label: b.brand_name }))}
                value={selectedBrand}
                onChange={(newValue) => {
                  setSelectedBrand(newValue);
                  setSelectedProductGroup(null);
                }}
                className="text-sm"
                isDisabled={!selectedCategory}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nhóm sản phẩm *</label>
              <CreatableSelect
                isClearable
                placeholder="Chọn hoặc nhập nhóm sản phẩm mới..."
                options={productGroups
                  .filter(pg => !selectedBrand || pg.brand_id === selectedBrand.value)
                  .map(pg => ({ value: pg.id, label: pg.name }))}
                value={selectedProductGroup}
                onChange={(newValue) => setSelectedProductGroup(newValue)}
                className="text-sm"
                isDisabled={!selectedBrand}
              />
            </div>
          </div>

          {/* Chi tiết sản phẩm */}
          <div className="bg-white p-4 rounded-lg border border-gray-200 space-y-4 shadow-sm">
            <h3 className="text-sm font-bold text-gray-800 uppercase tracking-wider mb-2">Chi tiết sản phẩm</h3>
            
            <div>
               <label className="block text-sm font-medium text-gray-700 mb-1">Tên Sản phẩm (Chi tiết)</label>
              <input 
                type="text" 
                ref={inputRef}
                className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2.5" 
                value={editForm.product_name || ''} 
                onChange={e => setEditForm({...editForm, product_name: e.target.value})} 
                placeholder="VD: Size L, Hương Trà Xanh (Để trống nếu không có)"
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Loại sản phẩm</label>
                <select 
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2.5 bg-white" 
                  value={editForm.item_type || 'NORMAL_PRODUCT'} 
                  onChange={e => setEditForm({...editForm, item_type: e.target.value as any})}
                >
                  <option value="NORMAL_PRODUCT">Sản phẩm bán</option>
                  <option value="Quà tặng">Quà tặng</option>
                  <option value="Mẫu thử">Mẫu thử</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Giá trị quy chuẩn (VNĐ)</label>
                <input 
                  type="number" 
                  min="0"
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2.5" 
                  value={editForm.value ?? ''} 
                  onChange={e => setEditForm({...editForm, value: Number(e.target.value)})} 
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end space-x-3 mt-6 pt-4 border-t border-gray-100">
            <button 
              onClick={() => setIsModalOpen(false)} 
              disabled={isSaving}
              className="rounded-md border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Hủy
            </button>
            {isAdding && (
              <button 
                onClick={() => handleSave(true)} 
                disabled={isSaving}
                className="rounded-md border border-transparent bg-green-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-green-700 transition-colors"
              >
                {isSaving ? 'Đang lưu...' : 'Lưu & Thêm tiếp'}
              </button>
            )}
            <button 
              onClick={() => handleSave(false)} 
              disabled={isSaving}
              className="rounded-md border border-transparent bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
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
        title="Xóa Sản phẩm"
        message="Bạn có chắc chắn muốn xóa sản phẩm này không? Hành động này không thể hoàn tác."
      />
    </div>
  );
}