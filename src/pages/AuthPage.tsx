import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { toast } from 'sonner';
import { useAuth } from '../lib/AuthContext'; // Nhúng context để kiểm tra đăng nhập
import { useNavigate } from 'react-router-dom';

export default function AuthPage() {
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const { user } = useAuth(); // Lấy thông tin user hiện tại
  const navigate = useNavigate();

  // TỰ ĐỘNG CHUYỂN TRANG NẾU ĐÃ ĐĂNG NHẬP
  useEffect(() => {
    if (user) {
      navigate('/dashboard', { replace: true });
    }
  }, [user, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Gọi hàm đăng nhập bằng SĐT
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('phone_number', phone.trim())
        .single();

      if (error || !data) {
        console.error('Lỗi tìm tài khoản:', error);
        toast.error("Số điện thoại không tồn tại!");
        setLoading(false);
        return;
      }

      // Kiểm tra mã PIN (so sánh chuỗi để tránh lỗi kiểu dữ liệu)
      // Nếu trong database chưa có mã PIN (null), mặc định là 123456
      const storedPin = data.login_pin ? String(data.login_pin) : '123456';
      
      if (storedPin !== pin.trim()) {
        toast.error("Mã PIN không đúng!");
        setLoading(false);
        return;
      }

      // Lưu thông tin vào LocalStorage
      const loggedInUser = data;
      localStorage.setItem('canteen_user', JSON.stringify(loggedInUser));
      
      toast.success(`Chào mừng ${loggedInUser.full_name}!`);
      
      // Chuyển hướng
      // Force reload to ensure AuthContext picks up the new user from localStorage
      window.location.href = '/dashboard';

    } catch (err) {
      console.error('Lỗi kết nối:', err);
      toast.error("Lỗi mạng! Vui lòng kiểm tra lại kết nối.");
      setLoading(false); // Nhả nút bấm nếu rớt mạng
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-indigo-50 p-4">
      <div className="max-w-md w-full bg-white p-8 rounded-2xl shadow-xl">
        <h2 className="text-center text-2xl font-bold text-gray-800 mb-8">PG CANTEEN LOGIN</h2>
        <form onSubmit={handleLogin} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700">Số điện thoại</label>
            <input
              type="text"
              required
              className="mt-1 block w-full border rounded-lg p-3 text-lg"
              placeholder="Ví dụ: 0909987220"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Mã PIN (6 số)</label>
            <input
              type="password"
              maxLength={6}
              required
              className="mt-1 block w-full border rounded-lg p-3 text-center text-2xl tracking-widest"
              placeholder="••••••"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 text-white py-3 rounded-lg font-bold hover:bg-indigo-700 transition-colors disabled:opacity-50"
          >
            {loading ? 'Đang vào hệ thống...' : 'ĐĂNG NHẬP'}
          </button>
        </form>
      </div>
    </div>
  );
}