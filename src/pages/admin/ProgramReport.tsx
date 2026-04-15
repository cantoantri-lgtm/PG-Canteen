import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';
import { format, startOfMonth, endOfMonth } from 'date-fns';

export default function ProgramReport() {
  const { user } = useAuth();
  const isAdmin = user?.admin_role === true || user?.role === 'admin' || user?.email?.toLowerCase() === 'can.toantri@gmail.com';
  const isSup = user?.role_name?.toUpperCase() === 'SUP';
  
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [selectedProgramId, setSelectedProgramId] = useState<string>('');

  const { data: supPrograms = [] } = useQuery({
    queryKey: ['sup_programs', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase.from('sup_programs').select('program_id').eq('sup_id', user.id);
      if (error) throw error;
      return data.map(sp => sp.program_id);
    },
    enabled: isSup && !!user?.id
  });

  const { data: programs = [] } = useQuery({
    queryKey: ['programs', supPrograms],
    queryFn: async () => {
      let query = supabase.from('programs').select('program_id, program_name').order('start_date', { ascending: false });
      if (isSup && supPrograms.length > 0) {
        query = query.in('program_id', supPrograms);
      } else if (isSup && supPrograms.length === 0) {
        return [];
      }
      const { data } = await query;
      return (data || []) as any[];
    }
  });

  const { data: orders = [], isLoading: loadingOrders } = useQuery({
    queryKey: ['program_orders', selectedProgramId, selectedDate],
    queryFn: async () => {
      if (!selectedProgramId) return [];
      
      const date = new Date(selectedDate);
      const start = startOfMonth(date).toISOString();
      const end = endOfMonth(date).toISOString();

      const { data, error } = await supabase
        .from('order_details')
        .select(`
          id, order_id, product_id, qty, net_value, switched_from_brand,
          orders!inner(
            cart_id, created_at, pg_id, program_id,
            profiles!inner(manager_id)
          ),
          products (
            product_name,
            product_group!inner (
              brands ( brand_name )
            )
          )
        `)
        .eq('orders.program_id', selectedProgramId)
        .gte('orders.created_at', start)
        .lte('orders.created_at', end);
        
      if (error) throw error;
      
      let filteredData = data || [];
      if (isSup && user?.id) {
        filteredData = filteredData.filter((item: any) => {
          const order = Array.isArray(item.orders) ? item.orders[0] : item.orders;
          const profile = Array.isArray(order?.profiles) ? order.profiles[0] : order?.profiles;
          return profile?.manager_id === user.id;
        });
      }
      
      return filteredData.map((item: any) => {
        const order = Array.isArray(item.orders) ? item.orders[0] : item.orders;
        const product = Array.isArray(item.products) ? item.products[0] : item.products;
        const productGroup = Array.isArray(product?.product_group) ? product.product_group[0] : product?.product_group;
        const brand = Array.isArray(productGroup?.brands) ? productGroup.brands[0] : productGroup?.brands;
        
        return {
          id: item.id,
          cart_id: order?.cart_id,
          product_id: item.product_id,
          qty: item.qty,
          net_value: item.net_value,
          switched_from_brand: item.switched_from_brand,
          created_at: order?.created_at,
          pg_id: order?.pg_id,
          products: {
            product_name: product?.product_name,
            brands: {
              brand_name: brand?.brand_name
            }
          }
        };
      });
    },
    enabled: !!selectedProgramId,
  });

  const reportData = useMemo(() => {
    if (!selectedProgramId) return null;

    const programName = programs.find(p => p.program_id === selectedProgramId)?.program_name || 'Không xác định';

    const dailyOrders = orders.filter(o => o.created_at.startsWith(selectedDate));
    const uniqueCarts = new Set(dailyOrders.map(o => o.cart_id)).size;
    const dailyTotalAmount = dailyOrders.reduce((sum, o) => sum + Number(o.net_value), 0);
    
    const monthlyTotalAmount = orders
      .filter(o => !o.switched_from_brand)
      .reduce((sum, o) => sum + Number(o.net_value), 0);

    const dailyTotalQty = dailyOrders.reduce((sum, o) => sum + Number(o.qty), 0);
    const dailyConvertedQty = dailyOrders.filter(o => o.switched_from_brand).reduce((sum, o) => sum + Number(o.qty), 0);
    const conversionRate = dailyTotalQty > 0 ? (dailyConvertedQty / dailyTotalQty) * 100 : 0;

    const tableDataMap = new Map<string, { brand: string, product: string, qty: number, amount: number }>();
    
    dailyOrders.forEach(o => {
      const brandName = o.products?.brands?.brand_name || 'Khác';
      const productName = o.products?.product_name || 'Không xác định';
      const key = `${brandName}-${productName}`;
      
      if (!tableDataMap.has(key)) {
        tableDataMap.set(key, { brand: brandName, product: productName, qty: 0, amount: 0 });
      }
      
      const item = tableDataMap.get(key)!;
      item.qty += Number(o.qty);
      item.amount += Number(o.net_value);
    });

    const tableData = Array.from(tableDataMap.values()).sort((a, b) => a.brand.localeCompare(b.brand) || a.product.localeCompare(b.product));

    return {
      programName,
      date: selectedDate,
      uniqueCarts,
      dailyTotalAmount,
      monthlyTotalAmount,
      conversionRate,
      tableData
    };
  }, [selectedProgramId, selectedDate, orders, programs]);

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-10 px-4">
      <div className="sm:flex sm:items-center sm:justify-between pt-6">
        <h2 className="text-2xl font-bold text-gray-900">Báo Cáo Chương Trình</h2>
      </div>

      <div className="bg-white shadow rounded-lg p-6 border border-gray-200">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Chọn Chương trình</label>
            <select 
              className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
              value={selectedProgramId}
              onChange={(e) => setSelectedProgramId(e.target.value)}
            >
              <option value="">-- Chọn Chương trình --</option>
              {programs.map(p => (
                <option key={p.program_id} value={p.program_id}>{p.program_name}</option>
              ))}
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Ngày báo cáo</label>
            <input 
              type="date" 
              className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
            />
          </div>
        </div>

        {loadingOrders ? (
          <div className="text-center py-10 text-gray-500">Đang tải dữ liệu báo cáo...</div>
        ) : !selectedProgramId ? (
          <div className="text-center py-10 text-gray-500">Vui lòng chọn chương trình để xem báo cáo.</div>
        ) : reportData ? (
          <div className="space-y-8">
            
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100">
                <p className="text-sm font-medium text-indigo-600 mb-1">Chương trình</p>
                <p className="text-lg font-bold text-gray-900 line-clamp-1">{reportData.programName}</p>
              </div>
              <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100">
                <p className="text-sm font-medium text-indigo-600 mb-1">Số giỏ hàng trong ngày</p>
                <p className="text-lg font-bold text-gray-900">{reportData.uniqueCarts}</p>
              </div>
              <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100">
                <p className="text-sm font-medium text-indigo-600 mb-1">Doanh số trong ngày</p>
                <p className="text-lg font-bold text-gray-900">{new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(reportData.dailyTotalAmount)}</p>
              </div>
              <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100">
                <p className="text-sm font-medium text-indigo-600 mb-1">Doanh số lũy kế tháng</p>
                <p className="text-lg font-bold text-gray-900">{new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(reportData.monthlyTotalAmount)}</p>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-bold text-gray-900 mb-4">Bảng số liệu chi tiết trong ngày</h3>
              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">NHÓM HÀNG (THƯƠNG HIỆU)</th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">SẢN PHẨM</th>
                      <th scope="col" className="px-6 py-3 text-center text-xs font-bold text-gray-500 uppercase tracking-wider">SỐ LƯỢNG</th>
                      <th scope="col" className="px-6 py-3 text-right text-xs font-bold text-gray-500 uppercase tracking-wider">SỐ TIỀN</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {reportData.tableData.length > 0 ? (
                      reportData.tableData.map((row, idx) => (
                        <tr key={idx} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-medium">{row.brand}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{row.product}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-center font-bold">{row.qty}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right font-medium">
                            {new Intl.NumberFormat('vi-VN').format(row.amount)}đ
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={4} className="px-6 py-8 text-center text-sm text-gray-500 italic">
                          Không có dữ liệu bán hàng trong ngày này.
                        </td>
                      </tr>
                    )}
                  </tbody>
                  {reportData.tableData.length > 0 && (
                    <tfoot className="bg-gray-50 font-bold border-t border-gray-300">
                      <tr>
                        <td colSpan={2} className="px-6 py-4 whitespace-nowrap text-sm text-indigo-900 text-right uppercase">Tổng cộng:</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-indigo-900 text-center text-lg">{reportData.tableData.reduce((sum, r) => sum + r.qty, 0)}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-indigo-900 text-right text-lg">{new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(reportData.dailyTotalAmount)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>

          </div>
        ) : null}
      </div>
    </div>
  );
}
