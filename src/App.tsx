/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/AuthContext';
import { supabase } from './lib/supabase';
import Layout from './components/Layout';
import AuthPage from './pages/AuthPage';
import AdminDashboard from './pages/AdminDashboard';
import PGDashboard from './pages/PGDashboard';
import Canteens from './pages/admin/Canteens';
import Brands from './pages/admin/Brands';
import Products from './pages/admin/Products';
import Schedules from './pages/admin/Schedules';
import KPIs from './pages/admin/KPIs';
import Profiles from './pages/admin/Profiles';
import Profile from './pages/Profile';
import Orders from './pages/admin/Orders';
import { Toaster } from 'sonner';

const ProtectedRoute = ({ children, requireAdmin = false }: { children: React.ReactNode, requireAdmin?: boolean }) => {
  const { user, loading } = useAuth();

  
  if (loading) return <div>Đang tải...</div>;
  if (!user) return <Navigate to="/" />;
  
  const isAdmin = user?.admin_role === true || user?.email?.toLowerCase() === 'can.toantri@gmail.com';
  if (requireAdmin && !isAdmin) return <Navigate to="/dashboard" />;

  return <>{children}</>;
};

const DashboardRouter = () => {
  const { user, loading } = useAuth();
  
  if (loading) return <div>Đang tải...</div>;
  
  const isAdmin = user?.admin_role === true || user?.email?.toLowerCase() === 'can.toantri@gmail.com';
  return isAdmin ? <AdminDashboard /> : <PGDashboard />;
};

export default function App() {
  return (
    <AuthProvider>
      <Router>
        <Toaster position="top-right" richColors />
        <Routes>
          <Route path="/" element={<AuthPage />} />
          
          {/* SỬA TẠI ĐÂY: Bọc ProtectedRoute xung quanh Layout */}
          <Route 
            path="/dashboard" 
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<DashboardRouter />} />
            <Route path="profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
            <Route path="admin/canteens" element={<ProtectedRoute requireAdmin><Canteens /></ProtectedRoute>} />
            <Route path="admin/brands" element={<ProtectedRoute requireAdmin><Brands /></ProtectedRoute>} />
            <Route path="admin/products" element={<ProtectedRoute requireAdmin><Products /></ProtectedRoute>} />
            <Route path="admin/schedules" element={<ProtectedRoute requireAdmin><Schedules /></ProtectedRoute>} />
            <Route path="admin/kpis" element={<ProtectedRoute requireAdmin><KPIs /></ProtectedRoute>} />
            <Route path="admin/profiles" element={<ProtectedRoute requireAdmin><Profiles /></ProtectedRoute>} />
            <Route path="admin/orders" element={<ProtectedRoute requireAdmin><Orders /></ProtectedRoute>} />
          </Route>
          
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}
