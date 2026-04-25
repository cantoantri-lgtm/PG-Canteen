import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { BarChart3, PieChart as PieChartIcon, TrendingUp, Users } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts';

const getRel = (val: any) => Array.isArray(val) ? val[0] : val;
const COLORS = ['#818cf8', '#34d399', '#fbbf24', '#f87171', '#a78bfa', '#60a5fa', '#f472b6', '#fb923c'];

const getGmt7DateStr = (dateVal: string | Date | number) => {
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return '';
  const gmt7Date = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  return gmt7Date.toISOString().split('T')[0];
};

export default function SupReport() {
  const { user } = useAuth();
  
  const [startDate, setStartDate] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'));

  const [selectedManagerId, setSelectedManagerId] = useState<string>('');
  const [selectedProgramId, setSelectedProgramId] = useState<string>('');

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

  const { data: programs = [] } = useQuery({
    queryKey: ['programs'],
    queryFn: async () => {
      const { data } = await supabase.from('programs').select('program_id, program_name').order('program_name');
      return data || [];
    }
  });

  const { data: shops = [] } = useQuery({
    queryKey: ['shops'],
    queryFn: async () => {
      const { data } = await supabase.from('shops').select('shop_id, shop_name');
      return data || [];
    }
  });

  const { isAdmin, isSup } = useMemo(() => {
    const matchedRole = roles.find(r => r.role_id === user?.role_id);
    const roleName = (matchedRole?.role_name || '').toUpperCase();
    return {
      isAdmin: user?.admin_role === true || roleName === 'ADMIN' || user?.email === 'can.toantri@gmail.com',
      isSup: roleName === 'SUP'
    };
  }, [roles, user?.role_id, user?.admin_role, user?.email]);

  const managers = useMemo(() => {
    return allProfiles.filter(p => {
      const rName = roles.find(r => r.role_id === p.role_id)?.role_name?.toUpperCase() || '';
      return p.admin_role || rName === 'SUP' || rName === 'ADMIN';
    });
  }, [allProfiles, roles]);

  const managedPGs = useMemo(() => {
    if (isAdmin) {
      if (selectedManagerId) return allProfiles.filter(p => p.manager_id === selectedManagerId && !p.admin_role);
      return allProfiles.filter(p => !p.admin_role);
    }
    if (isSup) {
      return allProfiles.filter(p => p.manager_id === user?.id && !p.admin_role);
    }
    return [];
  }, [allProfiles, isAdmin, isSup, selectedManagerId, user?.id]);

  const managedPgIds = managedPGs.map(p => p.id);

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['sup_report_orders', managedPgIds, startDate, endDate, selectedProgramId],
    queryFn: async () => {
      if (managedPgIds.length === 0) return [];
      
      let query = supabase
        .from('order_details')
        .select(`
          id, qty, net_value, switched_from_brand,
          orders!inner(cart_id, created_at, pg_id, program_id, shop_id),
          products(
            product_name,
            product_group!inner(name)
          )
        `)
        .in('orders.pg_id', managedPgIds)
        .gte('orders.created_at', new Date(`${startDate}T00:00:00+07:00`).toISOString())
        .lte('orders.created_at', new Date(`${endDate}T23:59:59+07:00`).toISOString());
        
      if (selectedProgramId) {
        query = query.eq('orders.program_id', selectedProgramId);
      }
        
      const { data, error } = await query;
        
      if (error) throw error;
      
      return (data || []).map((item: any) => {
        const order = getRel(item.orders);
        const product = getRel(item.products);
        const productGroup = getRel(product?.product_group);

        return {
          id: item.id,
          qty: Number(item.qty) || 0,
          net_value: Number(item.net_value) || 0,
          created_at: order?.created_at,
          pg_id: order?.pg_id,
          shop_id: order?.shop_id,
          product_name: product?.product_name || 'Không xác định',
          group_name: productGroup?.name || 'Không xác định',
        };
      });
    },
    enabled: managedPgIds.length > 0 && !!startDate && !!endDate,
  });

  const reportData = useMemo(() => {
    if (!orders.length) return null;

    const todayStr = getGmt7DateStr(new Date());
    let todaySales = 0;
    let totalSales = 0;

    const shopSalesMap = new Map();
    const dateSalesMap = new Map();
    const groupSalesMap = new Map();
    const productSalesMap = new Map();

    orders.forEach(o => {
      const orderDateStr = getGmt7DateStr(o.created_at);
      if (orderDateStr === todayStr) {
        todaySales += o.net_value;
      }
      totalSales += o.net_value;

      // Shop Sales
      const shopName = shops.find(s => s.shop_id === o.shop_id)?.shop_name || 'Không xác định';
      shopSalesMap.set(shopName, (shopSalesMap.get(shopName) || 0) + o.net_value);

      // Date Sales
      dateSalesMap.set(orderDateStr, (dateSalesMap.get(orderDateStr) || 0) + o.net_value);

      // Group Sales
      const gName = o.group_name;
      groupSalesMap.set(gName, (groupSalesMap.get(gName) || 0) + o.net_value);

      // Product table
      const pName = o.product_name;
      if (!productSalesMap.has(pName)) {
        productSalesMap.set(pName, { product_name: pName, group_name: gName, qty: 0, amount: 0 });
      }
      const item = productSalesMap.get(pName);
      item.qty += o.qty;
      item.amount += o.net_value;
    });

    const shopRanking = Array.from(shopSalesMap.entries())
      .map(([name, sales]) => ({ name, sales }))
      .sort((a, b) => b.sales - a.sales);

    const dateData = Array.from(dateSalesMap.entries())
      .map(([date, sales]) => ({ date: format(new Date(date), 'dd/MM'), fullDate: date, sales }))
      .sort((a, b) => new Date(a.fullDate).getTime() - new Date(b.fullDate).getTime());

    const groupData = Array.from(groupSalesMap.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    const productRanking = Array.from(productSalesMap.values())
      .sort((a, b) => b.amount - a.amount);

    return {
      todaySales,
      totalSales,
      shopRanking,
      dateData,
      groupData,
      productRanking
    };
  }, [orders, shops]);

  if (!isAdmin && !isSup) return <div className="p-10 text-center font-medium text-gray-500">Bạn không có quyền truy cập trang này.</div>;

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-10 px-4">
      <div className="pt-6">
        <h2 className="text-2xl font-bold text-gray-900">Báo Cáo Tổng Hợp (SUP)</h2>
      </div>

      <div className="bg-white shadow rounded-lg p-6 border border-gray-200">
        <div className={`grid grid-cols-1 ${isAdmin ? 'md:grid-cols-4' : 'md:grid-cols-3'} gap-4 mb-6`}>
          {isAdmin && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Quản lý (SUP)</label>
              <select 
                className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
                value={selectedManagerId}
                onChange={(e) => setSelectedManagerId(e.target.value)}
              >
                <option value="">-- Tất cả Quản lý --</option>
                {managers.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Chương trình</label>
            <select 
              className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
              value={selectedProgramId}
              onChange={(e) => setSelectedProgramId(e.target.value)}
            >
              <option value="">-- Tất cả Chương trình --</option>
              {programs.map(p => <option key={p.program_id} value={p.program_id}>{p.program_name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Từ ngày</label>
            <input 
              type="date" 
              className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Đến ngày</label>
            <input 
              type="date" 
              className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
        </div>

        {isLoading ? (
          <div className="text-center py-10 text-indigo-600 font-medium">Đang tải dữ liệu...</div>
        ) : !reportData ? (
          <div className="text-center py-10 text-gray-500 bg-gray-50 rounded-lg border border-dashed border-gray-300">
            Không có dữ liệu trong khoảng thời gian này.
          </div>
        ) : (
          <div className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-indigo-50 p-6 rounded-xl border border-indigo-100 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-indigo-600 mb-1">Doanh số hôm nay</p>
                  <p className="text-3xl font-bold text-gray-900">
                    {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(reportData.todaySales)}
                  </p>
                </div>
                <div className="p-3 bg-white rounded-full shadow-sm">
                  <TrendingUp className="w-8 h-8 text-indigo-500" />
                </div>
              </div>
              <div className="bg-green-50 p-6 rounded-xl border border-green-100 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-green-600 mb-1">Doanh số luỹ kế</p>
                  <p className="text-3xl font-bold text-gray-900">
                    {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(reportData.totalSales)}
                  </p>
                  <p className="text-xs text-green-700 mt-1">Từ {format(new Date(startDate), 'dd/MM/yyyy')} đến {format(new Date(endDate), 'dd/MM/yyyy')}</p>
                </div>
                <div className="p-3 bg-white rounded-full shadow-sm">
                  <BarChart3 className="w-8 h-8 text-green-500" />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Biểu đồ cột ngang xếp hạng Shop */}
              <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm relative min-h-[350px]">
                <h3 className="text-sm font-bold text-gray-500 mb-4 flex items-center gap-2 uppercase">
                  <BarChart3 className="w-4 h-4 text-indigo-500" />
                  Xếp hạng doanh số Cửa hàng
                </h3>
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart layout="vertical" data={reportData.shopRanking} margin={{ top: 20, right: 30, left: 10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
                      <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 10 }} tickFormatter={(val) => `${(val / 1000000).toFixed(0)}M`} />
                      <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fontSize: 10 }} width={80} />
                      <RechartsTooltip formatter={(value: number) => [new Intl.NumberFormat('vi-VN').format(value) + 'đ', 'Doanh số']} cursor={{fill: '#f3f4f6'}} />
                      <Bar dataKey="sales" fill="#818cf8" radius={[0, 4, 4, 0]} barSize={20} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Biểu đồ cột đứng (Lịch sử theo ngày) */}
              <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm relative min-h-[350px]">
                <h3 className="text-sm font-bold text-gray-500 mb-4 flex items-center gap-2 uppercase">
                  <TrendingUp className="w-4 h-4 text-emerald-500" />
                  Doanh số lũy kế từ ngày đến ngày
                </h3>
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={reportData.dateData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                      <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 10 }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10 }} tickFormatter={(val) => `${(val / 1000000).toFixed(0)}M`} />
                      <RechartsTooltip formatter={(value: number) => [new Intl.NumberFormat('vi-VN').format(value) + 'đ', 'Doanh số']} cursor={{fill: '#f3f4f6'}} />
                      <Bar dataKey="sales" fill="#34d399" radius={[4, 4, 0, 0]} barSize={40} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Biểu đồ tròn tỉ trọng ngành hàng */}
              <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm relative min-h-[350px]">
                <h3 className="text-sm font-bold text-gray-500 mb-4 flex items-center gap-2 uppercase">
                  <PieChartIcon className="w-4 h-4 text-pink-500" />
                  Tỉ trọng doanh số nhóm hàng
                </h3>
                <div className="h-[300px] w-full border border-gray-100 rounded-lg">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={reportData.groupData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={95}
                        paddingAngle={3}
                        dataKey="value"
                      >
                        {reportData.groupData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <RechartsTooltip formatter={(value: number) => [new Intl.NumberFormat('vi-VN').format(value) + 'đ', 'Doanh số']} />
                      <Legend verticalAlign="bottom" height={40} wrapperStyle={{ fontSize: '11px' }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
              
              {/* Bảng xếp hạng doanh số sản phẩm */}
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm flex flex-col h-[350px]">
                <div className="bg-gray-50 px-5 py-3 border-b border-gray-200">
                  <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider">Xếp hạng doanh số luỹ kế sản phẩm</h3>
                </div>
                <div className="overflow-y-auto flex-1 bg-white">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50/50 sticky top-0 z-10 shadow-sm">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-bold text-gray-500 uppercase">Sản phẩm</th>
                        <th className="px-4 py-2 text-center text-xs font-bold text-gray-500 uppercase">SL</th>
                        <th className="px-4 py-2 text-right text-xs font-bold text-gray-500 uppercase">Doanh số</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {reportData.productRanking.map((row, i) => (
                        <tr key={i} className="hover:bg-gray-50 max-h-12 overflow-hidden">
                          <td className="px-4 py-2">
                            <div className="text-sm font-semibold text-gray-900 line-clamp-1" title={row.product_name}>{row.product_name}</div>
                            <div className="text-[10px] text-gray-500">{row.group_name}</div>
                          </td>
                          <td className="px-4 py-2 text-center text-sm text-gray-900">{row.qty}</td>
                          <td className="px-4 py-2 text-right text-sm font-bold text-indigo-600">
                            {new Intl.NumberFormat('vi-VN').format(row.amount)}đ
                          </td>
                        </tr>
                      ))}
                      {reportData.productRanking.length === 0 && (
                        <tr>
                          <td colSpan={3} className="px-4 py-8 text-center text-gray-500 italic text-sm">Không có dữ liệu.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

            </div>
          </div>
        )}
      </div>
    </div>
  );
}
