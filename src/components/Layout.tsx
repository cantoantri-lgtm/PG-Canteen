import React from 'react';
import { Outlet, Navigate, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { LogOut, LayoutDashboard, Calendar, Package, Users, Store, Tag, Target, ShoppingCart, UserCircle, FileText } from 'lucide-react';
import { cn } from '../lib/utils';

export default function Layout() {
  const { user, loading, signOut } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="flex h-screen items-center justify-center">Đang tải...</div>;
  }

  if (!user) {
    return <Navigate to="/" state={{ from: location }} replace />;
  }

  const isAdmin = user?.admin_role === true || 
                  user?.role === 'admin' || 
                  user?.role_name?.toUpperCase() === 'ADMIN' || 
                  user?.email?.toLowerCase() === 'can.toantri@gmail.com';
  const isSup = user?.role_name?.toUpperCase() === 'SUP';

  const adminNavigation = [
    { name: 'Bảng điều khiển', href: '/dashboard', icon: LayoutDashboard, category: 'Main' },
    { name: 'Người dùng', href: '/dashboard/admin/profiles', icon: Users, category: 'Người dùng, Vai trò' },
    { name: 'Vai trò (Roles)', href: '/dashboard/admin/roles', icon: Users, category: 'Người dùng, Vai trò' },
    { name: 'Channels', href: '/dashboard/admin/channels', icon: Store, category: 'Channel, Account, Cửa hàng' },
    { name: 'Accounts', href: '/dashboard/admin/accounts', icon: Store, category: 'Channel, Account, Cửa hàng' },
    { name: 'Cửa hàng (Shops)', href: '/dashboard/admin/shops', icon: Store, category: 'Channel, Account, Cửa hàng' },
    { name: 'Bản đồ Cửa hàng', href: '/dashboard/admin/shop-map', icon: Store, category: 'Channel, Account, Cửa hàng' },
    { name: 'Thương hiệu', href: '/dashboard/admin/brands', icon: Tag, category: 'Sản phẩm, Thương hiệu, Tồn kho' },
    { name: 'Nhóm sản phẩm', href: '/dashboard/admin/product-groups', icon: Package, category: 'Sản phẩm, Thương hiệu, Tồn kho' },
    { name: 'Sản phẩm', href: '/dashboard/admin/products', icon: Package, category: 'Sản phẩm, Thương hiệu, Tồn kho' },
    { name: 'Tồn kho', href: '/dashboard/admin/inventories', icon: Package, category: 'Sản phẩm, Thương hiệu, Tồn kho' },
    { name: 'Chương trình', href: '/dashboard/admin/programs', icon: Target, category: 'Hoạt động' },
    { name: 'Khuyến mãi', href: '/dashboard/admin/promotions', icon: Target, category: 'Hoạt động' },
    { name: 'Lịch bán hàng', href: '/dashboard/admin/schedules', icon: Calendar, category: 'Hoạt động' },
    { name: 'Chỉ tiêu doanh số', href: '/dashboard/admin/kpis', icon: Target, category: 'Hoạt động' },
    { name: 'Nhập đơn hàng bán', href: '/dashboard/admin/orders', icon: ShoppingCart, category: 'Đơn hàng' },
    { name: 'Báo cáo PG', href: '/dashboard/report', icon: FileText, category: 'Báo cáo' },
    { name: 'Báo cáo Chương trình', href: '/dashboard/admin/program-report', icon: FileText, category: 'Báo cáo' },
  ];

  const supNavigation = [
    { name: 'Bảng điều khiển', href: '/dashboard', icon: LayoutDashboard, category: 'Main' },
    { name: 'Quản lý PG', href: '/dashboard/admin/profiles', icon: Users, category: 'Người dùng' },
    { name: 'Tồn kho', href: '/dashboard/admin/inventories', icon: Package, category: 'Sản phẩm, Thương hiệu, Tồn kho' },
    { name: 'Chương trình', href: '/dashboard/admin/programs', icon: Target, category: 'Hoạt động' },
    { name: 'Phân công lịch làm việc', href: '/dashboard/admin/schedules', icon: Calendar, category: 'Hoạt động' },
    { name: 'Đơn hàng', href: '/dashboard/admin/orders', icon: ShoppingCart, category: 'Đơn hàng' },
    { name: 'Báo cáo PG', href: '/dashboard/report', icon: FileText, category: 'Báo cáo' },
    { name: 'Báo cáo Chương trình', href: '/dashboard/admin/program-report', icon: FileText, category: 'Báo cáo' },
  ];

  const pgNavigation = [
    { name: 'Bảng điều khiển & Đơn hàng', href: '/dashboard', icon: LayoutDashboard, category: 'Main' },
    { name: 'Báo cáo cuối ngày', href: '/dashboard/report', icon: FileText, category: 'Báo cáo' },
    { name: 'Hồ sơ cá nhân', href: '/dashboard/profile', icon: UserCircle, category: 'Cá nhân' },
  ];

  const navigation = isAdmin ? adminNavigation : (isSup ? supNavigation : pgNavigation);

  // Group navigation by category
  const groupedNav = navigation.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {} as Record<string, typeof navigation>);

  return (
    <div className="flex h-screen flex-col md:flex-row bg-gray-100">
      {/* Sidebar for desktop, bottom nav for mobile */}
      <nav className="md:w-64 bg-white border-r border-gray-200 flex-shrink-0 flex md:flex-col justify-between md:justify-start fixed bottom-0 w-full md:relative z-10">
        <div className="p-4 hidden md:block border-b border-gray-200">
          <h1 className="text-xl font-bold text-gray-800">DUC PG Activation Web APP</h1>
          <p className="text-sm text-gray-500 mt-1">{user?.full_name}</p>
          <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10 mt-2">
            {isAdmin ? 'Quản trị viên' : (isSup ? 'Supervisor' : 'Nhân viên PG')}
          </span>
        </div>
        
        <div className="flex-1 overflow-y-auto py-2 flex md:flex-col justify-around md:justify-start w-full px-2 md:px-0">
          {Object.entries(groupedNav).map(([category, items]) => (
            <div key={category} className="md:mb-4 flex-1 md:flex-none flex md:block">
              {category !== 'Main' && (
                <h3 className="px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider hidden md:block mb-2 mt-4">
                  {category}
                </h3>
              )}
              <div className="flex md:flex-col w-full justify-around md:justify-start">
                {items.map((item) => {
                  const isActive = location.pathname === item.href;
                  return (
                    <Link
                      key={item.name}
                      to={item.href}
                      className={cn(
                        isActive
                          ? 'bg-gray-100 text-indigo-600'
                          : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
                        'group flex flex-col md:flex-row items-center px-3 py-2 text-xs md:text-sm font-medium rounded-md md:mx-2 md:my-1 flex-1 md:flex-none justify-center md:justify-start'
                      )}
                    >
                      <item.icon
                        className={cn(
                          isActive ? 'text-indigo-600' : 'text-gray-400 group-hover:text-gray-500',
                          'md:mr-3 h-5 w-5 md:h-6 md:w-6 mb-1 md:mb-0 flex-shrink-0'
                        )}
                        aria-hidden="true"
                      />
                      <span className="text-center md:text-left">{item.name}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        
        <div className="p-2 md:p-4 border-t border-gray-200 hidden md:block">
          <button
            onClick={signOut}
            className="group flex w-full items-center px-2 py-2 text-sm font-medium text-gray-600 rounded-md hover:bg-gray-50 hover:text-gray-900"
          >
            <LogOut className="mr-3 h-6 w-6 text-gray-400 group-hover:text-gray-500" />
            Đăng xuất
          </button>
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto pb-16 md:pb-0">
        {/* Mobile header */}
        <div className="md:hidden bg-white border-b border-gray-200 p-4 flex justify-between items-center sticky top-0 z-10">
          <div>
            <h1 className="text-lg font-bold text-gray-800">DUC PG Activation Web APP</h1>
            <p className="text-xs text-gray-500">{user?.full_name} ({isAdmin ? 'Quản trị viên' : (isSup ? 'Supervisor' : 'Nhân viên PG')})</p>
          </div>
          <button onClick={signOut} className="text-gray-500 p-2">
            <LogOut className="h-5 w-5" />
          </button>
        </div>
        
        <div className="p-4 md:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
