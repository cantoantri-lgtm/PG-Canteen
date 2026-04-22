import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay } from 'date-fns';
import { BarChart3, ChevronDown, ChevronUp, Image as ImageIcon, Eye, X, FileText } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ComposedChart, Line
} from 'recharts';

// Hàm hỗ trợ an toàn: Tránh lỗi khi Supabase trả về Mảng thay vì Object
const getRel = (val: any) => Array.isArray(val) ? val[0] : val;

interface KPI {
  kpi_id: string;
  start_date: string;
  end_date: string;
  sale_target: number;
}

export default function PGReport() {
  const { user } = useAuth();
  
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [selectedPgId, setSelectedPgId] = useState<string>('');
  const [selectedManagerId, setSelectedManagerId] = useState<string>('');
  const [viewingBillUrl, setViewingBillUrl] = useState<string | null>(null);
  const [expandedCartId, setExpandedCartId] = useState<string | null>(null);

  // 1. Fetch Danh sách Roles
  const { data: roles = [] } = useQuery({
    queryKey: ['roles'],
    queryFn: async () => {
      const { data } = await supabase.from('roles').select('*');
      return data || [];
    }
  });

  // 2. Fetch Danh sách Profiles
  const { data: allProfiles = [] } = useQuery({
    queryKey: ['all_profiles'],
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('id, full_name, manager_id, admin_role, role_id').order('full_name');
      return data || [];
    }
  });

  // 3. Logic Phân quyền an toàn
  const { isAdmin, isSup } = useMemo(() => {
    const matchedRole = roles.find(r => r.role_id === user?.role_id);
    const roleName = (matchedRole?.role_name || '').toUpperCase();
    return {
      isAdmin: user?.admin_role === true || roleName === 'ADMIN' || user?.email === 'can.toantri@gmail.com',
      isSup: roleName === 'SUP'
    };
  }, [roles, user?.role_id, user?.admin_role, user?.email]);

  const isManager = !isAdmin && !isSup && allProfiles.some(p => p.manager_id === user?.id);
  const canSelectPg = isAdmin || isSup || isManager;

  // 4. Danh sách Quản lý (Dành cho Admin)
  const managers = useMemo(() => {
    return allProfiles.filter(p => {
      const rName = roles.find(r => r.role_id === p.role_id)?.role_name?.toUpperCase() || '';
      return p.admin_role || rName === 'SUP' || rName === 'ADMIN';
    });
  }, [allProfiles, roles]);

  // 5. Danh sách Nhân viên theo quyền
  const filteredProfiles = useMemo(() => {
    if (isAdmin) {
      if (selectedManagerId) return allProfiles.filter(p => p.manager_id === selectedManagerId && !p.admin_role);
      return allProfiles.filter(p => !p.admin_role);
    }
    if (isSup || isManager) {
      return allProfiles.filter(p => p.manager_id === user?.id && !p.admin_role);
    }
    return [];
  }, [allProfiles, isAdmin, isSup, isManager, selectedManagerId, user?.id]);

  // Xác định ID PG. Đảm bảo nhân viên PG luôn xem được của mình
  const pgIdToUse = useMemo(() => {
    if (canSelectPg && selectedPgId) return selectedPgId;
    return user?.id || '';
  }, [canSelectPg, selectedPgId, user?.id]);

  const shouldFetch = Boolean(pgIdToUse && pgIdToUse !== '');

  // 6. Fetch Đơn Hàng (Xử lý Relation Array cực kỳ an toàn)
  const { data: orders = [], isLoading: loadingOrders, error: ordersError } = useQuery({
    queryKey: ['pg_orders', pgIdToUse, selectedDate],
    queryFn: async () => {
      if (!shouldFetch) return [];
      
      // Xử lý bounds của tháng hiện tại
      const dateObj = new Date(selectedDate);
      const start = startOfMonth(dateObj).toISOString();
      const end = endOfMonth(dateObj).toISOString();

      const { data, error } = await supabase
        .from('order_details')
        .select(`
          id, qty, net_value, switched_from_brand,
          orders!inner(cart_id, created_at, pg_id, bill_image_url, customer_name, customer_phone),
          products(
            product_name,
            product_group!inner(brands(brand_name))
          )
        `)
        .eq('orders.pg_id', pgIdToUse)
        .gte('orders.created_at', start)
        .lte('orders.created_at', end);
        
      if (error) throw error;
      
      // Đưa data lồng ghép phức tạp thành 1 object dễ tính toán
      return (data || []).map((item: any) => {
        const order = getRel(item.orders);
        const product = getRel(item.products);
        const productGroup = getRel(product?.product_group);
        const brand = getRel(productGroup?.brands);

        return {
          id: item.id,
          cart_id: order?.cart_id,
          qty: Number(item.qty) || 0,
          net_value: Number(item.net_value) || 0,
          switched_from_brand: item.switched_from_brand,
          created_at: order?.created_at,
          product_name: product?.product_name || 'Không xác định',
          brand_name: brand?.brand_name || 'Khác',
          bill_image_url: order?.bill_image_url,
          customer_name: order?.customer_name,
          customer_phone: order?.customer_phone
        };
      });
    },
    enabled: shouldFetch,
  });

  // 7. Fetch KPIs
  const { data: kpis = [] } = useQuery({
    queryKey: ['pg_kpis', pgIdToUse, selectedDate],
    queryFn: async () => {
      if (!shouldFetch) return [];
      const dateObj = new Date(selectedDate);
      const start = startOfMonth(dateObj).toISOString().split('T')[0];
      const end = endOfMonth(dateObj).toISOString().split('T')[0];
      
      const { data, error } = await supabase
        .from('kpis')
        .select('*')
        .eq('pg_id', pgIdToUse)
        .gte('end_date', start)
        .lte('start_date', end);
        
      if (error) throw error;
      return data as KPI[];
    },
    enabled: shouldFetch,
  });

  // 8. Tính toán số liệu báo cáo
  const reportData = useMemo(() => {
    if (!shouldFetch || !user) return null;

    const pgName = allProfiles.find(p => p.id === pgIdToUse)?.full_name || user?.full_name || 'Nhân viên';

    // ĐÃ FIX: Lọc chính xác ngày theo múi giờ địa phương (Tránh rớt đơn)
    const dailyOrders = orders.filter(o => {
      if (!o.created_at) return false;
      const orderDateStr = format(new Date(o.created_at), 'yyyy-MM-dd');
      return orderDateStr === selectedDate;
    });
    
    const uniqueCarts = new Set(dailyOrders.map(o => o.cart_id)).size;
    const dailyTotalAmount = dailyOrders.reduce((sum, o) => sum + o.net_value, 0);
    const monthlyTotalAmount = orders.filter(o => !o.switched_from_brand).reduce((sum, o) => sum + o.net_value, 0);

    const dailyTotalQty = dailyOrders.reduce((sum, o) => sum + o.qty, 0);
    const dailyConvertedQty = dailyOrders.filter(o => o.switched_from_brand).reduce((sum, o) => sum + o.qty, 0);
    const conversionRate = dailyTotalQty > 0 ? (dailyConvertedQty / dailyTotalQty) * 100 : 0;

    const totalMonthlyTarget = kpis.reduce((sum, kpi) => sum + Number(kpi.sale_target), 0);
    const daysInMonth = new Date(new Date(selectedDate).getFullYear(), new Date(selectedDate).getMonth() + 1, 0).getDate();
    const dailyTarget = totalMonthlyTarget / daysInMonth;

    const dailyKpiProgress = dailyTarget > 0 ? (dailyTotalAmount / dailyTarget) * 100 : 0;
    const monthlyKpiProgress = totalMonthlyTarget > 0 ? (monthlyTotalAmount / totalMonthlyTarget) * 100 : 0;

    const tableDataMap = new Map();
    dailyOrders.forEach(o => {
      const key = `${o.brand_name}-${o.product_name}`;
      if (!tableDataMap.has(key)) {
        tableDataMap.set(key, { brand: o.brand_name, product: o.product_name, qty: 0, amount: 0 });
      }
      const item = tableDataMap.get(key);
      item.qty += o.qty;
      item.amount += o.net_value;
    });

    const sortedTableData = Array.from(tableDataMap.values()).sort((a, b) => a.brand.localeCompare(b.brand));

    // Nhóm theo cart_id để xem chi tiết từng đơn (Bill)
    const cartMap = new Map();
    dailyOrders.forEach(o => {
      if (!cartMap.has(o.cart_id)) {
        cartMap.set(o.cart_id, {
          cart_id: o.cart_id,
          created_at: o.created_at,
          customer_name: o.customer_name,
          customer_phone: o.customer_phone,
          bill_image_url: o.bill_image_url,
          items: [],
          totalAmount: 0
        });
      }
      const cartObj = cartMap.get(o.cart_id);
      cartObj.items.push(o);
      cartObj.totalAmount += o.net_value;
    });
    const detailedOrders = Array.from(cartMap.values()).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    // Tính toán dữ liệu biểu đồ theo ngày trong tháng
    const dateObj = new Date(selectedDate);
    const monthInterval = eachDayOfInterval({
      start: startOfMonth(dateObj),
      end: endOfMonth(dateObj)
    });

    const monthlyChartData = monthInterval.map(day => {
      const dayStr = format(day, 'yyyy-MM-dd');
      const daySales = orders.filter(o => {
        if (!o.created_at) return false;
        return format(new Date(o.created_at), 'yyyy-MM-dd') === dayStr;
      }).reduce((sum, o) => sum + o.net_value, 0);

      return {
        date: format(day, 'dd/MM'),
        sales: daySales,
        fullDate: dayStr
      };
    });

    const totalDays = monthlyChartData.length;
    const totalMonthSales = monthlyChartData.reduce((sum, d) => sum + d.sales, 0);
    const averageSales = totalDays > 0 ? totalMonthSales / totalDays : 0;

    return {
      pgName, 
      uniqueCarts, 
      dailyTotalAmount, 
      dailyTotalQty, 
      dailyKpiProgress, 
      monthlyKpiProgress, 
      conversionRate, 
      tableData: sortedTableData,
      detailedOrders,
      monthlyChartData,
      averageSales
    };
  }, [shouldFetch, orders, kpis, selectedDate, allProfiles, pgIdToUse, user]);

  if (!user) return <div className="p-10 text-center font-medium text-gray-500">Đang kiểm tra quyền truy cập...</div>;

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-10 px-4">
      <div className="pt-6">
        <h2 className="text-2xl font-bold text-gray-900">Báo Cáo Cuối Ngày PG</h2>
      </div>

      <div className="bg-white shadow rounded-lg p-6 border border-gray-200">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          
          {/* Lọc Quản lý (Chỉ Admin thấy) */}
          {isAdmin && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Quản lý</label>
              <select 
                className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
                value={selectedManagerId}
                onChange={(e) => { setSelectedManagerId(e.target.value); setSelectedPgId(''); }}
              >
                <option value="">-- Tất cả Quản lý --</option>
                {managers.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
              </select>
            </div>
          )}

          {/* Chọn nhân viên PG */}
          {canSelectPg && (
            <div className={isAdmin ? "" : "md:col-span-2"}>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nhân viên PG</label>
              <select 
                className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
                value={selectedPgId}
                onChange={(e) => setSelectedPgId(e.target.value)}
              >
                <option value="">-- Chọn nhân viên để xem --</option>
                {filteredProfiles.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
            </div>
          )}
          
          {/* Chọn Ngày */}
          <div className={(!canSelectPg) ? "md:col-span-3" : ""}>
            <label className="block text-sm font-medium text-gray-700 mb-1">Ngày báo cáo</label>
            <input 
              type="date" 
              className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
            />
          </div>
        </div>

        {/* Khu vực Render dữ liệu */}
        {ordersError && (
          <div className="mb-4 p-4 text-red-700 bg-red-100 rounded-lg">
            <p className="font-bold">Lỗi khi tải dữ liệu đơn hàng:</p>
            <p>{(ordersError as Error).message}</p>
          </div>
        )}
        {loadingOrders ? (
          <div className="text-center py-10 text-indigo-600 font-medium">Đang tải dữ liệu từ máy chủ...</div>
        ) : !shouldFetch ? (
          <div className="text-center py-10 text-gray-500 bg-gray-50 rounded-lg border border-dashed border-gray-300">
            Vui lòng chọn nhân viên PG để bắt đầu xem báo cáo.
          </div>
        ) : reportData ? (
          <div className="space-y-8">
            {/* Thẻ KPI và Biểu đồ */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-1 grid grid-cols-2 lg:grid-cols-1 gap-4">
                <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100">
                  <p className="text-sm font-medium text-indigo-600">Nhân viên</p>
                  <p className="text-lg font-bold text-gray-900 truncate">{reportData.pgName}</p>
                </div>
                <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100">
                  <p className="text-sm font-medium text-indigo-600">Số đơn hàng</p>
                  <p className="text-lg font-bold text-gray-900">{reportData.uniqueCarts}</p>
                </div>
                <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100">
                  <p className="text-sm font-medium text-indigo-600">Doanh số ngày</p>
                  <p className="text-lg font-bold text-gray-900">
                    {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(reportData.dailyTotalAmount)}
                  </p>
                </div>
                <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100">
                  <p className="text-sm font-medium text-indigo-600">Tiến độ ngày</p>
                  <p className="text-lg font-bold text-gray-900">{reportData.dailyKpiProgress.toFixed(1)}%</p>
                </div>
                <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100">
                  <p className="text-sm font-medium text-indigo-600">Tiến độ tháng</p>
                  <p className="text-lg font-bold text-gray-900">{reportData.monthlyKpiProgress.toFixed(1)}%</p>
                </div>
                <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100">
                  <p className="text-sm font-medium text-indigo-600">Tỉ lệ chuyển đổi (SL)</p>
                  <p className="text-lg font-bold text-gray-900">{reportData.conversionRate.toFixed(1)}%</p>
                </div>
              </div>

              <div className="lg:col-span-2 bg-white p-5 rounded-xl border border-gray-200 shadow-sm relative min-h-[300px]">
                <h3 className="text-sm font-bold text-gray-500 mb-4 flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-indigo-500" />
                  BIỂU ĐỒ DOANH SỐ THEO NGÀY TRONG THÁNG
                </h3>
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={reportData.monthlyChartData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                      <XAxis 
                        dataKey="date" 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fontSize: 10, fill: '#6b7280' }} 
                      />
                      <YAxis 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fontSize: 10, fill: '#6b7280' }}
                        tickFormatter={(val) => `${(val / 1000000).toFixed(0)}M`}
                      />
                      <Tooltip 
                        formatter={(value: number) => [new Intl.NumberFormat('vi-VN').format(value) + 'đ', 'Doanh số']}
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}
                      />
                      <Bar 
                        dataKey="sales" 
                        fill="#818cf8" 
                        radius={[4, 4, 0, 0]} 
                        barSize={30}
                      />
                      <ReferenceLine 
                        y={reportData.averageSales} 
                        stroke="#f87171" 
                        strokeDasharray="5 5"
                        label={{ position: 'right', value: 'Avg', fill: '#f87171', fontSize: 10, fontWeight: 'bold' }} 
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Bảng Chi Tiết Tổng Hợp */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
              <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
                <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider">Tổng hợp sản phẩm bán trong ngày</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50/50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-bold text-gray-400 uppercase tracking-wider">Thương hiệu / Sản phẩm</th>
                      <th className="px-6 py-3 text-center text-xs font-bold text-gray-400 uppercase tracking-wider">Số lượng</th>
                      <th className="px-6 py-3 text-right text-xs font-bold text-gray-400 uppercase tracking-wider">Thành tiền</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {reportData.tableData.length > 0 ? (
                      reportData.tableData.map((row, i) => (
                        <tr key={i} className="hover:bg-gray-50 transition-colors">
                          <td className="px-6 py-4">
                            <div className="text-sm font-bold text-gray-900">{row.brand}</div>
                            <div className="text-sm text-gray-500">{row.product}</div>
                          </td>
                          <td className="px-6 py-4 text-center font-bold text-gray-900">{row.qty}</td>
                          <td className="px-6 py-4 text-right font-medium text-gray-900">
                            {new Intl.NumberFormat('vi-VN').format(row.amount)}đ
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={3} className="px-6 py-12 text-center text-gray-400 italic">
                          Chưa có dữ liệu bán hàng trong ngày này.
                        </td>
                      </tr>
                    )}
                  </tbody>
                  {reportData.tableData.length > 0 && (
                    <tfoot className="bg-indigo-50/30 font-bold border-t border-indigo-100">
                      <tr>
                        <td className="px-6 py-4 text-sm text-indigo-900 text-right uppercase">Tổng cộng:</td>
                        <td className="px-6 py-4 text-sm text-indigo-900 text-center text-lg">{reportData.dailyTotalQty}</td>
                        <td className="px-6 py-4 text-sm text-indigo-900 text-right text-lg">
                          {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(reportData.dailyTotalAmount)}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>

            {/* Danh sách đơn hàng chi tiết (Bill) */}
            <div className="space-y-4">
              <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2 px-2">
                <FileText className="w-5 h-5 text-indigo-600" />
                Danh sách đơn hàng chi tiết
              </h3>
              
              {reportData.detailedOrders.length > 0 ? (
                <div className="space-y-3">
                  {reportData.detailedOrders.map((order) => (
                    <div key={order.cart_id} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden transition-all hover:border-indigo-200">
                      <div 
                        className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer hover:bg-gray-50"
                        onClick={() => setExpandedCartId(expandedCartId === order.cart_id ? null : order.cart_id)}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">
                              Order #{order.cart_id.slice(-6).toUpperCase()}
                            </span>
                            <span className="text-xs text-gray-400">
                              {format(new Date(order.created_at), 'HH:mm')}
                            </span>
                          </div>
                          <div className="font-bold text-gray-900 truncate">
                            {order.customer_name || 'Khách vãng lai'}
                          </div>
                          {order.customer_phone && (
                            <div className="text-xs text-gray-500">{order.customer_phone}</div>
                          )}
                        </div>

                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <div className="text-xs text-gray-400 uppercase font-bold tracking-wider">Tổng tiền</div>
                            <div className="font-bold text-gray-900">
                              {new Intl.NumberFormat('vi-VN').format(order.totalAmount)}đ
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-2">
                            {order.bill_image_url && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setViewingBillUrl(order.bill_image_url);
                                }}
                                className="p-2 bg-pink-50 text-pink-600 rounded-lg hover:bg-pink-100 transition-colors"
                                title="Xem Bill"
                              >
                                <ImageIcon className="w-4 h-4" />
                              </button>
                            )}
                            <div className="text-gray-400">
                              {expandedCartId === order.cart_id ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                            </div>
                          </div>
                        </div>
                      </div>

                      {expandedCartId === order.cart_id && (
                        <div className="bg-gray-50/50 p-4 border-t border-gray-100">
                          <div className="space-y-2">
                            {order.items.map((item: any, idx: number) => (
                              <div key={idx} className="flex justify-between items-center bg-white p-3 rounded-lg border border-gray-100 shadow-sm text-sm">
                                <div className="flex-1">
                                  <div className="font-bold text-gray-800">{item.product_name}</div>
                                  <div className="text-[10px] text-gray-400 uppercase font-medium">{item.brand_name}</div>
                                </div>
                                <div className="flex items-center gap-8">
                                  <div className="text-gray-600">x{item.qty}</div>
                                  <div className="font-bold text-gray-900 min-w-[100px] text-right">
                                    {new Intl.NumberFormat('vi-VN').format(item.net_value)}đ
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="bg-gray-50 border border-dashed border-gray-300 rounded-xl py-12 text-center text-gray-400 italic">
                  Không tìm thấy đơn hàng chi tiết nào.
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {/* Modal xem Bill */}
      {viewingBillUrl && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="relative max-w-4xl w-full h-full flex items-center justify-center">
            <button 
              onClick={() => setViewingBillUrl(null)}
              className="absolute top-0 right-0 m-4 p-2 bg-white/20 hover:bg-white/40 text-white rounded-full transition-colors z-[101]"
            >
              <X className="w-6 h-6" />
            </button>
            <div className="w-full h-full flex flex-col items-center justify-center">
              <div className="max-w-full max-h-full overflow-auto rounded-lg">
                <img 
                  src={viewingBillUrl} 
                  alt="Bill" 
                  className="max-w-full max-h-[85vh] object-contain shadow-2xl"
                  onDoubleClick={() => window.open(viewingBillUrl, '_blank')}
                  title="Double click để xem ảnh gốc"
                />
              </div>
              <div className="mt-4 text-white text-center">
                <p className="text-sm font-medium opacity-80">Gợi ý: Double click vào ảnh để xem kích thước đầy đủ</p>
                <button 
                  onClick={() => setViewingBillUrl(null)}
                  className="mt-4 px-6 py-2 bg-white text-gray-900 rounded-full font-bold hover:bg-gray-200 transition-colors"
                >
                  Đóng
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}