import { useMemo } from 'react';
import { format, subDays, startOfMonth, subMonths, eachDayOfInterval, endOfMonth, isSunday } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export function useSmartReport(masterData: any, isOpen: boolean = true, appliedFilters?: any, isSup: boolean = false, userId?: string) {
  // Determine the period based on appliedFilters
  const { periodStart, periodEnd, prevPeriodStart, prevPeriodEnd } = useMemo(() => {
    let end = appliedFilters?.endDate ? new Date(appliedFilters.endDate + 'T23:59:59.999') : new Date();
    const actualToday = new Date();
    if (end > actualToday) {
      end = actualToday;
    }
    
    let start = appliedFilters?.startDate ? new Date(appliedFilters.startDate + 'T00:00:00.000') : startOfMonth(end);
    if (start > end) {
      start = startOfMonth(end);
    }
    
    // Calculate the previous period of the same length
    const durationMs = end.getTime() - start.getTime();
    const prevEnd = new Date(start.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - durationMs);

    return { periodStart: start, periodEnd: end, prevPeriodStart: prevStart, prevPeriodEnd: prevEnd };
  }, [appliedFilters]);

  const { data: orders, isLoading } = useQuery({
    queryKey: ['smart_report_orders', appliedFilters, userId, isSup],
    queryFn: async () => {
      let allData: any[] = [];
      let page = 0;
      const pageSize = 1000;
      let hasMore = true;

      while (hasMore) {
        let query = supabase
          .from('order_details')
          .select(`
            *,
            orders!inner(
              created_at, pg_id, program_id, shop_id,
              profiles!inner(manager_id)
            )
          `)
          .gte('orders.created_at', prevPeriodStart.toISOString())
          .lte('orders.created_at', periodEnd.toISOString())
          .range(page * pageSize, (page + 1) * pageSize - 1);

        if (isSup && userId) {
          const { data: assignedPrograms } = await supabase
            .from('sup_programs')
            .select('program_id')
            .eq('sup_id', userId);
          const assignedProgramIds = assignedPrograms?.map(ap => ap.program_id) || [];
          
          if (assignedProgramIds.length > 0) {
            query = query.in('orders.program_id', assignedProgramIds);
          } else {
            return [];
          }
          
          query = query.eq('orders.profiles.manager_id', userId);
        }

        // Handle array of program IDs if passed
        if (appliedFilters?.programIds && appliedFilters.programIds.length > 0) {
          query = query.in('orders.program_id', appliedFilters.programIds);
        }
        if (appliedFilters?.shopIds && appliedFilters.shopIds.length > 0) {
          query = query.in('orders.shop_id', appliedFilters.shopIds);
        }
        if (appliedFilters?.brandIds && appliedFilters.brandIds.length > 0) {
          const productIds = masterData?.products?.filter((p: any) => appliedFilters.brandIds.includes(p.brand_id)).map((p: any) => p.product_id) || [];
          if (productIds.length > 0) {
            query = query.in('product_id', productIds);
          } else {
            return [];
          }
        }
        if (appliedFilters?.productIds && appliedFilters.productIds.length > 0) {
          query = query.in('product_id', appliedFilters.productIds);
        }
        if (appliedFilters?.managerIds && appliedFilters.managerIds.length > 0) {
          query = query.in('orders.profiles.manager_id', appliedFilters.managerIds);
        }

        const { data, error } = await query;
        if (error) {
          console.error('Lỗi fetch smart report', error);
          break;
        }
        
        if (data && data.length > 0) {
          allData = [...allData, ...data];
          if (data.length < pageSize) {
            hasMore = false;
          } else {
            page++;
          }
        } else {
          hasMore = false;
        }
      }
      
      // Flatten the data to match the expected structure in the report logic
      return allData.map(item => {
        const product = masterData?.products?.find((p: any) => p.product_id === item.product_id);
        const brand_id = product?.brand_id;
          
        return {
          ...item,
          created_at: item.orders.created_at,
          pg_id: item.orders.pg_id,
          program_id: item.orders.program_id,
          shop_id: item.orders.shop_id,
          brand_id: brand_id
        };
      });
    },
    enabled: isOpen
  });

  const report = useMemo(() => {
    if (!orders || !masterData) return null;

    const todayStr = format(periodEnd, 'yyyy-MM-dd');
    const yesterdayStr = format(subDays(periodEnd, 1), 'yyyy-MM-dd');

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
      const isThisMonth = orderDate >= periodStart && orderDate <= periodEnd;
      const isLastMonthUpToToday = orderDate >= prevPeriodStart && orderDate <= prevPeriodEnd;

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
    const monthDays = eachDayOfInterval({ start: startOfMonth(periodEnd), end: endOfMonth(periodEnd) });
    const workingDaysInMonth = monthDays.filter(d => !isSunday(d)).length || 1;
    
    const daysUpToToday = eachDayOfInterval({ start: periodStart, end: periodEnd });
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
            trendStr = `Tăng ${formatCurrency(p.diffToday)} (${pct.toFixed(1)}%) so với ngày trước đó`;
        } else if (p.diffToday < 0) {
            const pct = p.yesterday > 0 ? (Math.abs(p.diffToday) / p.yesterday) * 100 : 100;
            trendStr = `Giảm ${formatCurrency(Math.abs(p.diffToday))} (${pct.toFixed(1)}%) so với ngày trước đó`;
        } else {
            trendStr = `Đi ngang so với ngày trước đó`;
        }

        const dailyShortfall = p.dailyKpi - p.today;
        return `- ${p.name}: Chậm KPI ngày ${formatCurrency(dailyShortfall > 0 ? dailyShortfall : 0)}. ${trendStr}.`;
      });

      dailyRecommendations.push({
        title: `Cảnh báo KPI Ngày: Các PG chưa đạt chỉ tiêu ngày cuối kỳ`,
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
        title: `Cảnh báo KPI: Các PG chưa đạt tiến độ chuẩn`,
        problem: `Có ${missedMonthlyPGsOnly.length} PG đang chậm tiến độ KPI.\n${details.join('\n')}`,
        cause: `Tiến độ bán hàng chậm hơn so với thời gian đã trôi qua trong kỳ.`,
        solution: `Cần rà soát lại kế hoạch bán hàng của các PG này, tìm hiểu khó khăn và đưa ra phương án thúc đẩy doanh số trong các ngày còn lại.`
      });
    }

    if (detailedDecliningPGs.length > 0) {
      detailedDecliningPGs.slice(0, 3).forEach(pg => {
        if (pg.worstBrandDiff < 0) {
          monthlyRecommendations.push({
            title: `Vấn đề của PG: ${pg.name}`,
            problem: `Sụt giảm doanh số tổng thể ${formatCurrency(Math.abs(pg.diff))} so với kỳ trước.`,
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
            problem: `Sụt giảm doanh số toàn hệ thống ${formatCurrency(Math.abs(brand.diff))} so với kỳ trước.`,
            cause: `Doanh số bị kéo xuống chủ yếu bởi sản phẩm ${brand.worstProductName} (giảm ${formatCurrency(Math.abs(brand.worstProductDiff))}).`,
            solution: `Kiểm tra lại tình trạng đứt hàng, giá bán hoặc chương trình khuyến mãi của đối thủ đối với sản phẩm ${brand.worstProductName}. Cân nhắc đẩy mạnh sampling hoặc combo khuyến mãi riêng cho sản phẩm này để lấy lại đà tăng trưởng.`
          });
        }
      });
    } else {
      // Fallback: if no brands are declining (e.g. first month), find the slowest selling brands
      const slowBrands = [...brandList].filter(b => b.thisMonth > 0).sort((a, b) => a.thisMonth - b.thisMonth).slice(0, 3);
      if (slowBrands.length > 0) {
         monthlyRecommendations.push({
            title: `Các nhóm hàng bán chậm`,
            problem: `Nhóm hàng ${slowBrands.map(b => b.name).join(', ')} đang có doanh số thấp nhất toàn hệ thống.`,
            cause: `Có thể do thiếu chương trình khuyến mãi hấp dẫn hoặc độ phủ tại các điểm bán chưa cao.`,
            solution: `Cần rà soát lại độ phủ của các nhóm hàng này tại các shop. Xem xét tung ra các chương trình kích cầu hoặc combo dùng thử.`
          });
      }
    }

    const dailyHighlights = [];
    if (growingPGs.length > 0) dailyHighlights.push(`PG tăng trưởng tốt nhất: ${growingPGs[0].name} (+${formatCurrency(growingPGs[0].diff)})`);
    if (growingBrands.length > 0) dailyHighlights.push(`Nhóm hàng tăng trưởng tốt nhất: ${growingBrands[0].name} (+${formatCurrency(growingBrands[0].diff)})`);
    if (growingProducts.length > 0) dailyHighlights.push(`Sản phẩm bán chạy nhất: ${growingProducts[0].name} (+${formatCurrency(growingProducts[0].diff)})`);

    const monthlyHighlights = [];
    if (growingPGs.length > 0) monthlyHighlights.push(`PG tăng trưởng tốt nhất: ${growingPGs[0].name} (+${formatCurrency(growingPGs[0].diff)})`);
    if (growingBrands.length > 0) monthlyHighlights.push(`Nhóm hàng tăng trưởng tốt nhất: ${growingBrands[0].name} (+${formatCurrency(growingBrands[0].diff)})`);
    if (growingProducts.length > 0) monthlyHighlights.push(`Sản phẩm bán chạy nhất: ${growingProducts[0].name} (+${formatCurrency(growingProducts[0].diff)})`);

    const problematicPgIds = Array.from(new Set([
      ...missedDailyPGs.filter(p => p.isDailyMissed || p.isMonthlyMissed).map(p => p.id),
      ...detailedDecliningPGs.map(p => p.id)
    ]));

    const problematicBrandIds = Array.from(new Set([
      ...detailedDecliningBrands.map(b => b.id),
      ...((brandList.filter(b => b.thisMonth > 0).sort((a,b) => a.thisMonth - b.thisMonth).slice(0, 3)).map(b => b.id))
    ]));

    return {
      daily: {
        summary: {
          periodText: `Doanh số ngày ${format(periodEnd, 'dd/MM/yyyy')}: ${formatCurrency(revToday)} (So với ngày trước đó: ${todayGrowth > 0 ? '+' : ''}${todayGrowth.toFixed(1)}%)`,
          kpiText: `Tiến độ KPI ngày: ${missedDailyPGsOnly.length === 0 ? 'Tất cả PG đạt chỉ tiêu' : `${missedDailyPGsOnly.length} PG chưa đạt chỉ tiêu`}`,
          highlights: dailyHighlights
        },
        recommendations: dailyRecommendations,
        problematicPgIds,
        problematicBrandIds
      },
      monthly: {
        summary: {
          periodText: `Doanh số từ ${format(periodStart, 'dd/MM/yyyy')} đến ${format(periodEnd, 'dd/MM/yyyy')}: ${formatCurrency(revThisMonth)} (So với kỳ trước: ${monthGrowth > 0 ? '+' : ''}${monthGrowth.toFixed(1)}%)`,
          kpiText: `Tiến độ KPI kỳ: ${missedMonthlyPGsOnly.length === 0 ? 'Tất cả PG đạt tiến độ chuẩn' : `${missedMonthlyPGsOnly.length} PG chậm tiến độ`}`,
          highlights: monthlyHighlights
        },
        recommendations: monthlyRecommendations,
        problematicPgIds,
        problematicBrandIds
      },
      orders // Include raw orders for chart generation
    };
  }, [orders, masterData, periodStart, periodEnd, prevPeriodStart, prevPeriodEnd]);

  return { report, isLoading };
}
