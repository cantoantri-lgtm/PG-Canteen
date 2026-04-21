import React, { useState, useMemo } from 'react';
import { X, Sparkles, AlertCircle, Lightbulb, Calendar, BarChart3, Target, Award, LineChart as ChartIcon } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { useSmartReport } from '../hooks/useSmartReport';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { format, parseISO } from 'date-fns';

interface SmartReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  masterData: any;
  endDateStr?: string;
  appliedFilters?: any;
}

export function SmartReportModal({ isOpen, onClose, masterData, endDateStr, appliedFilters }: SmartReportModalProps) {
  const { user } = useAuth();
  const isSup = user?.role_name?.toUpperCase() === 'SUP' || user?.role_id === 'SUP';

  const [activeTab, setActiveTab] = useState<'daily' | 'monthly'>('monthly'); // Default to period view
  const [selectedEntityId, setSelectedEntityId] = useState<{ id: string, name: string, type: 'pg' | 'brand' } | null>(null);

  const { report, isLoading } = useSmartReport(masterData, isOpen, appliedFilters, isSup, user?.id);

  const chartData = useMemo(() => {
    if (!selectedEntityId || !report?.orders) return [];

    const orders = report.orders as any[];
    const filtered = selectedEntityId.type === 'pg' 
      ? orders.filter(o => o.pg_id === selectedEntityId.id)
      : orders.filter(o => o.brand_id === selectedEntityId.id);

    const dailyMap: Record<string, number> = {};
    filtered.forEach(o => {
      const date = format(parseISO(o.created_at), 'dd/MM');
      dailyMap[date] = (dailyMap[date] || 0) + Number(o.net_value || 0);
    });

    return Object.entries(dailyMap)
      .map(([date, sales]) => ({ date, sales }))
      .sort((a, b) => {
        const [da, ma] = a.date.split('/').map(Number);
        const [db, mb] = b.date.split('/').map(Number);
        return ma !== mb ? ma - mb : da - db;
      });
  }, [selectedEntityId, report?.orders]);

  if (!isOpen) return null;

  const highlightText = (text: string, pgIds: string[], brandIds: string[]) => {
    if (!text) return null;

    let parts: { text: string, id: string | null, type: 'pg' | 'brand' | null }[] = [{ text, id: null, type: null }];

    // Highlight PGs
    pgIds.forEach(id => {
      const name = masterData.profiles.find((p: any) => p.id === id)?.full_name;
      if (name) {
        let newParts: typeof parts = [];
        parts.forEach(p => {
          if (p.id) {
            newParts.push(p);
            return;
          }
          const subParts = p.text.split(name);
          subParts.forEach((sp, i) => {
            newParts.push({ text: sp, id: null, type: null });
            if (i < subParts.length - 1) {
              newParts.push({ text: name, id, type: 'pg' });
            }
          });
        });
        parts = newParts;
      }
    });

    // Highlight Brands
    brandIds.forEach(id => {
      const name = masterData.brands.find((b: any) => b.brand_id === id)?.brand_name;
      if (name) {
        let newParts: typeof parts = [];
        parts.forEach(p => {
          if (p.id) {
            newParts.push(p);
            return;
          }
          const subParts = p.text.split(name);
          subParts.forEach((sp, i) => {
            newParts.push({ text: sp, id: null, type: null });
            if (i < subParts.length - 1) {
              newParts.push({ text: name, id, type: 'brand' });
            }
          });
        });
        parts = newParts;
      }
    });

    return parts.map((p, i) => {
      if (p.id) {
        return (
          <button
            key={i}
            onClick={() => setSelectedEntityId({ id: p.id!, name: p.text, type: p.type! })}
            className="text-purple-600 font-bold hover:underline decoration-2 underline-offset-2 transition-all hover:text-purple-800"
          >
            {p.text}
          </button>
        );
      }
      return <span key={i}>{p.text}</span>;
    });
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden border border-purple-100">
        {/* Header */}
        <div className="bg-gradient-to-r from-purple-600 to-indigo-600 px-6 py-4 flex justify-between items-center shrink-0">
          <div className="flex items-center space-x-3">
            <div className="bg-white/20 p-2 rounded-lg">
              <Sparkles className="w-6 h-6 text-yellow-300" />
            </div>
            <h2 className="text-xl font-bold text-white">Báo Cáo Thông Minh (AI Analysis)</h2>
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white hover:bg-white/10 p-2 rounded-full transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 px-6 bg-gray-50/50 shrink-0">
          <button
            className={`px-6 py-4 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'daily'
                ? 'border-purple-600 text-purple-600 bg-purple-50/50'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
            onClick={() => setActiveTab('daily')}
          >
            Báo cáo ngày
          </button>
          <button
            className={`px-6 py-4 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'monthly'
                ? 'border-purple-600 text-purple-600 bg-purple-50/50'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
            onClick={() => setActiveTab('monthly')}
          >
            Báo cáo kỳ
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 bg-gray-50">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-64 space-y-4">
              <div className="w-12 h-12 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin"></div>
              <p className="text-gray-500 font-medium animate-pulse">Hệ thống đang tổng hợp và phân tích dữ liệu...</p>
            </div>
          ) : !report ? (
            <div className="flex flex-col items-center justify-center h-64 space-y-4">
              <div className="bg-gray-100 p-4 rounded-full">
                <AlertCircle className="w-8 h-8 text-gray-400" />
              </div>
              <p className="text-gray-500 font-medium">Không có dữ liệu để phân tích.</p>
            </div>
          ) : (
            <div className="space-y-8">
              {/* Summary Section */}
              <section className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
                <div className="flex items-center space-x-2 mb-6">
                  <BarChart3 className="w-5 h-5 text-purple-600" />
                  <h3 className="text-lg font-bold text-gray-900">Tổng Quan {activeTab === 'daily' ? 'Ngày' : 'Kỳ'}</h3>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                  <div className="bg-gradient-to-br from-purple-50 to-indigo-50 p-4 rounded-xl border border-purple-100/50">
                    <div className="flex items-center space-x-2 text-purple-700 mb-2">
                      <Calendar className="w-4 h-4" />
                      <span className="font-medium text-sm">Doanh số</span>
                    </div>
                    <p className="text-gray-800 font-semibold">{report[activeTab].summary.periodText}</p>
                  </div>
                  <div className="bg-gradient-to-br from-blue-50 to-cyan-50 p-4 rounded-xl border border-blue-100/50">
                    <div className="flex items-center space-x-2 text-blue-700 mb-2">
                      <Target className="w-4 h-4" />
                      <span className="font-medium text-sm">Tiến độ KPI</span>
                    </div>
                    <p className="text-gray-800 font-semibold">{report[activeTab].summary.kpiText}</p>
                  </div>
                </div>

                {report[activeTab].summary.highlights.length > 0 && (
                  <div className="bg-green-50/50 rounded-xl p-5 border border-green-100">
                    <div className="flex items-center space-x-2 mb-3">
                      <Award className="w-5 h-5 text-green-600" />
                      <h4 className="font-semibold text-green-800">Điểm sáng nổi bật</h4>
                    </div>
                    <ul className="space-y-2">
                      {report[activeTab].summary.highlights.map((h: string, i: number) => (
                        <li key={i} className="flex items-start space-x-2 text-green-700">
                          <span className="text-green-500 mt-1">•</span>
                          <span>{h}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>

              {/* Recommendations Section */}
              <section>
                <div className="flex items-center space-x-2 mb-4 px-1">
                  <Lightbulb className="w-5 h-5 text-amber-500" />
                  <h3 className="text-lg font-bold text-gray-900">Phân Tích & Đề Xuất Hành Động</h3>
                </div>
                
                {report[activeTab].recommendations.length === 0 ? (
                  <div className="bg-white rounded-xl p-8 text-center border border-gray-100 shadow-sm">
                    <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-green-100 mb-4">
                      <Sparkles className="w-6 h-6 text-green-600" />
                    </div>
                    <p className="text-gray-600 font-medium">Mọi chỉ số đều đang hoạt động tốt. Không có cảnh báo nào.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4">
                    {report[activeTab].recommendations.map((rec: any, i: number) => (
                      <div key={i} className="bg-white rounded-xl p-6 shadow-sm border border-red-100 hover:shadow-md transition-shadow">
                        <div className="flex items-start space-x-3">
                          <div className="bg-red-50 p-2 rounded-lg shrink-0 mt-1">
                            <AlertCircle className="w-5 h-5 text-red-500" />
                          </div>
                          <div className="space-y-3 flex-1">
                            <h4 className="text-base font-bold text-gray-900">{rec.title}</h4>
                            
                            <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-700 border border-gray-100 leading-relaxed">
                              <span className="font-bold text-gray-900 block mb-2 underline decoration-red-200 decoration-4">Cảnh báo vấn đề:</span>
                              <div className="whitespace-pre-line">
                                {highlightText(rec.problem, report[activeTab].problematicPgIds, report[activeTab].problematicBrandIds)}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      </div>

      {/* Sales Chart Modal Overlay */}
      {selectedEntityId && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] flex items-center justify-center z-[60] p-4 transition-all animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="bg-purple-700 p-4 flex justify-between items-center">
              <div className="flex items-center space-x-2 text-white">
                <ChartIcon className="w-5 h-5 text-purple-200" />
                <h3 className="font-bold">Biểu đồ doanh số: <span className="text-yellow-300">{selectedEntityId.name}</span></h3>
              </div>
              <button 
                onClick={() => setSelectedEntityId(null)}
                className="text-white/80 hover:text-white p-1 hover:bg-white/10 rounded-full"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6">
              <div className="h-64 w-full">
                {chartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.1}/>
                          <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                      <XAxis 
                        dataKey="date" 
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 11, fill: '#9ca3af' }}
                      />
                      <YAxis 
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 11, fill: '#9ca3af' }}
                        tickFormatter={(val) => `${(val / 1000000).toFixed(1)}M`}
                      />
                      <Tooltip 
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                        formatter={(value: number) => [new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(value), 'Doanh số']}
                      />
                      <Area 
                        type="monotone" 
                        dataKey="sales" 
                        stroke="#8b5cf6" 
                        strokeWidth={3}
                        fillOpacity={1} 
                        fill="url(#colorSales)" 
                        animationDuration={1000}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-500 font-medium">
                    Không có dữ liệu chi tiết cho thời kỳ này.
                  </div>
                )}
              </div>
              
              <div className="mt-6 flex justify-end">
                <button 
                  onClick={() => setSelectedEntityId(null)}
                  className="px-6 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-xl transition-colors"
                >
                  Đóng
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
