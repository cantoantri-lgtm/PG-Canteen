import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from './supabase';
import { toast } from 'sonner';

// Định nghĩa thông tin User dựa trên bảng public.profiles
export interface Profile {
  id: string;
  full_name: string;
  admin_role: boolean;
  role_id?: string;
  role_name?: string;
  phone_number: string;
  dob?: string;
  email?: string;
  login_pin?: string;
  manager_id?: string;
  status?: boolean;
}

interface AuthContextType {
  user: Profile | null;
  loading: boolean;
  signIn: (userData: Profile) => void; // Thêm hàm signIn để chuyển trang ngay lập tức
  signOut: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    console.log('AuthContext: Bắt đầu kiểm tra phiên đăng nhập bằng mã PIN');
    
    try {
      const storedUser = localStorage.getItem('shop_user');
      
      if (storedUser) {
        console.log('AuthContext: Đã tìm thấy tài khoản hợp lệ');
        const parsedUser = JSON.parse(storedUser);
        setUser(parsedUser);

        // Verify status and schedule asynchronously
        supabase.from('profiles').select('status, roles(role_name)').eq('id', parsedUser.id).single().then(async ({data, error}) => {
          if (error || !data || data.status === false) {
             // Invalid or inactive user -> logout
             localStorage.removeItem('shop_user');
             setUser(null);
             if (window.location.pathname !== '/') {
               toast.error("Tài khoản của bạn đã bị khóa hoặc không hoạt động. Đã tự động đăng xuất.");
               setTimeout(() => { window.location.href = '/'; }, 1500);
             }
             return;
          }
          
          const profileData = data as any;
          const roleName = Array.isArray(profileData.roles) ? profileData.roles[0]?.role_name : profileData.roles?.role_name;
          if (roleName?.toUpperCase() === 'PG') {
            const today = new Date().toISOString().split('T')[0];
            const { data: userSchedules, error: scheduleError } = await supabase
              .from('schedules')
              .select('schedule_id')
              .eq('pg_id', parsedUser.id)
              .lte('start_date', today)
              .gte('end_date', today);

            if (scheduleError || !userSchedules || userSchedules.length === 0) {
              // No schedule today -> logout
              localStorage.removeItem('shop_user');
              setUser(null);
              if (window.location.pathname !== '/') {
                toast.error("Bạn không có lịch bán hàng trong ngày hôm nay. Đã tự động đăng xuất.");
                setTimeout(() => { window.location.href = '/'; }, 1500);
              }
              return;
            }
          }
        });
      } else {
        console.log('AuthContext: Chưa có ai đăng nhập');
        setUser(null);
      }
    } catch (error) {
      console.error('AuthContext: Lỗi khi đọc LocalStorage:', error);
      setUser(null);
    } finally {
      setLoading(false); 
    }
  }, []);

  // Hàm đăng nhập: Lưu vào bộ nhớ và cập nhật giao diện ngay lập tức
  const signIn = (userData: Profile) => {
    localStorage.setItem('shop_user', JSON.stringify(userData));
    setUser(userData); 
  };

  const signOut = () => {
    console.log('Đang đăng xuất...');
    localStorage.removeItem('shop_user');
    localStorage.clear();
    sessionStorage.clear();
    setUser(null);
    
    window.location.href = '/'; 
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut }}>
      {!loading && children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth phải được bọc bên trong AuthProvider');
  }
  return context;
};