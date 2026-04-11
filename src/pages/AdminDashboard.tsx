import React, { useState, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDaysInMonth, isSunday } from 'date-fns';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, ComposedChart
} from 'recharts';
import { useQuery } from '@tanstack/react-query';
import { useRealtimeSync } from '../hooks/useRealtimeSync';
import { ArrowUp, ArrowDown, Sparkles, Mail, CheckCircle2 } from 'lucide-react';
import { PGDetailModal } from '../components/PGDetailModal';
import { SmartReportModal } from '../components/SmartReportModal';
import { useSmartReport } from '../hooks/useSmartReport';

interface DashboardData {
  totalRevenue: number;
  totalTarget: number;
  totalPGs: number;
  conversionRate: number;
  switchOrdersCount: number;
  totalOrdersCount: number;
  dailyData: any[];
  brandData: any[];
  productData: any[];
  pgRankings: any[];
}

interface MasterData {
  shops: any[];
  brands: any[];
  products: any[];
  profiles: any[];
  kpis: any[];
  schedules: any[];
}

export default function AdminDashboard() {
  const [startDateInput, setStartDateInput] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [endDateInput, setEndDateInput] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'));
  const [selectedShopInput, setSelectedShopInput] = useState('');
  const [selectedBrandInput, setSelectedBrandInput] = useState('');
  const [selectedProductInput, setSelectedProductInput] = useState('');
  const [selectedManagerInput, setSelectedManagerInput] = useState('');

  const [appliedFilters, setAppliedFilters] = useState({
    startDate: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
    endDate: format(endOfMonth(new Date()), 'yyyy-MM-dd'),
    shopId: '',
    brandId: '',
    productId: '',
    managerId: ''
  });

  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' }>({ key: 'achievement', direction: 'desc' });
  const [selectedPgForModal, setSelectedPgForModal] = useState<{ id: string, name: string, kpi: number } | null>(null);
  const [showSmartReport, setShowSmartReport] = useState(false);

  const { data: masterData, isLoading: loadingMaster } = useQuery({
    queryKey: ['masterData'],
    queryFn: async () => {
      const [shopsRes, brandsRes, productsRes, profilesRes, kpisRes, schedulesRes] = await Promise.all([
        supabase.from('shops').select('*').order('shop_name'),
        supabase.from('brands').select('*').order('brand_name'),
        supabase.from('products').select('*'),
        supabase.from('profiles').select('*').order('full_name'),
        supabase.from('kpis').select('*'),
        supabase.from('schedules').select('*')
      ]);

      if (shopsRes.error) console.error('Lỗi tải shops:', shopsRes.error);
      if (brandsRes.error) console.error('Lỗi tải brands:', brandsRes.error);
      if (productsRes.error) console.error('Lỗi tải products:', productsRes.error);
      if (profilesRes.error) console.error('Lỗi tải profiles:', profilesRes.error);
      if (kpisRes.error) console.error('Lỗi tải kpis:', kpisRes.error);
      if (schedulesRes.error) console.error('Lỗi tải schedules:', schedulesRes.error);

      return {
        shops: shopsRes.data || [],
        brands: brandsRes.data || [],
        products: productsRes.data || [],
        profiles: profilesRes.data || [],
        kpis: kpisRes.data || [],
        schedules: schedulesRes.data || []
      } as MasterData;
    },
    retry: false
  });

  const { report: smartReportData } = useSmartReport(masterData, true, appliedFilters.endDate);

  const { data: ordersData = [], isLoading: loadingOrders } = useQuery({
    queryKey: ['orders', appliedFilters.startDate, appliedFilters.endDate],
    queryFn: async () => {
      const start = new Date(appliedFilters.startDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(appliedFilters.endDate);
      end.setHours(23, 59, 59, 999);

      const { data, error } = await supabase
        .from('orders')
        .select('*, profiles(full_name)')
        .gte('created_at', start.toISOString())
        .lte('created_at', end.toISOString());

      if (error) {
        console.error('Lỗi tải đơn hàng:', error);
        return [];
      }
      return data || [];
    },
    retry: false
  });

  const orderSyncConfig = useMemo(() => ({
    table: 'orders',
    queryKey: ['orders', appliedFilters.startDate, appliedFilters.endDate],
    idColumn: 'order_id',
    selectQuery: '*, profiles(full_name)'
  }), [appliedFilters.startDate, appliedFilters.endDate]);
  
  useRealtimeSync(orderSyncConfig);

  const handleApplyFilter = () => {
    setAppliedFilters({
      startDate: startDateInput,
      endDate: endDateInput,
      shopId: selectedShopInput,
      brandId: selectedBrandInput,
      productId: selectedProductInput,
      managerId: selectedManagerInput
    });
  };

  const data = useMemo<DashboardData | null>(() => {
    if (!masterData || !ordersData) return null;

    let filteredOrders = [...ordersData];
    const { shopId, brandId, productId, startDate, endDate } = appliedFilters;

    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    if (brandId) {
      const productIds = masterData.products.filter(p => p.brand_id === brandId).map(p => p.product_id);
      filteredOrders = filteredOrders.filter(o => productIds.includes(o.product_id));
    }

    if (productId) {
      filteredOrders = filteredOrders.filter(o => o.product_id === productId);
    }
    
    const { managerId, shopId: filterShopId } = appliedFilters;

    let activePgIds = masterData.profiles.filter(p => !p.admin_role).map(p => p.id);
    
    if (managerId) {
      activePgIds = activePgIds.filter(id => {
        const pg = masterData.profiles.find(p => p.id === id);
        return pg?.manager_id === managerId;
      });
    }

    if (filterShopId) {
      const shopPgIds = masterData.schedules.filter(s => s.shop_id === filterShopId).map(s => s.pg_id);
      activePgIds = activePgIds.filter(id => shopPgIds.includes(id));
    }
    
    filteredOrders = filteredOrders.filter(o => activePgIds.includes(o.pg_id));

    const totalOrdersCount = filteredOrders.length;
    const switchOrdersCount = filteredOrders.filter(o => o.is_competitor_product === true).length;
    const conversionRate = totalOrdersCount > 0 ? (switchOrdersCount / totalOrdersCount) * 100 : 0;

    const totalRevenue = filteredOrders.reduce((sum, o) => sum + Number(o.net_value), 0);
    const activeKpis = masterData.kpis.filter(k => activePgIds.includes(k.pg_id));
    const totalTarget = activeKpis.reduce((sum, k) => sum + Number(k.sale_target), 0);
    const totalPGs = new Set(filteredOrders.map(o => o.pg_id)).size;

    let daysArray: Date[] = [];
    if (!isNaN(start.getTime()) && !isNaN(end.getTime()) && start <= end) {
      try {
        daysArray = eachDayOfInterval({ start, end });
      } catch (e) {
        daysArray = [new Date()];
      }
    } else {
      daysArray = [new Date()];
    }

    const monthDays = eachDayOfInterval({ start: startOfMonth(start), end: endOfMonth(start) });
    const workingDaysInMonth = monthDays.filter(d => !isSunday(d)).length || 1;

    const dailyKPI = totalTarget / workingDaysInMonth;
    let cumulativeRevenue = 0;
    let cumulativeIdeal = 0;

    const ordersByDay: Record<string, any[]> = {};
    filteredOrders.forEach(o => {
      if (!o.created_at) return;
      const orderDate = new Date(o.created_at);
      if (isNaN(orderDate.getTime())) return;
      const dayStr = format(orderDate, 'yyyy-MM-dd');
      if (!ordersByDay[dayStr]) ordersByDay[dayStr] = [];
      ordersByDay[dayStr].push(o);
    });

    const todayStr = format(new Date(), 'yyyy-MM-dd');

    const dailyData = daysArray.map((day) => {
      const dayStr = format(day, 'yyyy-MM-dd');
      const dailyOrders = ordersByDay[dayStr] || [];
      const dailyRevenue = dailyOrders.reduce((sum, o) => sum + Number(o.net_value || 0), 0);
      
      if (!isSunday(day)) {
        cumulativeIdeal += dailyKPI;
      }
      const percentIdeal = totalTarget > 0 ? (cumulativeIdeal / totalTarget) * 100 : 0;

      let percentActual: number | null = null;
      let labelText = '';
      
      const isPastOrToday = dayStr <= todayStr;
      const isToday = dayStr === todayStr;

      if (isPastOrToday) {
        cumulativeRevenue += dailyRevenue;
        percentActual = totalTarget > 0 ? (cumulativeRevenue / totalTarget) * 100 : 0;
        
        if ((dailyRevenue > 0) || (isToday && cumulativeRevenue > 0)) {
           labelText = `${Math.round(percentActual)}%`;
        }
      }

      return {
        date: format(day, 'dd/MM'),
        'Doanh số ngày': dailyRevenue,
        'KPI ngày': dailyKPI,
        'Lũy kế thực tế': cumulativeRevenue,
        'Đường tiêu chuẩn 45°': cumulativeIdeal,
        'Tỉ lệ thực tế (%)': percentActual !== null ? Number(percentActual.toFixed(1)) : null,
        'Tỉ lệ chuẩn (%)': Math.min(100, Number(percentIdeal.toFixed(1))),
        'Label': labelText
      };
    });

    const brandMap: Record<string, number> = {};
    const productMap: Record<string, number> = {};

    filteredOrders.forEach(order => {
      const val = Number(order.net_value);
      const product = masterData.products.find(p => p.product_id === order.product_id);
      const brand = masterData.brands.find(b => b.brand_id === product?.brand_id);

      if (product) productMap[product.product_name] = (productMap[product.product_name] || 0) + val;
      if (brand) brandMap[brand.brand_name] = (brandMap[brand.brand_name] || 0) + val;
    });

    const brandData = Object.entries(brandMap).map(([name, value]) => ({ name, value })).sort((a,b) => b.value - a.value);
    const productData = Object.entries(productMap).map(([name, value]) => ({ name, value })).sort((a,b) => b.value - a.value).slice(0, 5);

    const pgMap: Record<string, { id: string, name: string, shopName: string, sales: number, dailySales: number, kpi: number, dailyKpi: number }> = {};

    activePgIds.forEach(pgId => {
      const pgInfo = masterData.profiles.find(p => p.id === pgId);
      if (pgInfo) {
        const pgKpi = activeKpis.find(k => k.pg_id === pgId)?.sale_target || 1;
        const dailyKpi = Number(pgKpi) / workingDaysInMonth;
        
        const pgSchedules = masterData.schedules.filter(s => s.pg_id === pgId);
        const shopNames = pgSchedules.map(s => {
          const shop = masterData.shops.find(c => c.shop_id === s.shop_id);
          return shop ? shop.shop_name : '';
        }).filter(Boolean);
        const uniqueShopNames = Array.from(new Set(shopNames)).join(', ');

        pgMap[pgId] = { 
          id: pgId, 
          name: pgInfo.full_name, 
          shopName: uniqueShopNames || 'Chưa phân công',
          sales: 0, 
          dailySales: 0,
          kpi: Number(pgKpi),
          dailyKpi
        };
      }
    });

    filteredOrders.forEach(order => {
      if (pgMap[order.pg_id]) {
        const val = Number(order.net_value);
        pgMap[order.pg_id].sales += val;
        
        const orderDate = order.created_at ? format(new Date(order.created_at), 'yyyy-MM-dd') : '';
        if (orderDate === todayStr) {
          pgMap[order.pg_id].dailySales += val;
        }
      }
    });

    const pgRankings = Object.values(pgMap)
      .map(pg => ({ 
        ...pg, 
        achievement: (pg.sales / pg.kpi) * 100,
        dailyAchievement: pg.dailyKpi > 0 ? (pg.dailySales / pg.dailyKpi) * 100 : 0
      }))
      .filter(pg => pg.sales > 0 || pg.kpi > 1);

    const monthStart = startOfMonth(end);
    let workingDaysPassed = 0;
    try {
      const daysUpToEnd = eachDayOfInterval({ start: monthStart, end: end });
      workingDaysPassed = daysUpToEnd.filter(d => !isSunday(d)).length;
    } catch (e) {
      workingDaysPassed = 0;
    }
    const standardProgressPercent = Math.min(100, (workingDaysPassed / workingDaysInMonth) * 100);

    return {
      totalRevenue, totalTarget, totalPGs, conversionRate, switchOrdersCount, totalOrdersCount,
      dailyData, brandData, productData, pgRankings, standardProgressPercent
    };
  }, [masterData, ordersData, appliedFilters]);

  const COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#8b5cf6'];
  const formatCurrency = (val: number) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(val);

  const sortedPgRankings = useMemo(() => {
    if (!data) return [];
    let sortableItems = [...data.pgRankings];
    sortableItems.sort((a: any, b: any) => {
      if (a[sortConfig.key] < b[sortConfig.key]) {
        return sortConfig.direction === 'asc' ? -1 : 1;
      }
      if (a[sortConfig.key] > b[sortConfig.key]) {
        return sortConfig.direction === 'asc' ? 1 : -1;
      }
      return 0;
    });
    return sortableItems;
  }, [data?.pgRankings, sortConfig]);

  const requestSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'desc';
    if (sortConfig.key === key && sortConfig.direction === 'desc') {
      direction = 'asc';
    }
    setSortConfig({ key, direction });
  };

  const getSortIcon = (key: string) => {
    if (sortConfig.key !== key) return null;
    return sortConfig.direction === 'asc' ? <ArrowUp className="w-4 h-4 inline-block ml-1" /> : <ArrowDown className="w-4 h-4 inline-block ml-1" />;
  };

  const handleSendEmail = async () => {
    if (!data || !smartReportData) {
      alert('Dữ liệu đang được tải, vui lòng thử lại sau.');
      return;
    }

    const formatCurrency = (val: number) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(val);

    let emailBody = `Đây là báo cáo tự động được gửi từ ứng dụng DUC PG Activation Web APP.\n\n`;

    emailBody += `--- 1. TỔNG QUAN ---\n`;
    emailBody += `- Tổng doanh thu: ${formatCurrency(data.totalRevenue)}\n`;
    emailBody += `- Tổng KPI: ${formatCurrency(data.totalTarget)}\n`;
    emailBody += `- Tiến độ KPI: ${data.totalTarget > 0 ? ((data.totalRevenue / data.totalTarget) * 100).toFixed(1) : 0}%\n`;
    emailBody += `- Tỉ lệ chuyển đổi: ${data.conversionRate.toFixed(1)}%\n`;
    emailBody += `- Tổng số đơn hàng: ${data.totalOrdersCount}\n`;
    emailBody += `- Tổng số PG hoạt động: ${data.totalPGs}\n\n`;

    emailBody += `--- 2. BÁO CÁO NGÀY ---\n`;
    emailBody += `- ${smartReportData.daily.summary.kpiText}\n`;
    emailBody += `- ${smartReportData.daily.summary.periodText}\n`;
    if (smartReportData.daily.summary.highlights.length > 0) {
      emailBody += `- Điểm sáng:\n  + ${smartReportData.daily.summary.highlights.join('\n  + ')}\n`;
    }
    if (smartReportData.daily.recommendations.length > 0) {
      emailBody += `- Đề xuất & Cảnh báo:\n`;
      smartReportData.daily.recommendations.forEach((rec: any) => {
        emailBody += `  + ${rec.title}: ${rec.problem}\n`;
      });
    }
    emailBody += `\n`;

    emailBody += `--- 3. BÁO CÁO THÁNG ---\n`;
    emailBody += `- ${smartReportData.monthly.summary.kpiText}\n`;
    emailBody += `- ${smartReportData.monthly.summary.periodText}\n`;
    if (smartReportData.monthly.summary.highlights.length > 0) {
      emailBody += `- Điểm sáng:\n  + ${smartReportData.monthly.summary.highlights.join('\n  + ')}\n`;
    }
    if (smartReportData.monthly.recommendations.length > 0) {
      emailBody += `- Đề xuất & Cảnh báo:\n`;
      smartReportData.monthly.recommendations.forEach((rec: any) => {
        emailBody += `  + ${rec.title}: ${rec.problem}\n`;
      });
    }
    emailBody += `\n`;

    emailBody += `Vui lòng xem chi tiết trên hệ thống Admin Dashboard.`;

    const subject = encodeURIComponent(`Báo cáo bán hàng PG cửa hàng - ${format(new Date(), 'dd/MM/yyyy')}`);
    const body = encodeURIComponent(emailBody);
    
    const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=cantoantri@gmail.com&su=${subject}&body=${body}`;
    window.open(gmailUrl, '_blank');
    
    setTimeout(() => {
      alert('Hệ thống đã mở tab Gmail chứa nội dung báo cáo tổng hợp. Vui lòng kiểm tra và gửi!');
    }, 500);
  };

  const loading = loadingMaster || loadingOrders;

  if (loadingMaster) {
    return <div className="p-8 text-center text-indigo-600 font-semibold animate-pulse">Đang nạp hệ thống phân tích...</div>;
  }

  return (
    <div className="space-y-6 pb-12">
      <div className="sm:flex sm:items-center sm:justify-between mb-2">
        <h2 className="text-2xl font-bold text-gray-900">Báo cáo & Phân tích chuyên sâu</h2>
        <div className="mt-3 sm:mt-0 flex space-x-3">
          <button 
            onClick={handleSendEmail}
            className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-gray-700 shadow-sm hover:bg-gray-50 transition-all"
          >
            <Mail className="w-4 h-4 mr-2 text-gray-500" />
            Gửi Email Báo Cáo
          </button>
          <button 
            onClick={() => setShowSmartReport(true)}
            className="inline-flex items-center justify-center rounded-md border border-transparent bg-gradient-to-r from-purple-600 to-indigo-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:from-purple-700 hover:to-indigo-700 transition-all"
          >
            <Sparkles className="w-4 h-4 mr-2 text-yellow-300" />
            Báo Cáo Thông Minh (AI)
          </button>
        </div>
      </div>

      <div className="bg-white p-5 rounded-lg shadow-sm border border-gray-200 mb-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4 items-end">
        <div className="w-full">
          <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Từ ngày</label>
          <input type="date" value={startDateInput} onChange={e => setStartDateInput(e.target.value)} className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2 bg-gray-50"/>
        </div>
        <div className="w-full">
          <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Đến ngày</label>
          <input type="date" value={endDateInput} onChange={e => setEndDateInput(e.target.value)} className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2 bg-gray-50"/>
        </div>
        <div className="w-full">
          <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Cửa hàng</label>
          <select value={selectedShopInput} onChange={e => setSelectedShopInput(e.target.value)} className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2 bg-white">
            <option value="">-- Tất cả Cửa hàng --</option>
            {masterData?.shops.map(s => <option key={s.shop_id} value={s.shop_id}>{s.shop_name}</option>)}
          </select>
        </div>
        <div className="w-full">
          <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Nhãn hàng</label>
          <select value={selectedBrandInput} onChange={e => {
            setSelectedBrandInput(e.target.value);
            setSelectedProductInput('');
          }} className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2 bg-white">
            <option value="">-- Tất cả Nhãn --</option>
            {masterData?.brands.map(b => <option key={b.brand_id} value={b.brand_id}>{b.brand_name}</option>)}
          </select>
        </div>
        <div className="w-full">
          <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Sản phẩm</label>
          <select value={selectedProductInput} onChange={e => setSelectedProductInput(e.target.value)} className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2 bg-white">
            <option value="">-- Tất cả SP --</option>
            {masterData?.products
              .filter(p => !selectedBrandInput || p.brand_id === selectedBrandInput)
              .map(p => <option key={p.product_id} value={p.product_id}>{p.product_name}</option>)}
          </select>
        </div>
        <div className="w-full">
          <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Quản lý</label>
          <select value={selectedManagerInput} onChange={e => setSelectedManagerInput(e.target.value)} className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2 bg-white">
            <option value="">-- Tất cả Quản lý --</option>
            {masterData?.profiles
              .filter(p => masterData.profiles.some(sub => sub.manager_id === p.id))
              .map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
          </select>
        </div>
        <div className="w-full">
          <button 
            onClick={handleApplyFilter} 
            disabled={loading}
            className="w-full inline-flex items-center justify-center rounded-md border border-transparent bg-indigo-600 px-6 py-2 text-sm font-bold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? 'Đang lọc...' : 'Lọc Dữ Liệu'}
          </button>
        </div>
      </div>

      {loadingOrders && data ? <div className="text-center text-sm text-gray-500 animate-pulse">Đang tính toán lại dữ liệu...</div> : null}

      {data && (
        <>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <div className="overflow-hidden rounded-lg bg-white shadow border-l-4 border-indigo-500 p-5 relative">
              <dt className="truncate text-sm font-medium text-gray-500">Tổng doanh thu</dt>
              <dd className="mt-1 text-2xl font-bold text-gray-900">{formatCurrency(data.totalRevenue)}</dd>
            </div>
            <div className="overflow-hidden rounded-lg bg-white shadow border-l-4 border-green-500 p-5">
              <dt className="truncate text-sm font-medium text-gray-500">PG phát sinh doanh số</dt>
              <dd className="mt-1 text-2xl font-bold text-gray-900">{data.totalPGs} <span className="text-sm font-normal text-gray-500">nhân sự</span></dd>
            </div>
            <div className="overflow-hidden rounded-lg bg-white shadow border-l-4 border-amber-500 p-5">
              <dt className="truncate text-sm font-medium text-gray-500">Tỉ lệ hoàn thành KPI</dt>
              <dd className="mt-1 text-2xl font-bold text-gray-900">
                {data.totalTarget > 0 ? ((data.totalRevenue / data.totalTarget) * 100).toFixed(1) : 0}%
              </dd>
            </div>
            <div className="overflow-hidden rounded-lg bg-white shadow border-l-4 border-rose-500 p-5 relative group">
              <dt className="truncate text-sm font-medium text-gray-500">Tỉ lệ CĐ (Khách từ đối thủ)</dt>
              <dd className="mt-1 text-2xl font-bold text-rose-600">{data.conversionRate.toFixed(1)}%</dd>
              <div className="text-xs text-gray-400 mt-1">{data.switchOrdersCount} / {data.totalOrdersCount} đơn hàng</div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="bg-white shadow rounded-lg p-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Lũy kế tiến độ đạt KPI (%)</h3>
              <div className="h-80 w-full">
                <ResponsiveContainer width="99%" height="100%">
                  <LineChart data={data.dailyData} margin={{ top: 30, right: 30, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="date" tick={{fontSize: 12}} minTickGap={20} />
                    <YAxis 
                      tickFormatter={(val) => `${val}%`} 
                      width={50} 
                      domain={[0, 100]} 
                    />
                    <Tooltip formatter={(value: number) => `${value}%`} />
                    <Legend verticalAlign="top" height={36} iconType="circle" wrapperStyle={{ fontSize: '14px', fontWeight: 600 }} />
                    <Line 
                      name="Tiến độ chuẩn"
                      type="linear" 
                      dataKey="Tỉ lệ chuẩn (%)" 
                      stroke="#0ea5e9" 
                      strokeWidth={2} 
                      strokeDasharray="5 5" 
                      dot={false} 
                    />
                    <Line 
                      name="Tiến độ thực tế"
                      type="linear" 
                      dataKey="Tỉ lệ thực tế (%)" 
                      stroke="#1e3a8a" 
                      strokeWidth={3} 
                      connectNulls={false}
                      dot={(props: any) => {
                        const { cx, cy, payload, key } = props;
                        // An toàn khi payload null/undefined
                        if (!payload || payload['Tỉ lệ thực tế (%)'] === null) return null;
                        
                        if (payload.Label) {
                          return <circle key={key} cx={cx} cy={cy} r={5} fill="#1e3a8a" stroke="#fff" strokeWidth={2} />;
                        }
                        return <circle key={key} cx={cx} cy={cy} r={2} fill="#1e3a8a" stroke="none" />;
                      }}
                      label={(props: any) => {
                        const { x, y, payload } = props;
                        // An toàn khi payload null/undefined
                        if (!payload || !payload.Label) return null;
                        
                        return (
                          <text x={x} y={y - 12} fill="#1e3a8a" fontSize={13} textAnchor="middle" fontWeight="bold">
                            {payload.Label}
                          </text>
                        );
                      }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white shadow rounded-lg p-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Doanh số & KPI theo ngày</h3>
              <div className="h-80 w-full">
                <ResponsiveContainer width="99%" height="100%">
                  <ComposedChart data={data.dailyData} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="date" tick={{fontSize: 12}} minTickGap={20} />
                    <YAxis tickFormatter={(val) => `${val / 1000000}M`} width={60} />
                    <Tooltip formatter={(value: number) => formatCurrency(value)} />
                    <Legend />
                    <Bar dataKey="Doanh số ngày" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={40} />
                    <Line type="step" dataKey="KPI ngày" stroke="#ef4444" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="bg-white shadow rounded-lg p-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Tỉ trọng theo Thương hiệu</h3>
              <div className="h-64 w-full">
                <ResponsiveContainer width="99%" height="100%">
                  <PieChart>
                    <Pie 
                      data={data.brandData} 
                      cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={2} dataKey="value"
                      label={({percent}) => `${(percent * 100).toFixed(0)}%`}
                      className="cursor-pointer"
                      onClick={(entry) => {
                        const brand = masterData?.brands.find(b => b.brand_name === entry.name);
                        if (brand) {
                          setSelectedBrandInput(brand.brand_id);
                          setSelectedProductInput('');
                          setAppliedFilters(prev => ({ ...prev, brandId: brand.brand_id, productId: '' }));
                        }
                      }}
                    >
                      {data.brandData.map((_, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(value: number) => formatCurrency(value)} />
                    <Legend layout="vertical" verticalAlign="middle" align="right" />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white shadow rounded-lg p-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Top Sản phẩm bán chạy</h3>
              <div className="h-64 w-full">
                <ResponsiveContainer width="99%" height="100%">
                  <PieChart>
                    <Pie 
                      data={data.productData} 
                      cx="50%" cy="50%" outerRadius={90} dataKey="value" 
                      label={({name, percent}) => `${(percent * 100).toFixed(0)}%`}
                      className="cursor-pointer"
                      onClick={(entry) => {
                        const product = masterData?.products.find(p => p.product_name === entry.name);
                        if (product) {
                          setSelectedProductInput(product.product_id);
                          setSelectedBrandInput(product.brand_id);
                          setAppliedFilters(prev => ({ ...prev, productId: product.product_id, brandId: product.brand_id }));
                        }
                      }}
                    >
                      {data.productData.map((_, index) => <Cell key={`cell-${index}`} fill={COLORS[(index + 2) % COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(value: number) => formatCurrency(value)} />
                    <Legend layout="horizontal" verticalAlign="bottom" />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="bg-white shadow rounded-lg overflow-hidden">
            <div className="px-6 py-5 border-b border-gray-200 flex justify-between items-center bg-gray-50">
              <h3 className="text-lg font-bold text-gray-900">Bảng Xếp Hạng PG (Theo % KPI)</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-white">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Hạng</th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-50" onClick={() => requestSort('name')}>
                      Nhân sự {getSortIcon('name')}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-50" onClick={() => requestSort('shopName')}>
                      Cửa hàng {getSortIcon('shopName')}
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-bold text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-50" onClick={() => requestSort('dailySales')}>
                      Doanh số trong ngày {getSortIcon('dailySales')}
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-bold text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-50" onClick={() => requestSort('dailyKpi')}>
                      KPI Ngày {getSortIcon('dailyKpi')}
                    </th>
                    <th className="px-6 py-3 text-center text-xs font-bold text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-50" onClick={() => requestSort('dailyAchievement')}>
                      Tiến độ ngày (%) {getSortIcon('dailyAchievement')}
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-bold text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-50" onClick={() => requestSort('sales')}>
                      Doanh số tháng {getSortIcon('sales')}
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-bold text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-50" onClick={() => requestSort('kpi')}>
                      KPI (Giao/Tháng) {getSortIcon('kpi')}
                    </th>
                    <th className="px-6 py-3 text-center text-xs font-bold text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-50" onClick={() => requestSort('achievement')}>
                      Tiến độ (%) {getSortIcon('achievement')}
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {sortedPgRankings.map((pg, index) => (
                    <tr key={pg.name} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900">
                        {index === 0 ? '🥇 1' : index === 1 ? '🥈 2' : index === 2 ? '🥉 3' : index + 1}
                      </td>
                      <td 
                        className="px-6 py-4 whitespace-nowrap text-sm font-medium text-indigo-600 cursor-pointer hover:text-indigo-800 hover:underline"
                        onClick={() => setSelectedPgForModal({ id: pg.id, name: pg.name, kpi: pg.kpi })}
                      >
                        {pg.name}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{pg.shopName}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-semibold text-indigo-600">{formatCurrency(pg.dailySales)}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-500">{formatCurrency(pg.dailyKpi)}</td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center justify-center">
                          <span className={`text-sm font-bold ${pg.dailyAchievement >= 100 ? 'text-green-600' : pg.dailyAchievement >= 80 ? 'text-amber-500' : 'text-red-500'}`}>
                            {pg.dailyAchievement.toFixed(1)}%
                          </span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1.5">
                          <div className={`h-1.5 rounded-full ${pg.dailyAchievement >= 100 ? 'bg-green-500' : pg.dailyAchievement >= 80 ? 'bg-amber-400' : 'bg-red-500'}`} style={{ width: `${Math.min(pg.dailyAchievement, 100)}%` }}></div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-semibold text-gray-900">{formatCurrency(pg.sales)}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-500">{formatCurrency(pg.kpi)}</td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center justify-center space-x-1">
                          {pg.achievement >= (data as any).standardProgressPercent && (
                            <CheckCircle2 className="w-4 h-4 text-green-600" />
                          )}
                          <span className={`text-sm font-bold ${pg.achievement >= (data as any).standardProgressPercent ? 'text-green-600' : 'text-red-500'}`}>
                            {pg.achievement.toFixed(1)}%
                          </span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1.5">
                          <div className={`h-1.5 rounded-full ${pg.achievement >= (data as any).standardProgressPercent ? 'bg-green-500' : 'bg-red-500'}`} style={{ width: `${Math.min(pg.achievement, 100)}%` }}></div>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {data.pgRankings.length === 0 && (
                    <tr><td colSpan={8} className="px-6 py-8 text-center text-gray-500">Chưa có dữ liệu hoạt động cho bộ lọc này.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {selectedPgForModal && (
        <PGDetailModal
          isOpen={!!selectedPgForModal}
          onClose={() => setSelectedPgForModal(null)}
          pgId={selectedPgForModal.id}
          pgName={selectedPgForModal.name}
          kpi={selectedPgForModal.kpi}
          orders={ordersData}
          masterData={masterData}
        />
      )}

      <SmartReportModal 
        isOpen={showSmartReport} 
        onClose={() => setShowSmartReport(false)} 
        masterData={masterData} 
        endDateStr={appliedFilters.endDate}
      />
    </div>
  );
}