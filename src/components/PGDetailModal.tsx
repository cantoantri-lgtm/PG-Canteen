import React, { useMemo, useState } from 'react';
import { X, Eye } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { format } from 'date-fns';
import { supabase } from '../lib/supabase';
import { toast } from 'sonner';
import Modal from './Modal';

interface PGDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  pgId: string | null;
  pgName: string;
  orders: any[];
  masterData: any;
  kpi: number;
}

const COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#8b5cf6'];

export function PGDetailModal({ isOpen, onClose, pgId, pgName, orders, masterData, kpi }: PGDetailModalProps) {
  const formatCurrency = (val: number) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(val);

  const [viewingBillImages, setViewingBillImages] = useState<string[] | null>(null);
  const [isBillModalOpen, setIsBillModalOpen] = useState(false);
  const [loadingBill, setLoadingBill] = useState(false);

  const handleViewBill = async (cartId: string) => {
    setLoadingBill(true);
    setIsBillModalOpen(true);
    try {
      const { data, error } = await supabase
        .from('order_headers')
        .select('bill_image_url')
        .eq('cart_id', cartId)
        .single();
      
      if (error) {
        const { data: orderData, error: orderError } = await supabase
          .from('orders')
          .select('bill_image_url')
          .eq('cart_id', cartId)
          .not('bill_image_url', 'is', null)
          .limit(1)
          .single();
          
        if (orderError || !orderData?.bill_image_url) {
          setViewingBillImages([]);
          toast.error("Không tìm thấy ảnh hóa đơn cho đơn hàng này.");
        } else {
          setViewingBillImages(orderData.bill_image_url.split(','));
        }
      } else if (data?.bill_image_url) {
        setViewingBillImages(data.bill_image_url.split(','));
      } else {
        setViewingBillImages([]);
        toast.error("Đơn hàng này không có ảnh hóa đơn.");
      }
    } catch (err) {
      console.error("Lỗi khi tải ảnh bill:", err);
      toast.error("Lỗi khi tải ảnh hóa đơn.");
      setViewingBillImages([]);
    } finally {
      setLoadingBill(false);
    }
  };

  const data = useMemo(() => {
    if (!pgId || !orders || !masterData) return null;

    const pgOrders = orders.filter(o => o.pg_id === pgId);

    const totalSales = pgOrders.reduce((sum, o) => sum + Number(o.net_value || 0), 0);
    const cartCount = new Set(pgOrders.map(o => o.cart_id)).size;
    const kpiAchievement = kpi > 0 ? (totalSales / kpi) * 100 : 0;

    const totalQty = pgOrders.reduce((sum, o) => sum + Number(o.qty || 1), 0);
    const convertedQty = pgOrders.filter(o => o.is_competitor_product).reduce((sum, o) => sum + Number(o.qty || 1), 0);
    const conversionRate = totalQty > 0 ? (convertedQty / totalQty) * 100 : 0;

    const brandMap: Record<string, number> = {};
    const productMap: Record<string, number> = {};

    pgOrders.forEach(order => {
      const val = Number(order.net_value || 0);
      const product = masterData.products.find((p: any) => p.product_id === order.product_id);
      const brand = masterData.brands.find((b: any) => b.brand_id === product?.brand_id);

      const productName = product?.product_name || 'Không xác định';
      const brandName = brand?.brand_name || 'Khác';

      productMap[productName] = (productMap[productName] || 0) + val;
      brandMap[brandName] = (brandMap[brandName] || 0) + val;
    });

    const brandData = Object.entries(brandMap).map(([name, value]) => ({ name, value })).sort((a,b) => b.value - a.value);
    const productData = Object.entries(productMap).map(([name, value]) => ({ name, value })).sort((a,b) => b.value - a.value).slice(0, 5);

    const orderTableData = pgOrders.map(o => {
      const product = masterData.products.find((p: any) => p.product_id === o.product_id);
      return {
        id: o.id,
        date: o.created_at ? format(new Date(o.created_at), 'dd/MM/yyyy HH:mm') : '',
        cartId: o.cart_id,
        customerName: o.customer_name,
        customerPhone: o.customer_phone,
        productName: product?.product_name || 'Không xác định',
        qty: o.qty != null ? o.qty : 1,
        amount: o.net_value,
        note: o.is_competitor_product ? `Từ: ${o.switched_from_brand || 'Đối thủ'}` : ''
      };
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return {
      totalSales,
      cartCount,
      kpiAchievement,
      conversionRate,
      brandData,
      productData,
      orderTableData
    };
  }, [pgId, orders, masterData, kpi]);

  if (!isOpen || !data) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4 sm:p-6">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
          <h2 className="text-xl font-bold text-gray-900">Báo cáo chi tiết PG: <span className="text-indigo-600">{pgName}</span></h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 bg-gray-50">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100">
              <p className="text-sm font-medium text-gray-500 mb-1">Tổng doanh số</p>
              <p className="text-xl font-bold text-indigo-600">{formatCurrency(data.totalSales)}</p>
            </div>
            <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100">
              <p className="text-sm font-medium text-gray-500 mb-1">Số giỏ hàng</p>
              <p className="text-xl font-bold text-gray-900">{data.cartCount}</p>
            </div>
            <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100">
              <p className="text-sm font-medium text-gray-500 mb-1">Tỉ lệ đạt KPI</p>
              <p className={`text-xl font-bold ${data.kpiAchievement >= 100 ? 'text-green-600' : data.kpiAchievement >= 80 ? 'text-amber-500' : 'text-red-500'}`}>
                {data.kpiAchievement.toFixed(1)}%
              </p>
            </div>
            <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100">
              <p className="text-sm font-medium text-gray-500 mb-1">Tỉ lệ chuyển đổi</p>
              <p className="text-xl font-bold text-rose-600">{data.conversionRate.toFixed(1)}%</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <div className="bg-white shadow-sm rounded-lg p-5 border border-gray-100">
              <h3 className="text-md font-bold text-gray-800 mb-4">Tỉ trọng Nhóm hàng</h3>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={data.brandData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2} dataKey="value">
                      {data.brandData.map((_, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(value: number) => formatCurrency(value)} />
                    <Legend layout="vertical" verticalAlign="middle" align="right" />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white shadow-sm rounded-lg p-5 border border-gray-100">
              <h3 className="text-md font-bold text-gray-800 mb-4">Tỉ trọng Sản phẩm (Top 5)</h3>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={data.productData} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({name, percent}) => `${(percent * 100).toFixed(0)}%`}>
                      {data.productData.map((_, index) => <Cell key={`cell-${index}`} fill={COLORS[(index + 2) % COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(value: number) => formatCurrency(value)} />
                    <Legend layout="horizontal" verticalAlign="bottom" />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="bg-white shadow-sm rounded-lg border border-gray-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="text-md font-bold text-gray-800">Danh sách đơn hàng</h3>
            </div>
            <div className="overflow-x-auto max-h-80">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50 sticky top-0 z-10">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Thời gian</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Mã Giỏ (Cart ID)</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Khách hàng</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Sản phẩm</th>
                    <th className="px-4 py-3 text-center text-xs font-bold text-gray-500 uppercase tracking-wider">SL</th>
                    <th className="px-4 py-3 text-right text-xs font-bold text-gray-500 uppercase tracking-wider">Số tiền</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Ghi chú</th>
                    <th className="px-4 py-3 text-center text-xs font-bold text-gray-500 uppercase tracking-wider">Bill</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {data.orderTableData.map((row, idx) => (
                    <tr key={idx} className="hover:bg-gray-50">
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">{row.date}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 font-mono">{row.cartId?.substring(0, 8)}...</td>
                      <td className="px-4 py-3 text-sm">
                        <div className="text-gray-900 font-medium">{row.customerName || '-'}</div>
                        <div className="text-gray-500 text-[10px]">{row.customerPhone || ''}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 font-medium">{row.productName}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 text-center">{row.qty}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 text-right font-medium">{formatCurrency(row.amount)}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-rose-500 italic">{row.note}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-center">
                        <button 
                          onClick={() => handleViewBill(row.cartId)}
                          className="text-blue-600 hover:text-blue-800 p-1 rounded-full hover:bg-blue-50 transition-colors"
                          title="Xem hóa đơn"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {data.orderTableData.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-gray-500">Không có đơn hàng nào trong khoảng thời gian này.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* MODAL XEM ẢNH BILL */}
        <Modal 
          isOpen={isBillModalOpen} 
          onClose={() => { setIsBillModalOpen(false); setViewingBillImages(null); }} 
          title="Ảnh hóa đơn (Bill Images)"
        >
          <div className="space-y-4">
            {loadingBill ? (
              <div className="flex flex-col items-center justify-center py-10 space-y-3">
                <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
                <p className="text-sm text-gray-500">Đang tải ảnh hóa đơn...</p>
              </div>
            ) : viewingBillImages && viewingBillImages.length > 0 ? (
              <div className="grid grid-cols-1 gap-4">
                {viewingBillImages.map((url, idx) => (
                  <div key={idx} className="rounded-lg overflow-hidden border border-gray-200 shadow-sm">
                    <img 
                      src={url} 
                      alt={`Bill ${idx + 1}`} 
                      className="w-full h-auto object-contain max-h-[70vh]" 
                      referrerPolicy="no-referrer"
                    />
                    <div className="bg-gray-50 p-2 text-center text-xs text-gray-500 border-t border-gray-100">
                      Ảnh {idx + 1} / {viewingBillImages.length}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-10 text-gray-500">
                Không tìm thấy ảnh hóa đơn cho đơn hàng này.
              </div>
            )}
            <div className="flex justify-end mt-4">
              <button 
                onClick={() => { setIsBillModalOpen(false); setViewingBillImages(null); }} 
                className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg font-medium hover:bg-gray-200 transition-colors"
              >
                Đóng
              </button>
            </div>
          </div>
        </Modal>
      </div>
    </div>
  );
}
