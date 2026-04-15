import { useMemo } from 'react';
import { format, subDays, startOfMonth, subMonths, eachDayOfInterval, endOfMonth, isSunday } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export function useSmartReport(masterData: any, isOpen: boolean = true, endDateStr?: string, isSup: boolean = false, userId?: string) {
  let today = endDateStr ? new Date(endDateStr + 'T23:59:59.999') : new Date();
  const actualToday = new Date();
  if (today > actualToday) {
    today = actualToday;
  }
  const yesterday = subDays(today, 1);
  const startOfThisMonth = startOfMonth(today);
  const startOfLastM = startOfMonth(subMonths(today, 1));
  const sameDayLastMonth = subMonths(today, 1);

  const { data: orders, isLoading } = useQuery({
    queryKey: ['smart_report_orders', today.toISOString().split('T')[0], isSup, userId],
    queryFn: async () => {
      let query = supabase
        .from('orders')
        .select('*, profiles!inner(manager_id)')
        .gte('created_at', startOfLastM.toISOString())
        .lte('created_at', today.toISOString());
      
      if (isSup && userId) {
        const { data: assignedPrograms } = await supabase
          .from('sup_programs')
          .select('program_id')
          .eq('sup_id', userId);
        const assignedProgramIds = assignedPrograms?.map(ap => ap.program_id) || [];
        
        if (assignedProgramIds.length > 0) {
          query = query.in('program_id', assignedProgramIds);
        } else {
          return [];
        }
        
        query = query.eq('profiles.manager_id', userId);
      }

      const { data, error } = await query;
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

    const monthlyRecommendations: any[] = [];
    const dailyRecommendations: any[] = [];

    const monthDays = eachDayOfInterval({ start: startOfThisMonth, end: endOfMonth(startOfThisMonth) });
    const workingDaysInMonth = monthDays.filter(d => !isSunday(d)).length || 1;
    const daysUpToToday = eachDayOfInterval({ start: startOfThisMonth, end: today });
    const workingDaysUpToToday = daysUpToToday.filter(d => !isSunday(d)).length || 1;
    const expectedMonthlyAchievement = (workingDaysUpToToday / workingDaysInMonth) * 100;

    const missedDailyPGs: any[] = [];
    pgList.forEach(p => {
      const kpi = (masterData.kpis || []).find((k: any) => k.pg_id === p.id)?.sale_target || 0;
      if (kpi > 0) {
        const dailyKpi = kpi / workingDaysInMonth;
        if (p.today < dailyKpi && p.today > 0) {
          missedDailyPGs.push({
            ...p,
            dailyKpi,
            isMonthlyMissed: (p.thisMonth / kpi) * 100 < expectedMonthlyAchievement,
            monthlyAchievement: (p.thisMonth / kpi) * 100
          });
        }
      }
    });

    if (missedDailyPGs.length > 0) {
      const details = missedDailyPGs.slice(0, 3).map(p => `- ${p.name}: Đạt ${formatCurrency(p.today)} / ${formatCurrency(p.dailyKpi)} KPI ngày.`);
      dailyRecommendations.push({
        title: `Cảnh báo KPI Ngày: Các PG chưa đạt chỉ tiêu`,
        problem: `Có ${missedDailyPGs.length} PG chưa đạt KPI trong ngày hôm nay.\n${details.join('\n')}`,
        cause: `Có thể do lượng khách vắng, hoặc kỹ năng tiếp cận khách hàng chưa tốt trong ngày.`,
        solution: `Cần động viên và theo dõi sát sao các PG này trong những ngày tới. Xem xét hỗ trợ thêm về kỹ năng tư vấn hoặc điều chỉnh vị trí đứng nếu cần.`
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

      (detailedDecliningBrands as any)._fallbackSlowBrands = detailedSlowBrands;
    }

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
        growingProducts: [], decliningProducts: [],
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

  return { report, isLoading };
}
