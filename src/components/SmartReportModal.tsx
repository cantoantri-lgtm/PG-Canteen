import React, { useMemo, useState } from 'react';
import { X, Sparkles, TrendingUp, TrendingDown, AlertCircle, Lightbulb, Calendar, BarChart3, Target, Award } from 'lucide-react';
import { format, subDays, startOfMonth, subMonths, eachDayOfInterval, endOfMonth, isSunday } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

interface SmartReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  masterData: any;
  endDateStr?: string;
}

export function SmartReportModal({ isOpen, onClose, masterData, endDateStr }: SmartReportModalProps) {
  let today = endDateStr ? new Date(endDateStr + 'T23:59:59.999') : new Date();
  const actualToday = new Date();
  if (today > actualToday) {
    today = actualToday;
  }
  const yesterday = subDays(today, 1);
  const startOfThisMonth = startOfMonth(today);
  const startOfLastM = startOfMonth(subMonths(today, 1));
  const sameDayLastMonth = subMonths(today, 1);

  const [activeTab, setActiveTab] = useState<'daily' | 'monthly'>('daily');

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
    const productStats: Record<string, { id: string, name: string, brandName: string, today: number, yesterday: number, thisMonth: number, lastMonth: number }> = {};
    const pgBrandStats: Record<string, Record<string, { thisMonth: number, lastMonth: number }>> = {};
    const brandProductStats: Record<string, Record<string, { thisMonth: number, lastMonth: number }>> = {};
    const brandPgStats: Record<string, Record<string, { thisMonth: number, lastMonth: number }>> = {};

    orders.forEach(o => {
      if (!o.created_at) return;
      const orderDate = new Date(o.created_at);
      if (isNaN(orderDate.getTime())) return;
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
        const pgName = (masterData.profiles || []).find((p: any) => p.id === o.pg_id)?.full_name || 'Không xác định';
        pgStats[o.pg_id] = { id: o.pg_id, name: pgName, today: 0, yesterday: 0, thisMonth: 0, lastMonth: 0 };
      }
      if (isToday) pgStats[o.pg_id].today += val;
      if (isYesterday) pgStats[o.pg_id].yesterday += val;
      if (isThisMonth) pgStats[o.pg_id].thisMonth += val;
      if (isLastMonthUpToToday) pgStats[o.pg_id].lastMonth += val;

      // Brand Stats
      const product = (masterData.products || []).find((p: any) => p.product_id === o.product_id);
      const brandId = product?.brand_id;
      const productId = o.product_id;
      if (brandId) {
        const brandName = (masterData.brands || []).find((b: any) => b.brand_id === brandId)?.brand_name || 'Khác';
        if (!brandStats[brandId]) {
          brandStats[brandId] = { id: brandId, name: brandName, today: 0, yesterday: 0, thisMonth: 0, lastMonth: 0 };
        }
        if (isToday) brandStats[brandId].today += val;
        if (isYesterday) brandStats[brandId].yesterday += val;
        if (isThisMonth) brandStats[brandId].thisMonth += val;
        if (isLastMonthUpToToday) brandStats[brandId].lastMonth += val;

        if (productId) {
          if (!productStats[productId]) {
            const productName = product?.product_name || 'Khác';
            productStats[productId] = { id: productId, name: productName, brandName, today: 0, yesterday: 0, thisMonth: 0, lastMonth: 0 };
          }
          if (isToday) productStats[productId].today += val;
          if (isYesterday) productStats[productId].yesterday += val;
          if (isThisMonth) productStats[productId].thisMonth += val;
          if (isLastMonthUpToToday) productStats[productId].lastMonth += val;
        }

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

        // Brand -> PG stats
        if (!brandPgStats[brandId]) brandPgStats[brandId] = {};
        if (!brandPgStats[brandId][o.pg_id]) brandPgStats[brandId][o.pg_id] = { thisMonth: 0, lastMonth: 0 };
        if (isThisMonth) brandPgStats[brandId][o.pg_id].thisMonth += val;
        if (isLastMonthUpToToday) brandPgStats[brandId][o.pg_id].lastMonth += val;
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

    const productList = Object.values(productStats).map(p => ({
      ...p,
      diff: p.thisMonth - p.lastMonth,
      growthPct: calcGrowth(p.thisMonth, p.lastMonth)
    }));

    const growingPGs = [...pgList].filter(p => p.diff > 0).sort((a, b) => b.diff - a.diff);
    const decliningPGs = [...pgList].filter(p => p.diff < 0).sort((a, b) => a.diff - b.diff);

    const growingBrands = [...brandList].filter(b => b.diff > 0).sort((a, b) => b.diff - a.diff);
    const decliningBrands = [...brandList].filter(b => b.diff < 0).sort((a, b) => a.diff - b.diff);

    const growingProducts = [...productList].filter(p => p.diff > 0).sort((a, b) => b.diff - a.diff);
    const decliningProducts = [...productList].filter(p => p.diff < 0).sort((a, b) => a.diff - b.diff);

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
      const worstBrandName = (masterData.brands || []).find((b: any) => b.brand_id === worstBrandId)?.brand_name || 'Không xác định';
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
      const worstProductName = (masterData.products || []).find((p: any) => p.product_id === worstProductId)?.product_name || 'Không xác định';

      const pgStatsForBrand = brandPgStats[brand.id] || {};
      let worstPgId = '';
      let worstPgDiff = 0;
      for (const [pgId, stats] of Object.entries(pgStatsForBrand)) {
        const diff = stats.thisMonth - stats.lastMonth;
        if (diff < worstPgDiff) {
          worstPgDiff = diff;
          worstPgId = pgId;
        }
      }
      const worstPgName = (masterData.profiles || []).find((p: any) => p.id === worstPgId)?.full_name || 'Không xác định';

      return {
        ...brand,
        worstProductName,
        worstProductDiff,
        worstPgName,
        worstPgDiff
      };
    });

    const formatCurrency = (val: number) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(val);

    const dailyRecommendations: { title: string, problem: string, cause: string, solution: string }[] = [];
    const monthlyRecommendations: { title: string, problem: string, cause: string, solution: string }[] = [];

    // KPI Analysis
    const monthDays = eachDayOfInterval({ start: startOfMonth(today), end: endOfMonth(today) });
    const workingDaysInMonth = monthDays.filter(d => !isSunday(d)).length || 1;
    
    const daysUpToToday = eachDayOfInterval({ start: startOfMonth(today), end: today });
    const workingDaysUpToToday = daysUpToToday.filter(d => !isSunday(d)).length;

    const expectedMonthlyAchievement = (workingDaysUpToToday / workingDaysInMonth) * 100;

    const missedDailyPGs: any[] = [];

    Object.values(pgStats).forEach(pg => {
      const pgKpi = (masterData.kpis || []).find((k: any) => k.pg_id === pg.id)?.sale_target || 1;
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

    const missedDailyPGsOnly = missedDailyPGs.filter(p => p.isDailyMissed);
    if (missedDailyPGsOnly.length > 0) {
      const details = missedDailyPGsOnly.map(p => {
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
        return `- ${p.name}: Chậm KPI ngày ${formatCurrency(dailyShortfall > 0 ? dailyShortfall : 0)}. ${trendStr}.`;
      });

      dailyRecommendations.push({
        title: `Cảnh báo KPI Ngày: Các PG chưa đạt chỉ tiêu hôm nay`,
        problem: `Có ${missedDailyPGsOnly.length} PG đang chậm tiến độ KPI ngày.\n${details.join('\n')}`,
        cause: `Nguyên nhân có thể do kỹ năng tiếp cận khách hàng chưa tốt, hoặc lượng khách tại điểm bán thấp.`,
        solution: `Quản lý cần can thiệp ngay với các PG đang đi lùi/đi ngang. Phân tích nguyên nhân tại điểm bán và hỗ trợ trực tiếp.`
      });
    }

    const missedMonthlyPGsOnly = missedDailyPGs.filter(p => p.isMonthlyMissed);
    if (missedMonthlyPGsOnly.length > 0) {
      const details = missedMonthlyPGsOnly.map(p => {
        const expectedRev = workingDaysUpToToday * p.dailyKpi;
        const shortfallRev = expectedRev - p.thisMonth;
        const shortfallPct = expectedMonthlyAchievement - p.monthlyAchievement;
        return `- ${p.name}: Chậm tiến độ chuẩn ${formatCurrency(shortfallRev)} (${shortfallPct.toFixed(1)}%).`;
      });

      monthlyRecommendations.push({
        title: `Cảnh báo KPI Tháng: Các PG chưa đạt tiến độ chuẩn`,
        problem: `Có ${missedMonthlyPGsOnly.length} PG đang chậm tiến độ KPI tháng.\n${details.join('\n')}`,
        cause: `Tiến độ bán hàng chậm hơn so với thời gian đã trôi qua trong tháng.`,
        solution: `Cần rà soát lại kế hoạch bán hàng của các PG này, tìm hiểu khó khăn và đưa ra phương án thúc đẩy doanh số trong các ngày còn lại.`
      });
    }

    if (detailedDecliningPGs.length > 0) {
      detailedDecliningPGs.slice(0, 3).forEach(pg => {
        if (pg.worstBrandDiff < 0) {
          monthlyRecommendations.push({
            title: `Vấn đề của PG: ${pg.name}`,
            problem: `Sụt giảm doanh số tổng thể ${formatCurrency(Math.abs(pg.diff))} so với tháng trước.`,
            cause: `Chủ yếu do sự sụt giảm mạnh ở nhóm hàng ${pg.worstBrandName} (giảm ${formatCurrency(Math.abs(pg.worstBrandDiff))}).`,
            solution: `Quản lý cần làm việc trực tiếp với ${pg.name} để kiểm tra kỹ năng tư vấn nhóm hàng ${pg.worstBrandName}. Cần xem xét lại cách trưng bày, tồn kho của nhóm hàng này tại căn tin PG đang làm việc và bổ sung kiến thức sản phẩm nếu cần.`
          });
        }
      });
    }

    if (detailedDecliningBrands.length > 0) {
      detailedDecliningBrands.slice(0, 3).forEach(brand => {
        if (brand.worstProductDiff < 0) {
          monthlyRecommendations.push({
            title: `Vấn đề của Nhóm hàng: ${brand.name}`,
            problem: `Sụt giảm doanh số toàn hệ thống ${formatCurrency(Math.abs(brand.diff))} so với tháng trước.`,
            cause: `Doanh số bị kéo xuống chủ yếu bởi sản phẩm ${brand.worstProductName} (giảm ${formatCurrency(Math.abs(brand.worstProductDiff))}).`,
            solution: `Kiểm tra lại tình trạng đứt hàng, giá bán hoặc chương trình khuyến mãi của đối thủ đối với sản phẩm ${brand.worstProductName}. Cân nhắc đẩy mạnh sampling hoặc combo khuyến mãi riêng cho sản phẩm này để lấy lại đà tăng trưởng.`
          });
        }
      });
    } else {
      // Fallback: if no brands are declining (e.g. first month), find the slowest selling brands
      const slowBrands = [...brandList].filter(b => b.thisMonth > 0).sort((a, b) => a.thisMonth - b.thisMonth).slice(0, 3);
      
      const detailedSlowBrands = slowBrands.map(brand => {
        const productStatsForBrand = brandProductStats[brand.id] || {};
        let lowestProductId = '';
        let lowestProductSales = Infinity;
        for (const [pId, stats] of Object.entries(productStatsForBrand)) {
          if (stats.thisMonth > 0 && stats.thisMonth < lowestProductSales) {
            lowestProductSales = stats.thisMonth;
            lowestProductId = pId;
          }
        }
        const lowestProductName = (masterData.products || []).find((p: any) => p.product_id === lowestProductId)?.product_name || 'Không xác định';

        const pgStatsForBrand = brandPgStats[brand.id] || {};
        let lowestPgId = '';
        let lowestPgSales = Infinity;
        for (const [pgId, stats] of Object.entries(pgStatsForBrand)) {
          if (stats.thisMonth > 0 && stats.thisMonth < lowestPgSales) {
            lowestPgSales = stats.thisMonth;
            lowestPgId = pgId;
          }
        }
        const lowestPgName = (masterData.profiles || []).find((p: any) => p.id === lowestPgId)?.full_name || 'Không xác định';

        monthlyRecommendations.push({
          title: `Lưu ý Nhóm hàng bán chậm: ${brand.name}`,
          problem: `Nhóm hàng này đang có doanh số thấp nhất hệ thống trong tháng (${formatCurrency(brand.thisMonth)}).`,
          cause: `Sản phẩm bán chậm nhất trong nhóm là ${lowestProductName} (${formatCurrency(lowestProductSales === Infinity ? 0 : lowestProductSales)}).`,
          solution: `Cần tìm hiểu nguyên nhân (do giá, ít khuyến mãi, hay nhu cầu thấp). Cân nhắc các chương trình kích cầu hoặc đào tạo lại PG về cách tư vấn nhóm hàng này.`
        });

        return {
          ...brand,
          worstProductName: lowestProductName,
          worstProductDiff: lowestProductSales === Infinity ? 0 : lowestProductSales,
          worstPgName: lowestPgName,
          worstPgDiff: lowestPgSales === Infinity ? 0 : lowestPgSales
        };
      });

      // We will pass this to the UI to render in the deep dive section
      (detailedDecliningBrands as any)._fallbackSlowBrands = detailedSlowBrands;
    }

    // --- DAILY REPORT DATA ---
    const pgListDaily = Object.values(pgStats).map(p => ({
      ...p,
      diff: p.today - p.yesterday,
      growthPct: calcGrowth(p.today, p.yesterday)
    }));
    
    const brandListDaily = Object.values(brandStats).map(b => ({
      ...b,
      diff: b.today - b.yesterday,
      growthPct: calcGrowth(b.today, b.yesterday)
    }));

    const growingPGsDaily = [...pgListDaily].filter(p => p.diff > 0).sort((a, b) => b.diff - a.diff);
    const decliningPGsDaily = [...pgListDaily].filter(p => p.diff < 0).sort((a, b) => a.diff - b.diff);

    const growingBrandsDaily = [...brandListDaily].filter(b => b.diff > 0).sort((a, b) => b.diff - a.diff);
    const decliningBrandsDaily = [...brandListDaily].filter(b => b.diff < 0).sort((a, b) => a.diff - b.diff);

    // Daily Brand Analysis for Recommendations
    const decliningBrandsDailyOnly = [...brandListDaily].filter(b => b.diff < 0).sort((a, b) => a.diff - b.diff);
    if (decliningBrandsDailyOnly.length > 0) {
      const topDecliningDailyBrands = decliningBrandsDailyOnly.slice(0, 2);
      topDecliningDailyBrands.forEach(brand => {
        const pct = brand.yesterday > 0 ? (Math.abs(brand.diff) / brand.yesterday) * 100 : 100;
        dailyRecommendations.push({
          title: `Cảnh báo Nhóm hàng: ${brand.name}`,
          problem: `Doanh số nhóm hàng ${brand.name} hôm nay giảm ${formatCurrency(Math.abs(brand.diff))} (${pct.toFixed(1)}%) so với hôm qua.`,
          cause: `Có thể do thiếu hụt hàng hóa tại điểm bán, hoặc chương trình khuyến mãi kém hấp dẫn hơn đối thủ trong ngày hôm nay.`,
          solution: `Kiểm tra ngay tồn kho của nhóm hàng ${brand.name} tại các căn tin. Nhắc nhở PG tập trung tư vấn và đẩy mạnh nhóm hàng này.`
        });
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

      dailyRecommendations.push({
        title: `Cảnh báo hệ thống: Doanh số ngày`,
        problem: `Doanh số toàn hệ thống hôm nay giảm ${formatCurrency(dropAmount)} (${dropPercent.toFixed(1)}%) so với hôm qua.${worstPgText}`,
        cause: `Lượng khách tiếp cận có thể thấp hơn hoặc tỉ lệ chuyển đổi giảm.`,
        solution: `Nhắc nhở toàn bộ đội ngũ PG tăng cường hoạt động hoạt náo, chủ động tiếp cận khách hàng vào các khung giờ cao điểm. Đặc biệt cần hỗ trợ sát sao cho các PG đang có dấu hiệu đi lùi trong ngày.`
      });
    }

    if (dailyRecommendations.length === 0) {
      dailyRecommendations.push({
        title: `Đánh giá chung (Ngày)`,
        problem: `Không có vấn đề nghiêm trọng.`,
        cause: `Các chỉ số đang duy trì ổn định hoặc tăng trưởng tốt so với hôm qua.`,
        solution: `Tiếp tục duy trì các chiến lược hiện tại và khen thưởng các cá nhân xuất sắc.`
      });
    }

    if (monthlyRecommendations.length === 0) {
      monthlyRecommendations.push({
        title: `Đánh giá chung (Tháng)`,
        problem: `Không có vấn đề nghiêm trọng.`,
        cause: `Các chỉ số đang duy trì ổn định hoặc tăng trưởng tốt so với tháng trước.`,
        solution: `Tiếp tục duy trì các chiến lược hiện tại và khen thưởng các cá nhân xuất sắc.`
      });
    }

    // --- SUMMARY & HIGHLIGHTS ---
    const totalMonthlyKpi = (masterData.kpis || []).reduce((sum: number, k: any) => sum + Number(k.sale_target || 0), 0);
    const expectedRevUpToToday = (workingDaysUpToToday / workingDaysInMonth) * totalMonthlyKpi;
    const monthKpiPct = totalMonthlyKpi > 0 ? (revThisMonth / totalMonthlyKpi) * 100 : 0;
    const monthExpectedPct = totalMonthlyKpi > 0 ? (expectedRevUpToToday / totalMonthlyKpi) * 100 : 0;

    const dailyHighlights: string[] = [];
    if (growingPGsDaily.length > 0) dailyHighlights.push(`PG nổi bật: ${growingPGsDaily[0].name} (+${formatCurrency(growingPGsDaily[0].diff)})`);
    if (growingBrandsDaily.length > 0) dailyHighlights.push(`Nhóm hàng nổi bật: ${growingBrandsDaily[0].name} (+${formatCurrency(growingBrandsDaily[0].diff)})`);

    const monthlyHighlights: string[] = [];
    if (growingPGs.length > 0) monthlyHighlights.push(`PG xuất sắc: ${growingPGs[0].name} (+${formatCurrency(growingPGs[0].diff)})`);
    if (growingBrands.length > 0) monthlyHighlights.push(`Nhóm hàng tăng trưởng mạnh: ${growingBrands[0].name} (+${formatCurrency(growingBrands[0].diff)})`);
    if (growingProducts.length > 0) monthlyHighlights.push(`Sản phẩm đột phá: ${growingProducts[0].name} (+${formatCurrency(growingProducts[0].diff)})`);

    const dailySummary = {
      kpiText: `Doanh số hôm nay đạt ${formatCurrency(revToday)}. (Tiến độ tháng: đạt ${monthKpiPct.toFixed(1)}% / ${formatCurrency(totalMonthlyKpi)})`,
      periodText: `So với hôm qua: ${todayGrowth > 0 ? 'Tăng' : todayGrowth < 0 ? 'Giảm' : 'Đi ngang'} ${formatCurrency(Math.abs(revToday - revYesterday))} (${Math.abs(todayGrowth).toFixed(1)}%)`,
      highlights: dailyHighlights
    };

    const monthlySummary = {
      kpiText: `Doanh số tháng này đạt ${formatCurrency(revThisMonth)} / ${formatCurrency(totalMonthlyKpi)} (${monthKpiPct.toFixed(1)}% KPI). Tiến độ chuẩn hiện tại là ${monthExpectedPct.toFixed(1)}% -> ${monthKpiPct >= monthExpectedPct ? 'Vượt/Đạt' : 'Chậm'} tiến độ.`,
      periodText: `So với cùng kỳ tháng trước: ${monthGrowth > 0 ? 'Tăng' : monthGrowth < 0 ? 'Giảm' : 'Đi ngang'} ${formatCurrency(Math.abs(revThisMonth - revLastMonthUpToToday))} (${Math.abs(monthGrowth).toFixed(1)}%)`,
      highlights: monthlyHighlights
    };

    return {
      daily: {
        revCurrent: revToday, revPrevious: revYesterday, growth: todayGrowth,
        growingPGs: growingPGsDaily, decliningPGs: decliningPGsDaily,
        growingBrands: growingBrandsDaily, decliningBrands: decliningBrandsDaily,
        growingProducts: [], decliningProducts: [], // Not primarily shown in daily
        recommendations: dailyRecommendations,
        summary: dailySummary,
        currentLabel: 'Hôm nay', previousLabel: 'Hôm qua'
      },
      monthly: {
        revCurrent: revThisMonth, revPrevious: revLastMonthUpToToday, growth: monthGrowth,
        growingPGs, decliningPGs: detailedDecliningPGs,
        growingBrands, decliningBrands: detailedDecliningBrands,
        slowBrands: (detailedDecliningBrands as any)._fallbackSlowBrands || [],
        growingProducts, decliningProducts,
        recommendations: monthlyRecommendations,
        summary: monthlySummary,
        currentLabel: 'Tháng này', previousLabel: 'Cùng kỳ tháng trước'
      }
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

  const currentReport = activeTab === 'daily' ? report?.daily : report?.monthly;

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

        {/* Tabs */}
        <div className="flex border-b border-gray-200 bg-gray-50 px-6">
          <button
            onClick={() => setActiveTab('daily')}
            className={`py-3 px-6 font-medium text-sm border-b-2 transition-colors ${
              activeTab === 'daily'
                ? 'border-indigo-600 text-indigo-600 bg-white'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100'
            }`}
          >
            Báo cáo ngày
          </button>
          <button
            onClick={() => setActiveTab('monthly')}
            className={`py-3 px-6 font-medium text-sm border-b-2 transition-colors ${
              activeTab === 'monthly'
                ? 'border-indigo-600 text-indigo-600 bg-white'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100'
            }`}
          >
            Báo cáo tháng
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 bg-gray-50 space-y-6">
          
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-20">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-4"></div>
              <p className="text-gray-500 font-medium">Hệ thống đang tổng hợp và phân tích dữ liệu...</p>
            </div>
          ) : !currentReport ? (
            <div className="text-center py-10 text-gray-500">Không có đủ dữ liệu để phân tích.</div>
          ) : (
            <>
              {/* Section 1: Tổng quan */}
              <div>
                <h3 className="text-lg font-bold text-gray-900 mb-3 flex items-center">
                  <BarChart3 className="w-5 h-5 mr-2 text-indigo-600" /> Đánh giá hiệu quả bán hàng
                </h3>
                <div className="grid grid-cols-1 gap-4">
                  <div className="bg-white p-5 rounded-lg shadow-sm border border-gray-200">
                    <p className="text-sm font-medium text-gray-500 mb-1">{currentReport.currentLabel} vs {currentReport.previousLabel}</p>
                    <div className="flex items-end justify-between">
                      <div>
                        <p className="text-2xl font-bold text-gray-900">{formatCurrency(currentReport.revCurrent)}</p>
                        <p className="text-xs text-gray-400 mt-1">{currentReport.previousLabel}: {formatCurrency(currentReport.revPrevious)}</p>
                      </div>
                      <div>{renderGrowthBadge(currentReport.growth)}</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Section 2: Phân tích PG & Nhóm hàng & Sản phẩm */}
              <div className={`grid grid-cols-1 gap-6 ${activeTab === 'monthly' ? 'lg:grid-cols-3' : 'lg:grid-cols-2'}`}>
                
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
                      {currentReport.growingPGs.length > 0 ? (
                        <ul className="space-y-2">
                          {currentReport.growingPGs.slice(0, 3).map((pg: any, idx: number) => (
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
                      {currentReport.decliningPGs.length > 0 ? (
                        <ul className="space-y-2">
                          {currentReport.decliningPGs.slice(0, 3).map((pg: any, idx: number) => (
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
                      {currentReport.growingBrands.length > 0 ? (
                        <ul className="space-y-2">
                          {currentReport.growingBrands.slice(0, 3).map((brand: any, idx: number) => (
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
                      {currentReport.decliningBrands.length > 0 ? (
                        <ul className="space-y-2">
                          {currentReport.decliningBrands.slice(0, 3).map((brand: any, idx: number) => (
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

                {/* Product Analysis (Only for monthly) */}
                {activeTab === 'monthly' && (
                  <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                    <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                      <h3 className="text-md font-bold text-gray-800">Phân tích Sản phẩm</h3>
                    </div>
                    <div className="p-4 space-y-4">
                      <div>
                        <h4 className="text-sm font-bold text-green-700 flex items-center mb-2">
                          <TrendingUp className="w-4 h-4 mr-1" /> Top Tăng Trưởng
                        </h4>
                        {currentReport.growingProducts.length > 0 ? (
                          <ul className="space-y-2">
                            {currentReport.growingProducts.slice(0, 3).map((product: any, idx: number) => (
                              <li key={idx} className="flex justify-between items-center text-sm">
                                <span className="font-medium text-gray-700 truncate mr-2" title={product.name}>{product.name}</span>
                                <span className="text-green-600 font-bold whitespace-nowrap">+{formatCurrency(product.diff)}</span>
                              </li>
                            ))}
                          </ul>
                        ) : <p className="text-sm text-gray-500 italic">Chưa có dữ liệu tăng trưởng.</p>}
                      </div>
                      <div className="pt-3 border-t border-gray-100">
                        <h4 className="text-sm font-bold text-red-700 flex items-center mb-2">
                          <TrendingDown className="w-4 h-4 mr-1" /> Cần Cải Thiện (Giảm sút)
                        </h4>
                        {currentReport.decliningProducts.length > 0 ? (
                          <ul className="space-y-2">
                            {currentReport.decliningProducts.slice(0, 3).map((product: any, idx: number) => (
                              <li key={idx} className="flex justify-between items-center text-sm">
                                <span className="font-medium text-gray-700 truncate mr-2" title={product.name}>{product.name}</span>
                                <span className="text-red-600 font-bold whitespace-nowrap">{formatCurrency(product.diff)}</span>
                              </li>
                            ))}
                          </ul>
                        ) : <p className="text-sm text-gray-500 italic">Không có sản phẩm nào bị giảm sút.</p>}
                      </div>
                    </div>
                  </div>
                )}

              </div>

              {/* Section 2.5: Phân tích chuyên sâu Nhóm hàng giảm sút (Only for monthly) */}
              {activeTab === 'monthly' && (currentReport.decliningBrands.length > 0 || currentReport.slowBrands?.length > 0) && (
                <div className={`${currentReport.decliningBrands.length > 0 ? 'bg-red-50 border-red-100' : 'bg-orange-50 border-orange-100'} rounded-lg border p-5`}>
                  <h3 className={`text-lg font-bold ${currentReport.decliningBrands.length > 0 ? 'text-red-900' : 'text-orange-900'} mb-4 flex items-center`}>
                    <TrendingDown className={`w-5 h-5 mr-2 ${currentReport.decliningBrands.length > 0 ? 'text-red-600' : 'text-orange-600'}`} /> 
                    {currentReport.decliningBrands.length > 0 ? 'Phân tích chuyên sâu: Nhóm hàng suy giảm' : 'Phân tích chuyên sâu: Nhóm hàng bán chậm nhất'}
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {(currentReport.decliningBrands.length > 0 ? currentReport.decliningBrands : currentReport.slowBrands).slice(0, 3).map((brand: any, idx: number) => (
                      <div key={idx} className={`bg-white p-4 rounded-lg shadow-sm border ${currentReport.decliningBrands.length > 0 ? 'border-red-100' : 'border-orange-100'}`}>
                        <div className="flex justify-between items-center mb-3 border-b border-gray-100 pb-2">
                          <span className="font-bold text-gray-900 truncate mr-2" title={brand.name}>{brand.name}</span>
                          <span className={`${currentReport.decliningBrands.length > 0 ? 'text-red-600' : 'text-orange-600'} font-bold whitespace-nowrap`}>
                            {currentReport.decliningBrands.length > 0 ? formatCurrency(brand.diff) : formatCurrency(brand.thisMonth)}
                          </span>
                        </div>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between items-start">
                            <span className="text-gray-600">{currentReport.decliningBrands.length > 0 ? 'Sản phẩm kéo lùi:' : 'Sản phẩm bán chậm nhất:'}</span>
                            <div className="text-right ml-2">
                              <div className="font-medium text-gray-800 truncate max-w-[120px]" title={brand.worstProductName}>{brand.worstProductName}</div>
                              <div className={`${currentReport.decliningBrands.length > 0 ? 'text-red-500' : 'text-orange-500'}`}>{formatCurrency(brand.worstProductDiff)}</div>
                            </div>
                          </div>
                          <div className="flex justify-between items-start pt-2 border-t border-gray-50">
                            <span className="text-gray-600">{currentReport.decliningBrands.length > 0 ? 'PG giảm mạnh nhất:' : 'PG bán chậm nhất:'}</span>
                            <div className="text-right ml-2">
                              <div className="font-medium text-gray-800 truncate max-w-[120px]" title={brand.worstPgName}>{brand.worstPgName}</div>
                              <div className={`${currentReport.decliningBrands.length > 0 ? 'text-red-500' : 'text-orange-500'}`}>{formatCurrency(brand.worstPgDiff)}</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Section 3: Tổng kết & Điểm sáng */}
              <div className="bg-emerald-50 rounded-lg border border-emerald-100 p-5">
                <h3 className="text-lg font-bold text-emerald-900 mb-4 flex items-center">
                  <Target className="w-5 h-5 mr-2 text-emerald-600" /> Tổng kết & Điểm sáng
                </h3>
                <div className="space-y-3">
                  <div className="bg-white p-4 rounded-lg shadow-sm border border-emerald-100">
                    <div className="flex items-start mb-2">
                      <BarChart3 className="w-5 h-5 text-emerald-500 mr-2 flex-shrink-0 mt-0.5" />
                      <div>
                        <span className="font-bold text-gray-900">Tiến độ KPI: </span>
                        <span className="text-gray-800">{currentReport.summary.kpiText}</span>
                      </div>
                    </div>
                    <div className="flex items-start mb-2">
                      <TrendingUp className="w-5 h-5 text-emerald-500 mr-2 flex-shrink-0 mt-0.5" />
                      <div>
                        <span className="font-bold text-gray-900">Tăng trưởng: </span>
                        <span className="text-gray-800">{currentReport.summary.periodText}</span>
                      </div>
                    </div>
                    {currentReport.summary.highlights.length > 0 && (
                      <div className="flex items-start mt-3 pt-3 border-t border-emerald-50">
                        <Award className="w-5 h-5 text-yellow-500 mr-2 flex-shrink-0 mt-0.5" />
                        <div>
                          <span className="font-bold text-gray-900">Điểm sáng: </span>
                          <ul className="list-disc pl-5 mt-1 text-gray-800 space-y-1">
                            {currentReport.summary.highlights.map((hl: string, idx: number) => (
                              <li key={idx}>{hl}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Section 4: Đề xuất */}
              <div className="bg-indigo-50 rounded-lg border border-indigo-100 p-5">
                <h3 className="text-lg font-bold text-indigo-900 mb-4 flex items-center">
                  <Lightbulb className="w-5 h-5 mr-2 text-amber-500" /> Phân tích nguyên nhân & Đề xuất giải pháp chi tiết
                </h3>
                <div className="space-y-4">
                  {currentReport.recommendations.map((rec: any, idx: number) => (
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
