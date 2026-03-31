import React, { createContext, useContext, useEffect, useState } from 'react';

// Định nghĩa thông tin User dựa trên bảng public.profiles
export interface Profile {
  id: string;
  full_name: string;
  admin_role: boolean;
  phone_number: string;
  dob?: string;
  email?: string;
  login_pin?: string;
}

interface AuthContextType {
  user: Profile | null; // Gộp chung user và profile thành 1 cho dễ quản lý
  loading: boolean;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    console.log('AuthContext: Bắt đầu kiểm tra phiên đăng nhập bằng mã PIN');
    
    try {
      // Tìm thông tin user đã lưu trong LocalStorage từ bước Đăng nhập
      const storedUser = localStorage.getItem('canteen_user');
      
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
      // Dù thành công hay thất bại cũng phải tắt trạng thái loading để App chạy tiếp
      setLoading(false); 
    }
  }, []);

  const signOut = () => {
    console.log('Đang đăng xuất...');
    // Xóa sạch dấu vết trong bộ nhớ trình duyệt
    localStorage.removeItem('canteen_user');
    localStorage.clear();
    sessionStorage.clear();
    setUser(null);
    
    // Đẩy thẳng về trang chủ/trang đăng nhập
    window.location.href = '/'; 
  };

  return (
    <AuthContext.Provider value={{ user, loading, signOut }}>
      {!loading && children}
    </AuthContext.Provider>
  );
};

// Hook tiện ích để gọi ở các trang khác
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth phải được bọc bên trong AuthProvider');
  }
  return context;
};