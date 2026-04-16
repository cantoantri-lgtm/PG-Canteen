import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { format, startOfMonth, endOfMonth, parseISO } from 'date-fns';

interface OrderItem {
  id: string;
  cart_id: string;
  product_id: string;
  qty: number;
  net_value: number;
  switched_from_brand: string | null;
  created_at: string;
  products: any;
}

interface KPI {
  kpi_id: string;
  start_date: string;
  end_date: string;
  sale_target: number;
}

export default function PGReport() {
  const { user } = useAuth();
  const isAdmin = user?.admin_role === true || 
                  user?.role_id === 'admin' || 
                  user?.role_name?.toUpperCase() === 'ADMIN' || 
                  user?.email?.toLowerCase() === 'can.toantri@gmail.com';
  const isSup = user?.role_name?.toUpperCase() === 'SUP' || user?.role_id === 'SUP';
  
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [selectedPgId, setSelectedPgId] = useState<string>(isAdmin || isSup ? '' : (user?.id || ''));
  const [selectedManagerId, setSelectedManagerId] = useState<string>(isSup ? (user?.id || '') : '');

  // Fetch all profiles for admin/manager filtering
  const { data: allProfiles = [] } = useQuery({
    queryKey: ['all_profiles'],
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('id, full_name, manager_id, admin_role, role_id').order('full_name');
      return data || [];
    }
  });

  const { data: roles = [] } = useQuery({
    queryKey: ['roles'],
    queryFn: async () => {
      const { data } = await supabase.from('roles').select('*');
      return data || [];
    }
  });

  const managers = useMemo(() => {
    return allProfiles.filter(p => {
      const roleName = roles.find(r => r.role_id === p.role_id)?.role_name || '';
      return p.admin_role || roleName.toUpperCase() === 'SUP' || roleName.toUpperCase() === 'ADMIN';
    });
  }, [allProfiles, roles]);

  const filteredProfiles = useMemo(() => {
    if (isAdmin) {
      if (selectedManagerId) {
        return allProfiles.filter(p => p.manager_id === selectedManagerId && !p.admin_role);
      }
      return allProfiles.filter(p => !p.admin_role);
    }
    if (isSup) {
      return allProfiles.filter(p => p.manager_id === user?.id && !p.admin_role);
    }
    // Nếu là quản lý (nhưng không phải admin/sup)
    const managed = allProfiles.filter(p => p.manager_id === user?.id);
    if (managed.length > 0) {
      return managed;
    }
    return [];
  }, [allProfiles, isAdmin, isSup, selectedManagerId, user?.id]);

  const isManager = !isAdmin && !isSup && allProfiles.some(p => p.manager_id === user?.id);
  const canSelectPg = isAdmin || isSup || isManager;

  // Fetch orders for the selected PG and month
  const { data: orders = [], isLoading: loadingOrders } = useQuery({
    queryKey: ['pg_orders', selectedPgId, selectedDate],
    queryFn: async () => {
      if (!selectedPgId) return [];
      
      const date = new Date(selectedDate);
      const start = startOfMonth(date).toISOString();
      const end = endOfMonth(date).toISOString();

      const { data, error } = await supabase
        .from('order_details')
        .select(`
          id, order_id, product_id, qty, net_value, switched_from_brand,
          orders!inner(
            cart_id, created_at, pg_id
          ),
          products (
            product_name,
            product_group!inner (
              brands ( brand_name )
            )
          )
        `)
        .eq('orders.pg_id', selectedPgId)
        .gte('orders.created_at', start)
        .lte('orders.created_at', end);
        
      if (error) throw error;
      
      // Flatten the data
      return (data || []).map(item => {
        const order = Array.isArray(item.orders) ? item.orders[0] : item.orders;
        const product = Array.isArray(item.products) ? item.products[0] : item.products;
        const productGroup = Array.isArray(product?.product_group) ? product.product_group[0] : product?.product_group;
        const brand = Array.isArray(productGroup?.brands) ? productGroup.brands[0] : productGroup?.brands;
        
        return {
          id: item.id,
          cart_id: order?.cart_id,
          product_id: item.product_id,
          qty: item.qty,
          net_value: item.net_value,
          switched_from_brand: item.switched_from_brand,
          created_at: order?.created_at,
          products: {
            product_name: product?.product_name,
            brands: {
              brand_name: brand?.brand_name
            }
          }
        };
      }) as any as OrderItem[];
    },
    enabled: !!selectedPgId,
  });

  // Fetch KPIs for the selected PG
  const { data: kpis = [] } = useQuery({
    queryKey: ['pg_kpis', selectedPgId, selectedDate],
    queryFn: async () => {
      if (!selectedPgId) return [];
      const date = new Date(selectedDate);
      const start = startOfMonth(date).toISOString().split('T')[0];
      const end = endOfMonth(date).toISOString().split('T')[0];
      
      const { data, error } = await supabase
        .from('kpis')
        .select('*')
        .eq('pg_id', selectedPgId)
        .gte('end_date', start)
        .lte('start_date', end);
        
      if (error) throw error;
      return data as KPI[];
    },
    enabled: !!selectedPgId,
  });

  const reportData = useMemo(() => {
    if (!selectedPgId) return null;

    const pgName = (isAdmin || isManager)
      ? allProfiles.find(p => p.id === selectedPgId)?.full_name || 'Không xác định'
      : user?.full_name || 'Không xác định';

    // Lọc đơn hàng của đúng ngày được chọn
    const dailyOrders = orders.filter(o => o.created_at.startsWith(selectedDate));
    
    // Tính số giỏ hàng
    const uniqueCarts = new Set(dailyOrders.map(o => o.cart_id)).size;
    
    // Tổng số tiền ngày
    const dailyTotalAmount = dailyOrders.reduce((sum, o) => sum + Number(o.net_value), 0);
    
    // Lũy kế tháng (Loại bỏ hàng đối thủ theo chuẩn tính KPI)
    const monthlyTotalAmount = orders
      .filter(o => !o.switched_from_brand)
      .reduce((sum, o) => sum + Number(o.net_value), 0);

    // Tính tỷ lệ chuyển đổi
    const dailyTotalQty = dailyOrders.reduce((sum, o) => sum + Number(o.qty), 0);
    const dailyConvertedQty = dailyOrders.filter(o => o.switched_from_brand).reduce((sum, o) => sum + Number(o.qty), 0);
    const conversionRate = dailyTotalQty > 0 ? (dailyConvertedQty / dailyTotalQty) * 100 : 0;

    // Tính toán KPI
    const totalMonthlyTarget = kpis.reduce((sum, kpi) => sum + Number(kpi.sale_target), 0);
    
    const dateObj = new Date(selectedDate);
    const daysInMonth = new Date(dateObj.getFullYear(), dateObj.getMonth() + 1, 0).getDate();
    const dailyTarget = totalMonthlyTarget / daysInMonth;

    const dailyKpiProgress = dailyTarget > 0 ? (dailyTotalAmount / dailyTarget) * 100 : 0;
    const monthlyKpiProgress = totalMonthlyTarget > 0 ? (monthlyTotalAmount / totalMonthlyTarget) * 100 : 0;

    // Gom nhóm dữ liệu cho bảng: Thương hiệu -> Sản phẩm -> Tính tổng SL & Tiền
    const tableDataMap = new Map<string, { brand: string, product: string, qty: number, amount: number }>();
    
    dailyOrders.forEach(o => {
      const brandName = o.products?.brands?.brand_name || 'Khác';
      const productName = o.products?.product_name || 'Không xác định';
      const key = `${brandName}-${productName}`;
      
      if (!tableDataMap.has(key)) {
        tableDataMap.set(key, { brand: brandName, product: productName, qty: 0, amount: 0 });
      }
      
      const item = tableDataMap.get(key)!;
      item.qty += Number(o.qty);
      item.amount += Number(o.net_value);
    });

    const tableData = Array.from(tableDataMap.values()).sort((a, b) => a.brand.localeCompare(b.brand) || a.product.localeCompare(b.product));

    return {
      pgName,
      date: selectedDate,
      uniqueCarts,
      dailyTotalAmount,
      dailyKpiProgress,
      monthlyKpiProgress,
      conversionRate,
      tableData
    };
  }, [selectedPgId, selectedDate, orders, kpis, allProfiles, isAdmin, isManager, user]);

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-10 px-4">
      <div className="sm:flex sm:items-center sm:justify-between pt-6">
        <h2 className="text-2xl font-bold text-gray-900">Báo Cáo Cuối Ngày PG</h2>
      </div>

      <div className="bg-white shadow rounded-lg p-6 border border-gray-200">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {isAdmin && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Lọc theo Quản lý</label>
              <select 
                className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
                value={selectedManagerId}
                onChange={(e) => {
                  setSelectedManagerId(e.target.value);
                  setSelectedPgId('');
                }}
              >
                <option value="">-- Tất cả Quản lý --</option>
                {managers.map(m => (
                  <option key={m.id} value={m.id}>{m.full_name}</option>
                ))}
              </select>
            </div>
          )}

          {canSelectPg && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Chọn Nhân viên PG</label>
              <select 
                className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
                value={selectedPgId}
                onChange={(e) => setSelectedPgId(e.target.value)}
              >
                <option value="">-- Chọn PG --</option>
                {filteredProfiles.map(p => (
                  <option key={p.id} value={p.id}>{p.full_name}</option>
                ))}
              </select>
            </div>
          )}
          
          <div className={!canSelectPg ? "md:col-span-2" : ""}>
            <label className="block text-sm font-medium text-gray-700 mb-1">Ngày báo cáo</label>
            <input 
              type="date" 
              className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
            />
          </div>
        </div>

        {loadingOrders ? (
          <div className="text-center py-10 text-gray-500">Đang tải dữ liệu báo cáo...</div>
        ) : !selectedPgId ? (
          <div className="text-center py-10 text-gray-500">Vui lòng chọn nhân viên PG để xem báo cáo.</div>
        ) : reportData ? (
          <div className="space-y-8">
            
            {/* --- CÁC THẺ THỐNG KÊ (ĐÃ BỎ THẺ NGÀY THÁNG) --- */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100">
                <p className="text-sm font-medium text-indigo-600 mb-1">Tên PG</p>
                <p className="text-lg font-bold text-gray-900">{reportData.pgName}</p>
              </div>
              <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100">
                <p className="text-sm font-medium text-indigo-600 mb-1">Số giỏ hàng</p>
                <p className="text-lg font-bold text-gray-900">{reportData.uniqueCarts}</p>
              </div>
              <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100">
                <p className="text-sm font-medium text-indigo-600 mb-1">Tổng số tiền</p>
                <p className="text-lg font-bold text-gray-900">{new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(reportData.dailyTotalAmount)}</p>
              </div>
              <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100">
                <p className="text-sm font-medium text-indigo-600 mb-1">Tiến độ đạt KPI ngày</p>
                <p className="text-lg font-bold text-gray-900">{reportData.dailyKpiProgress.toFixed(1)}%</p>
              </div>
              <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100">
                <p className="text-sm font-medium text-indigo-600 mb-1">Tiến độ KPI tháng</p>
                <p className="text-lg font-bold text-gray-900">{reportData.monthlyKpiProgress.toFixed(1)}%</p>
              </div>
              <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100 sm:col-span-2 lg:col-span-1">
                <p className="text-sm font-medium text-indigo-600 mb-1">Tỉ lệ chuyển đổi trong ngày (Theo số lượng)</p>
                <p className="text-lg font-bold text-gray-900">{reportData.conversionRate.toFixed(1)}%</p>
              </div>
            </div>

            {/* --- BẢNG DỮ LIỆU CHI TIẾT --- */}
            <div>
              <h3 className="text-lg font-bold text-gray-900 mb-4">Bảng số liệu chi tiết</h3>
              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">NHÓM HÀNG (THƯƠNG HIỆU)</th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">SẢN PHẨM</th>
                      <th scope="col" className="px-6 py-3 text-center text-xs font-bold text-gray-500 uppercase tracking-wider">SỐ LƯỢNG</th>
                      <th scope="col" className="px-6 py-3 text-right text-xs font-bold text-gray-500 uppercase tracking-wider">SỐ TIỀN</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {reportData.tableData.length > 0 ? (
                      reportData.tableData.map((row, idx) => (
                        <tr key={idx} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-medium">{row.brand}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{row.product}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-center font-bold">{row.qty}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right font-medium">
                            {new Intl.NumberFormat('vi-VN').format(row.amount)}đ
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={4} className="px-6 py-8 text-center text-sm text-gray-500 italic">
                          Không có dữ liệu bán hàng trong ngày này.
                        </td>
                      </tr>
                    )}
                  </tbody>
                  {/* Dòng tính tổng footer */}
                  {reportData.tableData.length > 0 && (
                    <tfoot className="bg-gray-50 font-bold border-t border-gray-300">
                      <tr>
                        <td colSpan={2} className="px-6 py-4 whitespace-nowrap text-sm text-indigo-900 text-right uppercase">Tổng cộng:</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-indigo-900 text-center text-lg">{reportData.tableData.reduce((sum, r) => sum + r.qty, 0)}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-indigo-900 text-right text-lg">{new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(reportData.dailyTotalAmount)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>

          </div>
        ) : null}
      </div>
    </div>
  );
}