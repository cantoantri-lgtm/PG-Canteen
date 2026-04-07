import React, { createContext, useContext, useEffect, useState } from 'react';

// Định nghĩa thông tin User dựa trên bảng public.profiles
export interface Profile {
  id: string;
  full_name: string;
  admin_role: boolean;
  role?: string;
  phone_number: string;
  dob?: string;
  email?: string;
  login_pin?: string;
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
        setUser(JSON.parse(storedUser));
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