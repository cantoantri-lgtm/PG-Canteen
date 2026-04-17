import React, { useState } from 'react';
import { X, Sparkles, TrendingUp, TrendingDown, AlertCircle, Lightbulb, Calendar, BarChart3, Target, Award } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { useSmartReport } from '../hooks/useSmartReport';

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

  const { report, isLoading } = useSmartReport(masterData, isOpen, appliedFilters, isSup, user?.id);

  if (!isOpen) return null;

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
                            
                            <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-700 border border-gray-100">
                              <span className="font-semibold text-gray-900 block mb-1">Vấn đề:</span>
                              <div className="whitespace-pre-line">{rec.problem}</div>
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <div className="text-sm">
                                <span className="font-semibold text-gray-900 block mb-1">Nguyên nhân dự kiến:</span>
                                <p className="text-gray-600">{rec.cause}</p>
                              </div>
                              <div className="text-sm">
                                <span className="font-semibold text-purple-700 block mb-1">Giải pháp đề xuất:</span>
                                <p className="text-purple-600">{rec.solution}</p>
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
    </div>
  );
}
