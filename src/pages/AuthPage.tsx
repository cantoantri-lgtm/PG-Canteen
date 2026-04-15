import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';

export default function AuthPage() {
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  // Kiểm tra đăng nhập bằng LocalStorage thay vì useAuth
  useEffect(() => {
    const storedUser = localStorage.getItem('shop_user');
    if (storedUser) {
      navigate('/dashboard', { replace: true });
    }
  }, [navigate]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      // 1. Truy vấn trực tiếp vào bảng profiles để tìm số điện thoại
      const { data, error } = await supabase
        .from('profiles')
        .select('*, roles(role_name)')
        .eq('phone_number', phone.trim())
        .single(); // single() sẽ báo lỗi nếu không tìm thấy hoặc tìm thấy > 1 dòng

      if (error || !data) {
        console.error('Lỗi tìm tài khoản:', error);
        toast.error("Số điện thoại không tồn tại trong hệ thống!");
        setLoading(false);
        return;
      }

      // 2. Lấy mã PIN từ database để kiểm tra
      const storedPin = data.login_pin ? String(data.login_pin) : '123456';
      
      if (storedPin !== pin.trim()) {
        toast.error("Mã PIN không đúng!");
        setLoading(false);
        return;
      }

      // 4. Nếu mọi thứ đúng, lưu thông tin vào LocalStorage
      const userData = {
        ...data,
        role_name: data.roles?.role_name
      };
      localStorage.setItem('shop_user', JSON.stringify(userData));
      
      toast.success(`Chào mừng ${data.full_name}!`);
      
      // Chuyển hướng về trang dashboard
      window.location.href = '/dashboard';

    } catch (err) {
      console.error('Lỗi kết nối:', err);
      toast.error("Lỗi mạng! Vui lòng kiểm tra lại kết nối.");
      setLoading(false);
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
              className="mt-1 block w-full border rounded-lg p-3 text-lg focus:ring-indigo-500 focus:border-indigo-500"
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
              className="mt-1 block w-full border rounded-lg p-3 text-center text-2xl tracking-widest focus:ring-indigo-500 focus:border-indigo-500"
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