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
import Shops from './pages/admin/Shops';
import Brands from './pages/admin/Brands';
import ProductGroups from './pages/admin/ProductGroups';
import Products from './pages/admin/Products';
import Schedules from './pages/admin/Schedules';
import KPIs from './pages/admin/KPIs';
import Profiles from './pages/admin/Profiles';
import Profile from './pages/Profile';
import Orders from './pages/admin/Orders';
import PGReport from './pages/PGReport';
import Roles from './pages/admin/Roles';
import Channels from './pages/admin/Channels';
import Accounts from './pages/admin/Accounts';
import Programs from './pages/admin/Programs';
import Promotions from './pages/admin/Promotions';
import Inventories from './pages/admin/Inventories';
import { Toaster } from 'sonner';

const ProtectedRoute = ({ children, requireAdmin = false }: { children: React.ReactNode, requireAdmin?: boolean }) => {
  const { user, loading } = useAuth();
  
  if (loading) return <div>Đang tải...</div>;
  if (!user) return <Navigate to="/" />;
  
  const isAdmin = user?.admin_role === true || user?.role === 'admin' || user?.email?.toLowerCase() === 'can.toantri@gmail.com';
  if (requireAdmin && !isAdmin) return <Navigate to="/dashboard" />;

  return <>{children}</>;
};

const DashboardRouter = () => {
  const { user, loading } = useAuth();
  
  if (loading) return <div>Đang tải...</div>;
  
  const isAdmin = user?.admin_role === true || user?.role === 'admin' || user?.email?.toLowerCase() === 'can.toantri@gmail.com';
  return isAdmin ? <AdminDashboard /> : <PGDashboard />;
};

export default function App() {
  return (
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
            <Route path="profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
            <Route path="report" element={<ProtectedRoute><PGReport /></ProtectedRoute>} />
            <Route path="admin/shops" element={<ProtectedRoute requireAdmin><Shops /></ProtectedRoute>} />
            <Route path="admin/brands" element={<ProtectedRoute requireAdmin><Brands /></ProtectedRoute>} />
            <Route path="admin/product-groups" element={<ProtectedRoute requireAdmin><ProductGroups /></ProtectedRoute>} />
            <Route path="admin/products" element={<ProtectedRoute requireAdmin><Products /></ProtectedRoute>} />
            <Route path="admin/schedules" element={<ProtectedRoute requireAdmin><Schedules /></ProtectedRoute>} />
            <Route path="admin/kpis" element={<ProtectedRoute requireAdmin><KPIs /></ProtectedRoute>} />
            <Route path="admin/profiles" element={<ProtectedRoute requireAdmin><Profiles /></ProtectedRoute>} />
            <Route path="admin/orders" element={<ProtectedRoute requireAdmin><Orders /></ProtectedRoute>} />
            <Route path="admin/roles" element={<ProtectedRoute requireAdmin><Roles /></ProtectedRoute>} />
            <Route path="admin/channels" element={<ProtectedRoute requireAdmin><Channels /></ProtectedRoute>} />
            <Route path="admin/accounts" element={<ProtectedRoute requireAdmin><Accounts /></ProtectedRoute>} />
            <Route path="admin/programs" element={<ProtectedRoute requireAdmin><Programs /></ProtectedRoute>} />
            <Route path="admin/promotions" element={<ProtectedRoute requireAdmin><Promotions /></ProtectedRoute>} />
            <Route path="admin/inventories" element={<ProtectedRoute requireAdmin><Inventories /></ProtectedRoute>} />
          </Route>
          
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}
