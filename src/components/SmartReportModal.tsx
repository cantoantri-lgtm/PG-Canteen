import React, { useMemo } from 'react';
import { X, Sparkles, TrendingUp, TrendingDown, AlertCircle, Lightbulb, Calendar, BarChart3 } from 'lucide-react';
import { format, subDays, startOfMonth, subMonths, eachDayOfInterval, endOfMonth, isSunday } from 'date-fns';
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
    const pgStats: Record<string, { id: string, name: string, today: number, yesterday: number, thisMonth: number, lastMonth: number }> = {};
    const brandStats: Record<string, { id: string, name: string, today: number, yesterday: number, thisMonth: number, lastMonth: number }> = {};
    const pgBrandStats: Record<string, Record<string, { thisMonth: number, lastMonth: number }>> = {};
    const brandProductStats: Record<string, Record<string, { thisMonth: number, lastMonth: number }>> = {};

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
        pgStats[o.pg_id] = { id: o.pg_id, name: pgName, today: 0, yesterday: 0, thisMonth: 0, lastMonth: 0 };
      }
      if (isToday) pgStats[o.pg_id].today += val;
      if (isYesterday) pgStats[o.pg_id].yesterday += val;
      if (isThisMonth) pgStats[o.pg_id].thisMonth += val;
      if (isLastMonthUpToToday) pgStats[o.pg_id].lastMonth += val;

      // Brand Stats
      const product = masterData.products.find((p: any) => p.product_id === o.product_id);
      const brandId = product?.brand_id;
      const productId = o.product_id;
      if (brandId) {
        if (!brandStats[brandId]) {
          const brandName = masterData.brands.find((b: any) => b.brand_id === brandId)?.brand_name || 'Khác';
          brandStats[brandId] = { id: brandId, name: brandName, today: 0, yesterday: 0, thisMonth: 0, lastMonth: 0 };
        }
        if (isToday) brandStats[brandId].today += val;
        if (isYesterday) brandStats[brandId].yesterday += val;
        if (isThisMonth) brandStats[brandId].thisMonth += val;
        if (isLastMonthUpToToday) brandStats[brandId].lastMonth += val;

        // PG -> Brand stats
        if (!pgBrandStats[o.pg_id]) pgBrandStats[o.pg_id] = {};
        if (!pgBrandStats[o.pg_id][brandId]) pgBrandStats[o.pg_id][brandId] = { thisMonth: 0, lastMonth: 0 };
        if (isThisMonth) pgBrandStats[o.pg_id][brandId].thisMonth += val;
        if (isLastMonthUpToToday) pgBrandStats[o.pg_id][brandId].lastMonth += val;

        // Brand -> Product stats
        if (!brandProductStats[brandId]) brandProductStats[brandId] = {};
        if (!brandProductStats[brandId][productId]) brandProductStats[brandId][productId] = { thisMonth: 0, lastMonth: 0 };
        if (isThisMonth) brandProductStats[brandId][productId].thisMonth += val;
        if (isLastMonthUpToToday) brandProductStats[brandId][productId].lastMonth += val;
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

    const detailedDecliningPGs = decliningPGs.map(pg => {
      const brandStatsForPg = pgBrandStats[pg.id] || {};
      let worstBrandId = '';
      let worstBrandDiff = 0;
      for (const [bId, stats] of Object.entries(brandStatsForPg)) {
        const diff = stats.thisMonth - stats.lastMonth;
        if (diff < worstBrandDiff) {
          worstBrandDiff = diff;
          worstBrandId = bId;
        }
      }
      const worstBrandName = masterData.brands.find((b: any) => b.brand_id === worstBrandId)?.brand_name || 'Không xác định';
      return {
        ...pg,
        worstBrandName,
        worstBrandDiff
      };
    });

    const detailedDecliningBrands = decliningBrands.map(brand => {
      const productStatsForBrand = brandProductStats[brand.id] || {};
      let worstProductId = '';
      let worstProductDiff = 0;
      for (const [pId, stats] of Object.entries(productStatsForBrand)) {
        const diff = stats.thisMonth - stats.lastMonth;
        if (diff < worstProductDiff) {
          worstProductDiff = diff;
          worstProductId = pId;
        }
      }
      const worstProductName = masterData.products.find((p: any) => p.product_id === worstProductId)?.product_name || 'Không xác định';
      return {
        ...brand,
        worstProductName,
        worstProductDiff
      };
    });

    const formatCurrency = (val: number) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(val);

    const detailedRecommendations: { title: string, problem: string, cause: string, solution: string }[] = [];

    // KPI Analysis
    const monthDays = eachDayOfInterval({ start: startOfMonth(today), end: endOfMonth(today) });
    const workingDaysInMonth = monthDays.filter(d => !isSunday(d)).length || 1;
    
    const daysUpToToday = eachDayOfInterval({ start: startOfMonth(today), end: today });
    const workingDaysUpToToday = daysUpToToday.filter(d => !isSunday(d)).length;

    const expectedMonthlyAchievement = (workingDaysUpToToday / workingDaysInMonth) * 100;

    const missedDailyPGs: any[] = [];

    Object.values(pgStats).forEach(pg => {
      const pgKpi = masterData.kpis.find((k: any) => k.pg_id === pg.id)?.sale_target || 1;
      const dailyKpi = Number(pgKpi) / workingDaysInMonth;
      const monthlyKpi = Number(pgKpi);

      const dailyAchievement = dailyKpi > 0 ? (pg.today / dailyKpi) * 100 : 0;
      const monthlyAchievement = monthlyKpi > 0 ? (pg.thisMonth / monthlyKpi) * 100 : 0;
      
      const isDailyMissed = dailyAchievement < 100 && pg.today > 0; // Only count if they worked today but missed
      const isMonthlyMissed = monthlyAchievement < expectedMonthlyAchievement;
      
      const improvedToday = pg.today > pg.yesterday;
      const diffToday = pg.today - pg.yesterday;

      if (isDailyMissed || isMonthlyMissed) {
        missedDailyPGs.push({
          ...pg,
          dailyKpi,
          monthlyKpi,
          dailyAchievement,
          monthlyAchievement,
          isDailyMissed,
          isMonthlyMissed,
          improvedToday,
          diffToday
        });
      }
    });

    if (missedDailyPGs.length > 0) {
      const details = missedDailyPGs.map(p => {
        const expectedRev = workingDaysUpToToday * p.dailyKpi;
        const shortfallRev = expectedRev - p.thisMonth;
        const shortfallPct = expectedMonthlyAchievement - p.monthlyAchievement;
        
        let trendStr = '';
        if (p.diffToday > 0) {
            const pct = p.yesterday > 0 ? (p.diffToday / p.yesterday) * 100 : 100;
            trendStr = `Tăng ${formatCurrency(p.diffToday)} (${pct.toFixed(1)}%) so với hôm qua`;
        } else if (p.diffToday < 0) {
            const pct = p.yesterday > 0 ? (Math.abs(p.diffToday) / p.yesterday) * 100 : 100;
            trendStr = `Giảm ${formatCurrency(Math.abs(p.diffToday))} (${pct.toFixed(1)}%) so với hôm qua`;
        } else {
            trendStr = `Đi ngang so với hôm qua`;
        }

        const dailyShortfall = p.dailyKpi - p.today;
        
        if (shortfallRev > 0) {
          return `- ${p.name}: Chậm tiến độ chuẩn ${formatCurrency(shortfallRev)} (${shortfallPct.toFixed(1)}%), chậm KPI ngày ${formatCurrency(dailyShortfall > 0 ? dailyShortfall : 0)}. ${trendStr}.`;
        } else {
          return `- ${p.name}: Đạt tiến độ chuẩn nhưng chậm KPI ngày hôm nay ${formatCurrency(dailyShortfall > 0 ? dailyShortfall : 0)}. ${trendStr}.`;
        }
      });

      detailedRecommendations.push({
        title: `Cảnh báo KPI: Các PG chưa đạt tiến độ`,
        problem: `Có ${missedDailyPGs.length} PG đang chậm tiến độ KPI.\n${details.join('\n')}`,
        cause: `Nguyên nhân có thể do kỹ năng tiếp cận khách hàng chưa tốt, hoặc lượng khách tại điểm bán thấp.`,
        solution: `Quản lý cần can thiệp ngay với các PG đang đi lùi/đi ngang. Phân tích nguyên nhân tại điểm bán và hỗ trợ trực tiếp.`
      });
    }

    if (detailedDecliningPGs.length > 0) {
      detailedDecliningPGs.forEach(pg => {
        if (pg.worstBrandDiff < 0) {
          detailedRecommendations.push({
            title: `Vấn đề của PG: ${pg.name}`,
            problem: `Sụt giảm doanh số tổng thể ${formatCurrency(Math.abs(pg.diff))} so với tháng trước.`,
            cause: `Chủ yếu do sự sụt giảm mạnh ở nhóm hàng ${pg.worstBrandName} (giảm ${formatCurrency(Math.abs(pg.worstBrandDiff))}).`,
            solution: `Quản lý cần làm việc trực tiếp với ${pg.name} để kiểm tra kỹ năng tư vấn nhóm hàng ${pg.worstBrandName}. Cần xem xét lại cách trưng bày, tồn kho của nhóm hàng này tại căn tin PG đang làm việc và bổ sung kiến thức sản phẩm nếu cần.`
          });
        }
      });
    }

    if (detailedDecliningBrands.length > 0) {
      detailedDecliningBrands.forEach(brand => {
        if (brand.worstProductDiff < 0) {
          detailedRecommendations.push({
            title: `Vấn đề của Nhóm hàng: ${brand.name}`,
            problem: `Sụt giảm doanh số toàn hệ thống ${formatCurrency(Math.abs(brand.diff))} so với tháng trước.`,
            cause: `Doanh số bị kéo xuống chủ yếu bởi sản phẩm ${brand.worstProductName} (giảm ${formatCurrency(Math.abs(brand.worstProductDiff))}).`,
            solution: `Kiểm tra lại tình trạng đứt hàng, giá bán hoặc chương trình khuyến mãi của đối thủ đối với sản phẩm ${brand.worstProductName}. Cân nhắc đẩy mạnh sampling hoặc combo khuyến mãi riêng cho sản phẩm này để lấy lại đà tăng trưởng.`
          });
        }
      });
    }

    if (revToday < revYesterday) {
      const dropAmount = revYesterday - revToday;
      const dropPercent = Math.abs(todayGrowth);
      
      let worstDailyPg: any = null;
      let worstDailyDiff = 0;
      
      for (const pg of Object.values(pgStats)) {
        const diff = pg.today - pg.yesterday;
        if (diff < worstDailyDiff) {
          worstDailyDiff = diff;
          worstDailyPg = pg;
        }
      }

      let worstPgText = '';
      if (worstDailyPg) {
        const pgDropPercent = worstDailyPg.yesterday > 0 
          ? (Math.abs(worstDailyDiff) / worstDailyPg.yesterday) * 100 
          : 100;
        worstPgText = ` Nhân sự giảm mạnh nhất là ${worstDailyPg.name} (giảm ${formatCurrency(Math.abs(worstDailyDiff))}, tương đương ${pgDropPercent.toFixed(1)}%).`;
      }

      detailedRecommendations.push({
        title: `Cảnh báo hệ thống: Doanh số ngày`,
        problem: `Doanh số toàn hệ thống hôm nay giảm ${formatCurrency(dropAmount)} (${dropPercent.toFixed(1)}%) so với hôm qua.${worstPgText}`,
        cause: `Lượng khách tiếp cận có thể thấp hơn hoặc tỉ lệ chuyển đổi giảm.`,
        solution: `Nhắc nhở toàn bộ đội ngũ PG tăng cường hoạt động hoạt náo, chủ động tiếp cận khách hàng vào các khung giờ cao điểm. Đặc biệt cần hỗ trợ sát sao cho các PG đang có dấu hiệu đi lùi trong ngày.`
      });
    }

    if (detailedRecommendations.length === 0) {
      detailedRecommendations.push({
        title: `Đánh giá chung`,
        problem: `Không có vấn đề nghiêm trọng.`,
        cause: `Các chỉ số đang duy trì ổn định hoặc tăng trưởng tốt.`,
        solution: `Tiếp tục duy trì các chiến lược hiện tại và khen thưởng các cá nhân xuất sắc.`
      });
    }

    return {
      revToday, revYesterday, todayGrowth,
      revThisMonth, revLastMonthUpToToday, monthGrowth,
      growingPGs, decliningPGs: detailedDecliningPGs,
      growingBrands, decliningBrands: detailedDecliningBrands,
      detailedRecommendations
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
                  <Lightbulb className="w-5 h-5 mr-2 text-amber-500" /> Phân tích nguyên nhân & Đề xuất giải pháp chi tiết
                </h3>
                <div className="space-y-4">
                  {report.detailedRecommendations.map((rec, idx) => (
                    <div key={idx} className="bg-white p-4 rounded-lg shadow-sm border border-indigo-100">
                      <h4 className="font-bold text-indigo-800 mb-3 border-b border-gray-100 pb-2">{rec.title}</h4>
                      <div className="flex items-start mb-2">
                        <AlertCircle className="w-5 h-5 text-red-500 mr-2 flex-shrink-0 mt-0.5" />
                        <div>
                          <span className="font-bold text-gray-900">Vấn đề: </span>
                          <span className="text-gray-800 whitespace-pre-line">{rec.problem}</span>
                        </div>
                      </div>
                      <div className="flex items-start mb-2 pl-7">
                        <div>
                          <span className="font-bold text-amber-600">Nguyên nhân: </span>
                          <span className="text-gray-700">{rec.cause}</span>
                        </div>
                      </div>
                      <div className="flex items-start pl-7">
                        <div>
                          <span className="font-bold text-green-600">Giải pháp cụ thể: </span>
                          <span className="text-gray-700">{rec.solution}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

            </>
          )}

        </div>
      </div>
    </div>
  );
}
