/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, Component, ErrorInfo, ReactNode } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/AuthContext';
import { supabase } from './lib/supabase';
import Layout from './components/Layout';
import AuthPage from './pages/AuthPage';
import AdminDashboard from './pages/AdminDashboard';
import PGDashboard from './pages/PGDashboard';
import Shops from './pages/admin/Shops';
import ShopMap from './pages/admin/ShopMap';
import Brands from './pages/admin/Brands';
import ProductGroups from './pages/admin/ProductGroups';
import Products from './pages/admin/Products';
import Schedules from './pages/admin/Schedules';
import KPIs from './pages/admin/KPIs';
import Profiles from './pages/admin/Profiles';
import Profile from './pages/Profile';
import Orders from './pages/admin/Orders';
import PGReport from './pages/PGReport';
import ProgramReport from './pages/admin/ProgramReport';
import Roles from './pages/admin/Roles';
import Channels from './pages/admin/Channels';
import Accounts from './pages/admin/Accounts';
import Programs from './pages/admin/Programs';
import Promotions from './pages/admin/Promotions';
import Inventories from './pages/admin/Inventories';
import SupReport from './pages/admin/SupReport';
import { Toaster } from 'sonner';

class ErrorBoundary extends Component<{children: ReactNode}, {hasError: boolean, error: Error | null}> {
  constructor(props: {children: ReactNode}) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) { return { hasError: true, error }; }
  componentDidCatch(error: Error, errorInfo: ErrorInfo) { console.error("UI Lỗi:", error, errorInfo); }
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 text-center text-red-600 bg-red-50 min-h-screen">
          <h1 className="text-2xl font-bold mb-4">Đã xảy ra lỗi giao diện</h1>
          <p className="mb-4 text-red-700 font-semibold">{this.state.error?.message}</p>
          <pre className="text-left bg-gray-100 p-4 overflow-auto text-xs text-gray-800 mb-4 h-64 border border-gray-300">
            {this.state.error?.stack}
          </pre>
          <button onClick={() => window.location.href = '/dashboard'} className="px-4 py-2 bg-indigo-600 text-white rounded">Quay lại trang chính</button>

        </div>
      );
    }
    return this.props.children;
  }
}

const ProtectedRoute = ({ children, requireAdmin = false, allowSup = false }: { children: React.ReactNode, requireAdmin?: boolean, allowSup?: boolean }) => {
  const { user, loading } = useAuth();
  
  if (loading) return <div>Đang tải...</div>;
  if (!user) return <Navigate to="/" />;
  
  const isAdmin = user?.admin_role === true || 
                  user?.role_id === 'admin' || 
                  user?.role_name?.toUpperCase() === 'ADMIN' || 
                  user?.email?.toLowerCase() === 'can.toantri@gmail.com';
  const isSup = user?.role_name?.toUpperCase() === 'SUP' || user?.role_id === 'SUP';
  
  if (requireAdmin && !isAdmin && !(allowSup && isSup)) return <Navigate to="/dashboard" />;

  return <>{children}</>;
};

const DashboardRouter = () => {
  const { user, loading } = useAuth();
  
  if (loading) return <div>Đang tải...</div>;
  
  const isAdmin = user?.admin_role === true || 
                  user?.role_id === 'admin' || 
                  user?.role_name?.toUpperCase() === 'ADMIN' || 
                  user?.email?.toLowerCase() === 'can.toantri@gmail.com';
  const isSup = user?.role_name?.toUpperCase() === 'SUP' || user?.role_id === 'SUP';
  return (isAdmin || isSup) ? <AdminDashboard /> : <PGDashboard />;
};

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <Router>
          <Toaster position="top-right" richColors />
          <Routes>
          <Route path="/" element={<AuthPage />} />
          
          <Route 
            path="/dashboard" 
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<DashboardRouter />} />
            <Route path="profile" element={<Profile />} />
            <Route path="report" element={<PGReport />} />
            <Route path="admin/sup-report" element={<ProtectedRoute requireAdmin allowSup><SupReport /></ProtectedRoute>} />
            <Route path="admin/program-report" element={<ProtectedRoute requireAdmin allowSup><ProgramReport /></ProtectedRoute>} />
            <Route path="admin/shops" element={<ProtectedRoute requireAdmin><Shops /></ProtectedRoute>} />
            <Route path="admin/shop-map" element={<ProtectedRoute requireAdmin><ShopMap /></ProtectedRoute>} />
            <Route path="admin/brands" element={<ProtectedRoute requireAdmin><Brands /></ProtectedRoute>} />
            <Route path="admin/product-groups" element={<ProtectedRoute requireAdmin><ProductGroups /></ProtectedRoute>} />
            <Route path="admin/products" element={<ProtectedRoute requireAdmin><Products /></ProtectedRoute>} />
            <Route path="admin/schedules" element={<ProtectedRoute requireAdmin allowSup><Schedules /></ProtectedRoute>} />
            <Route path="admin/kpis" element={<ProtectedRoute requireAdmin><KPIs /></ProtectedRoute>} />
            <Route path="admin/profiles" element={<ProtectedRoute requireAdmin allowSup><Profiles /></ProtectedRoute>} />
            <Route path="admin/orders" element={<ProtectedRoute requireAdmin allowSup><Orders /></ProtectedRoute>} />
            <Route path="admin/roles" element={<ProtectedRoute requireAdmin><Roles /></ProtectedRoute>} />
            <Route path="admin/channels" element={<ProtectedRoute requireAdmin><Channels /></ProtectedRoute>} />
            <Route path="admin/accounts" element={<ProtectedRoute requireAdmin><Accounts /></ProtectedRoute>} />
            <Route path="admin/programs" element={<ProtectedRoute requireAdmin allowSup><Programs /></ProtectedRoute>} />
            <Route path="admin/promotions" element={<ProtectedRoute requireAdmin><Promotions /></ProtectedRoute>} />
            <Route path="admin/inventories" element={<ProtectedRoute requireAdmin allowSup><Inventories /></ProtectedRoute>} />
          </Route>
          
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </AuthProvider>
    </ErrorBoundary>
  );
}
