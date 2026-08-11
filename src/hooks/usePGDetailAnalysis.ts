import { useMemo } from 'react';
import { format, subDays, startOfMonth, eachDayOfInterval, isSunday } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export function usePGDetailAnalysis(pgId: string | null, masterData: any, endDateStr: string, kpi: number) {
  const { currentPeriodStart, currentPeriodEnd, prevPeriodStart, prevPeriodEnd } = useMemo(() => {
    let end = endDateStr ? new Date(endDateStr + 'T23:59:59.999') : new Date();
    const actualToday = new Date();
    if (end > actualToday) {
      end = actualToday;
    }
    
    let start = startOfMonth(end);
    if (start > end) {
      start = startOfMonth(end);
    }
    
    // Calculate the previous period of the same length
    const durationMs = end.getTime() - start.getTime();
    const prevEnd = new Date(start.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - durationMs);

    return { 
      currentPeriodStart: start, 
      currentPeriodEnd: end, 
      prevPeriodStart: prevStart, 
      prevPeriodEnd: prevEnd 
    };
  }, [endDateStr]);

  const { data: analysisOrders, isLoading } = useQuery({
    queryKey: ['pg_detail_analysis', pgId, endDateStr],
    queryFn: async () => {
      if (!pgId) return [];
      
      let allData: any[] = [];
      let page = 0;
      const pageSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await supabase
          .from('order_details')
          .select(`
            *,
            orders!inner(
              created_at, pg_id, shop_id
            )
          `)
          .eq('orders.pg_id', pgId)
          .gte('orders.created_at', prevPeriodStart.toISOString())
          .lte('orders.created_at', currentPeriodEnd.toISOString())
          .range(page * pageSize, (page + 1) * pageSize - 1);

        if (error) {
          console.error('Lỗi fetch pg analysis', error);
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
      
      return allData.map(item => {
        const product = masterData?.products?.find((p: any) => p.product_id === item.product_id);
        const brand_id = product?.brand_id;
          
        return {
          ...item,
          created_at: item.orders.created_at,
          pg_id: item.orders.pg_id,
          brand_id: brand_id
        };
      });
    },
    enabled: !!pgId && !!masterData
  });

  const { data: attendanceData } = useQuery({
    queryKey: ['pg_attendance', pgId, endDateStr],
    queryFn: async () => {
      if (!pgId) return { currentPeriodDays: 0, prevPeriodDays: 0 };
      
      const { data, error } = await supabase
        .from('schedules')
        .select('date')
        .eq('pg_id', pgId)
        .gte('date', format(prevPeriodStart, 'yyyy-MM-dd'))
        .lte('date', format(currentPeriodEnd, 'yyyy-MM-dd'));

      if (error) {
        console.error('Lỗi fetch schedules', error);
        return { currentPeriodDays: 0, prevPeriodDays: 0 };
      }
      
      let currentPeriodDays = 0;
      let prevPeriodDays = 0;
      
      data?.forEach(s => {
        if (!s.date) return;
        const d = new Date(s.date);
        if (d >= currentPeriodStart && d <= currentPeriodEnd) currentPeriodDays++;
        if (d >= prevPeriodStart && d <= prevPeriodEnd) prevPeriodDays++;
      });
      
      return { 
        currentPeriodDays: [...new Set(data?.filter(s => {
          const d = new Date(s.date);
          return d >= currentPeriodStart && d <= currentPeriodEnd;
        }).map(s => s.date))].length, 
        prevPeriodDays: [...new Set(data?.filter(s => {
          const d = new Date(s.date);
          return d >= prevPeriodStart && d <= prevPeriodEnd;
        }).map(s => s.date))].length
      };
    },
    enabled: !!pgId
  });

  const analysis = useMemo(() => {
    if (!analysisOrders || !masterData || !attendanceData) return null;

    let currentRev = 0;
    let prevRev = 0;
    const currentBrandRev: Record<string, number> = {};
    const prevBrandRev: Record<string, number> = {};

    analysisOrders.forEach(o => {
      if (!o.created_at) return;
      const orderDate = new Date(o.created_at);
      if (isNaN(orderDate.getTime())) return;
      
      const val = Number(o.net_value || 0);

      const isCurrent = orderDate >= currentPeriodStart && orderDate <= currentPeriodEnd;
      const isPrev = orderDate >= prevPeriodStart && orderDate <= prevPeriodEnd;

      if (isCurrent) currentRev += val;
      if (isPrev) prevRev += val;

      const brandId = o.brand_id;
      if (brandId) {
        if (isCurrent) {
          currentBrandRev[brandId] = (currentBrandRev[brandId] || 0) + val;
        }
        if (isPrev) {
          prevBrandRev[brandId] = (prevBrandRev[brandId] || 0) + val;
        }
      }
    });

    const calcGrowth = (current: number, previous: number) => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return ((current - previous) / previous) * 100;
    };

    const totalGrowth = calcGrowth(currentRev, prevRev);
    const totalDiff = currentRev - prevRev;

    const brandDiffs = Object.keys({ ...currentBrandRev, ...prevBrandRev }).map(brandId => {
      const cRev = currentBrandRev[brandId] || 0;
      const pRev = prevBrandRev[brandId] || 0;
      const diff = cRev - pRev;
      const pct = calcGrowth(cRev, pRev);
      const name = (masterData.brands || []).find((b: any) => b.brand_id === brandId)?.brand_name || 'Khác';
      return { id: brandId, name, diff, pct, currentRev: cRev, prevRev: pRev };
    });

    const growingBrands = brandDiffs.filter(b => b.diff > 0).sort((a, b) => b.diff - a.diff);
    const decliningBrands = brandDiffs.filter(b => b.diff < 0).sort((a, b) => a.diff - b.diff);

    return {
      currentRev,
      prevRev,
      totalGrowth,
      totalDiff,
      growingBrands,
      decliningBrands,
      attendance: attendanceData
    };
  }, [analysisOrders, masterData, currentPeriodStart, currentPeriodEnd, prevPeriodStart, prevPeriodEnd, attendanceData]);

  return { analysis, isLoading: isLoading };
}
