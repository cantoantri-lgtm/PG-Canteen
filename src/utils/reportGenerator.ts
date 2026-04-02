import { format, subDays, startOfMonth, subMonths } from 'date-fns';

export function generateEmailReport(orders: any[], masterData: any, dashboardData: any) {
  const today = new Date();
  const yesterday = subDays(today, 1);
  const startOfThisMonth = startOfMonth(today);
  const startOfLastM = startOfMonth(subMonths(today, 1));
  const sameDayLastMonth = subMonths(today, 1);

  const todayStr = format(today, 'yyyy-MM-dd');
  const yesterdayStr = format(yesterday, 'yyyy-MM-dd');

  let revToday = 0, revYesterday = 0, revThisMonth = 0, revLastMonthUpToToday = 0;
  
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
  });

  const formatCurrency = (val: number) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(val);

  const formatGrowth = (current: number, previous: number) => {
    if (previous === 0) return current > 0 ? '+100%' : '0%';
    const pct = ((current - previous) / previous) * 100;
    return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
  };

  const todayGrowth = formatGrowth(revToday, revYesterday);
  const monthGrowth = formatGrowth(revThisMonth, revLastMonthUpToToday);

  let emailBody = `BÁO CÁO ADMIN DASHBOARD - ${format(today, 'dd/MM/yyyy')}\n\n`;

  emailBody += `--- 1. TỔNG QUAN DASHBOARD ---\n`;
  if (dashboardData) {
    emailBody += `- Tổng doanh thu: ${formatCurrency(dashboardData.totalRevenue)}\n`;
    emailBody += `- Tổng KPI: ${formatCurrency(dashboardData.totalTarget)}\n`;
    emailBody += `- Tiến độ KPI: ${dashboardData.totalTarget > 0 ? ((dashboardData.totalRevenue / dashboardData.totalTarget) * 100).toFixed(1) : 0}%\n`;
    emailBody += `- Tỉ lệ chuyển đổi: ${dashboardData.conversionRate.toFixed(1)}%\n`;
    emailBody += `- Tổng số đơn hàng: ${dashboardData.totalOrdersCount}\n`;
    emailBody += `- Tổng số PG hoạt động: ${dashboardData.totalPGs}\n\n`;
  } else {
    emailBody += `Không có dữ liệu tổng quan.\n\n`;
  }

  emailBody += `--- 2. BÁO CÁO PHÂN TÍCH NGÀY ---\n`;
  emailBody += `- Doanh số hôm nay: ${formatCurrency(revToday)}\n`;
  emailBody += `- So với hôm qua (${formatCurrency(revYesterday)}): ${todayGrowth}\n\n`;

  emailBody += `--- 3. BÁO CÁO PHÂN TÍCH THÁNG ---\n`;
  emailBody += `- Doanh số tháng này: ${formatCurrency(revThisMonth)}\n`;
  emailBody += `- So với cùng kỳ tháng trước (${formatCurrency(revLastMonthUpToToday)}): ${monthGrowth}\n\n`;

  emailBody += `Vui lòng xem chi tiết trên hệ thống Admin Dashboard.`;

  return emailBody;
}
