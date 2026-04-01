import React, { useMemo } from 'react';
import { X, Sparkles, TrendingUp, TrendingDown, AlertCircle, Lightbulb, Calendar, BarChart3 } from 'lucide-react';
import { format, subDays, startOfMonth, subMonths } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

interface SmartReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  masterData: any;
}

export function SmartReportModal({ isOpen, onClose, masterData }: SmartReportModalProps) {
  const today = new Date();
  const yesterday = subDays(today, 1);
  const startOfThisMonth = startOfMonth(today);
  const startOfLastM = startOfMonth(subMonths(today, 1));
  const sameDayLastMonth = subMonths(today, 1);

  const { data: orders, isLoading } = useQuery({
    queryKey: ['smart_report_orders', today.toISOString().split('T')[0]],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .gte('created_at', startOfLastM.toISOString())
        .lte('created_at', today.toISOString());
      if (error) throw error;
      return data || [];
    },
    enabled: isOpen
  });

  const report = useMemo(() => {
    if (!orders || !masterData) return null;

    const todayStr = format(today, 'yyyy-MM-dd');
    const yesterdayStr = format(yesterday, 'yyyy-MM-dd');

    let revToday = 0, revYesterday = 0, revThisMonth = 0, revLastMonthUpToToday = 0;
    const pgStats: Record<string, { name: string, today: number, yesterday: number, thisMonth: number, lastMonth: number }> = {};
    const brandStats: Record<string, { name: string, today: number, yesterday: number, thisMonth: number, lastMonth: number }> = {};

    orders.forEach(o => {
      if (!o.created_at) return;
      const orderDate = new Date(o.created_at);
      const dateStr = format(orderDate, 'yyyy-MM-dd');
      const val = Number(o.net_value || 0);

      const isToday = dateStr === todayStr;
      const isYesterday = dateStr === yesterdayStr;
      const isThisMonth = orderDate >= startOfThisMonth;
      const isLastMonthUpToToday = orderDate >= startOfLastM && orderDate <= sameDayLastMonth;

      if (isToday) revToday += val;
      if (isYesterday) revYesterday += val;
      if (isThisMonth) revThisMonth += val;
      if (isLastMonthUpToToday) revLastMonthUpToToday += val;

      // PG Stats
      if (!pgStats[o.pg_id]) {
        const pgName = masterData.profiles.find((p: any) => p.id === o.pg_id)?.full_name || 'Không xác định';
        pgStats[o.pg_id] = { name: pgName, today: 0, yesterday: 0, thisMonth: 0, lastMonth: 0 };
      }
      if (isToday) pgStats[o.pg_id].today += val;
      if (isYesterday) pgStats[o.pg_id].yesterday += val;
      if (isThisMonth) pgStats[o.pg_id].thisMonth += val;
      if (isLastMonthUpToToday) pgStats[o.pg_id].lastMonth += val;

      // Brand Stats
      const product = masterData.products.find((p: any) => p.product_id === o.product_id);
      const brandId = product?.brand_id;
      if (brandId) {
        if (!brandStats[brandId]) {
          const brandName = masterData.brands.find((b: any) => b.brand_id === brandId)?.brand_name || 'Khác';
          brandStats[brandId] = { name: brandName, today: 0, yesterday: 0, thisMonth: 0, lastMonth: 0 };
        }
        if (isToday) brandStats[brandId].today += val;
        if (isYesterday) brandStats[brandId].yesterday += val;
        if (isThisMonth) brandStats[brandId].thisMonth += val;
        if (isLastMonthUpToToday) brandStats[brandId].lastMonth += val;
      }
    });

    const calcGrowth = (current: number, previous: number) => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return ((current - previous) / previous) * 100;
    };

    const todayGrowth = calcGrowth(revToday, revYesterday);
    const monthGrowth = calcGrowth(revThisMonth, revLastMonthUpToToday);

    const pgList = Object.values(pgStats).map(p => ({
      ...p,
      diff: p.thisMonth - p.lastMonth,
      growthPct: calcGrowth(p.thisMonth, p.lastMonth)
    }));
    
    const brandList = Object.values(brandStats).map(b => ({
      ...b,
      diff: b.thisMonth - b.lastMonth,
      growthPct: calcGrowth(b.thisMonth, b.lastMonth)
    }));

    const growingPGs = [...pgList].filter(p => p.diff > 0).sort((a, b) => b.diff - a.diff);
    const decliningPGs = [...pgList].filter(p => p.diff < 0).sort((a, b) => a.diff - b.diff);

    const growingBrands = [...brandList].filter(b => b.diff > 0).sort((a, b) => b.diff - a.diff);
    const decliningBrands = [...brandList].filter(b => b.diff < 0).sort((a, b) => a.diff - b.diff);

    const recommendations: string[] = [];

    if (revToday < revYesterday) {
      recommendations.push(`Doanh số hôm nay đang thấp hơn hôm qua. Cần rà soát lại lượng khách tại các căn tin và đôn đốc PG tăng cường tiếp cận khách hàng vào các khung giờ cao điểm.`);
    } else if (revToday > 0) {
      recommendations.push(`Doanh số hôm nay tăng trưởng tốt so với hôm qua. Cần duy trì nhịp độ bán hàng và đảm bảo hàng hóa trưng bày đầy đủ.`);
    }

    if (revThisMonth < revLastMonthUpToToday) {
      recommendations.push(`Tiến độ tháng này đang chậm hơn so với cùng kỳ tháng trước. Cần xem xét lại các chương trình khuyến mãi hoặc target đã giao cho PG.`);
    }

    if (decliningPGs.length > 0) {
      recommendations.push(`Các PG ${decliningPGs.slice(0, 3).map(p => p.name).join(', ')} đang có dấu hiệu đi lùi về doanh số so với tháng trước. Quản lý cần trao đổi trực tiếp để tìm hiểu khó khăn (do vắng khách hay kỹ năng tư vấn) và hỗ trợ kịp thời.`);
    }

    if (decliningBrands.length > 0) {
      recommendations.push(`Nhóm hàng ${decliningBrands.slice(0, 2).map(b => b.name).join(', ')} đang có sự sụt giảm. Đề xuất kiểm tra lại tồn kho, vị trí trưng bày tại các căn tin và xem xét chạy chương trình sampling/khuyến mãi để kích cầu.`);
    }

    if (growingPGs.length > 0) {
      recommendations.push(`Tuyên dương và có chính sách khích lệ cho các PG ${growingPGs.slice(0, 3).map(p => p.name).join(', ')} vì đà tăng trưởng doanh số rất xuất sắc.`);
    }

    if (recommendations.length === 0) {
      recommendations.push("Tình hình kinh doanh đang duy trì ở mức ổn định. Tiếp tục theo dõi các chỉ số trong những ngày tới.");
    }

    return {
      revToday, revYesterday, todayGrowth,
      revThisMonth, revLastMonthUpToToday, monthGrowth,
      growingPGs, decliningPGs,
      growingBrands, decliningBrands,
      recommendations
    };
  }, [orders, masterData]);

  if (!isOpen) return null;

  const formatCurrency = (val: number) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(val);

  const renderGrowthBadge = (growth: number) => {
    if (growth > 0) {
      return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800"><TrendingUp className="w-3 h-3 mr-1"/> +{growth.toFixed(1)}%</span>;
    } else if (growth < 0) {
      return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800"><TrendingDown className="w-3 h-3 mr-1"/> {growth.toFixed(1)}%</span>;
    }
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">0%</span>;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4 sm:p-6">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className="px-6 py-5 bg-gradient-to-r from-indigo-600 to-purple-600 flex justify-between items-center">
          <div className="flex items-center text-white">
            <Sparkles className="w-6 h-6 mr-3 text-yellow-300" />
            <h2 className="text-xl font-bold">Báo Cáo Thông Minh (AI Analysis)</h2>
          </div>
          <button onClick={onClose} className="text-white hover:text-gray-200 transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 bg-gray-50 space-y-6">
          
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-20">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-4"></div>
              <p className="text-gray-500 font-medium">Hệ thống đang tổng hợp và phân tích dữ liệu...</p>
            </div>
          ) : !report ? (
            <div className="text-center py-10 text-gray-500">Không có đủ dữ liệu để phân tích.</div>
          ) : (
            <>
              {/* Section 1: Tổng quan */}
              <div>
                <h3 className="text-lg font-bold text-gray-900 mb-3 flex items-center">
                  <BarChart3 className="w-5 h-5 mr-2 text-indigo-600" /> Đánh giá hiệu quả bán hàng
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-white p-5 rounded-lg shadow-sm border border-gray-200">
                    <p className="text-sm font-medium text-gray-500 mb-1">Hôm nay vs Hôm qua</p>
                    <div className="flex items-end justify-between">
                      <div>
                        <p className="text-2xl font-bold text-gray-900">{formatCurrency(report.revToday)}</p>
                        <p className="text-xs text-gray-400 mt-1">Hôm qua: {formatCurrency(report.revYesterday)}</p>
                      </div>
                      <div>{renderGrowthBadge(report.todayGrowth)}</div>
                    </div>
                  </div>
                  <div className="bg-white p-5 rounded-lg shadow-sm border border-gray-200">
                    <p className="text-sm font-medium text-gray-500 mb-1">Tháng này vs Cùng kỳ tháng trước</p>
                    <div className="flex items-end justify-between">
                      <div>
                        <p className="text-2xl font-bold text-gray-900">{formatCurrency(report.revThisMonth)}</p>
                        <p className="text-xs text-gray-400 mt-1">Cùng kỳ: {formatCurrency(report.revLastMonthUpToToday)}</p>
                      </div>
                      <div>{renderGrowthBadge(report.monthGrowth)}</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Section 2: Phân tích PG & Nhóm hàng */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                
                {/* PG Analysis */}
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                  <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                    <h3 className="text-md font-bold text-gray-800">Phân tích Nhân sự (PG)</h3>
                  </div>
                  <div className="p-4 space-y-4">
                    <div>
                      <h4 className="text-sm font-bold text-green-700 flex items-center mb-2">
                        <TrendingUp className="w-4 h-4 mr-1" /> Top Tăng Trưởng
                      </h4>
                      {report.growingPGs.length > 0 ? (
                        <ul className="space-y-2">
                          {report.growingPGs.slice(0, 3).map((pg, idx) => (
                            <li key={idx} className="flex justify-between items-center text-sm">
                              <span className="font-medium text-gray-700">{pg.name}</span>
                              <span className="text-green-600 font-bold">+{formatCurrency(pg.diff)}</span>
                            </li>
                          ))}
                        </ul>
                      ) : <p className="text-sm text-gray-500 italic">Chưa có dữ liệu tăng trưởng.</p>}
                    </div>
                    <div className="pt-3 border-t border-gray-100">
                      <h4 className="text-sm font-bold text-red-700 flex items-center mb-2">
                        <TrendingDown className="w-4 h-4 mr-1" /> Cần Cải Thiện (Giảm sút)
                      </h4>
                      {report.decliningPGs.length > 0 ? (
                        <ul className="space-y-2">
                          {report.decliningPGs.slice(0, 3).map((pg, idx) => (
                            <li key={idx} className="flex justify-between items-center text-sm">
                              <span className="font-medium text-gray-700">{pg.name}</span>
                              <span className="text-red-600 font-bold">{formatCurrency(pg.diff)}</span>
                            </li>
                          ))}
                        </ul>
                      ) : <p className="text-sm text-gray-500 italic">Không có PG nào bị giảm sút.</p>}
                    </div>
                  </div>
                </div>

                {/* Brand Analysis */}
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                  <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                    <h3 className="text-md font-bold text-gray-800">Phân tích Nhóm hàng</h3>
                  </div>
                  <div className="p-4 space-y-4">
                    <div>
                      <h4 className="text-sm font-bold text-green-700 flex items-center mb-2">
                        <TrendingUp className="w-4 h-4 mr-1" /> Top Tăng Trưởng
                      </h4>
                      {report.growingBrands.length > 0 ? (
                        <ul className="space-y-2">
                          {report.growingBrands.slice(0, 3).map((brand, idx) => (
                            <li key={idx} className="flex justify-between items-center text-sm">
                              <span className="font-medium text-gray-700">{brand.name}</span>
                              <span className="text-green-600 font-bold">+{formatCurrency(brand.diff)}</span>
                            </li>
                          ))}
                        </ul>
                      ) : <p className="text-sm text-gray-500 italic">Chưa có dữ liệu tăng trưởng.</p>}
                    </div>
                    <div className="pt-3 border-t border-gray-100">
                      <h4 className="text-sm font-bold text-red-700 flex items-center mb-2">
                        <TrendingDown className="w-4 h-4 mr-1" /> Cần Cải Thiện (Giảm sút)
                      </h4>
                      {report.decliningBrands.length > 0 ? (
                        <ul className="space-y-2">
                          {report.decliningBrands.slice(0, 3).map((brand, idx) => (
                            <li key={idx} className="flex justify-between items-center text-sm">
                              <span className="font-medium text-gray-700">{brand.name}</span>
                              <span className="text-red-600 font-bold">{formatCurrency(brand.diff)}</span>
                            </li>
                          ))}
                        </ul>
                      ) : <p className="text-sm text-gray-500 italic">Không có nhóm hàng nào bị giảm sút.</p>}
                    </div>
                  </div>
                </div>

              </div>

              {/* Section 3: Đề xuất */}
              <div className="bg-indigo-50 rounded-lg border border-indigo-100 p-5">
                <h3 className="text-lg font-bold text-indigo-900 mb-4 flex items-center">
                  <Lightbulb className="w-5 h-5 mr-2 text-amber-500" /> Đề xuất phương án cải thiện
                </h3>
                <ul className="space-y-3">
                  {report.recommendations.map((rec, idx) => (
                    <li key={idx} className="flex items-start">
                      <span className="flex-shrink-0 h-6 w-6 flex items-center justify-center rounded-full bg-indigo-200 text-indigo-700 font-bold text-xs mr-3 mt-0.5">
                        {idx + 1}
                      </span>
                      <p className="text-sm text-indigo-900 leading-relaxed">
                        {rec.split('**').map((part, i) => i % 2 === 1 ? <strong key={i}>{part}</strong> : part)}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>

            </>
          )}

        </div>
      </div>
    </div>
  );
}
