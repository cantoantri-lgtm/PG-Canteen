import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { Phone, Lock, LogIn, Store, Fingerprint } from 'lucide-react';
import { isWebAuthnSupported, registerBiometric, authenticateBiometric } from '../lib/webauthn';

export default function AuthPage() {
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [enableBiometric, setEnableBiometric] = useState(false);
  const [hasBiometric, setHasBiometric] = useState(false);
  const [bioSupported, setBioSupported] = useState(false);
  const navigate = useNavigate();

  // Kiểm tra đăng nhập bằng LocalStorage thay vì useAuth
  useEffect(() => {
    const storedUser = localStorage.getItem('shop_user');
    if (storedUser) {
      navigate('/dashboard', { replace: true });
    }
    
    if (isWebAuthnSupported()) {
      setBioSupported(true);
    }
    if (localStorage.getItem('biometric_cred_id')) {
      setHasBiometric(true);
    }
  }, [navigate]);

  const handleBiometricLogin = async () => {
    setLoading(true);
    try {
      const authPhone = await authenticateBiometric();
      if (authPhone) {
        setPhone(authPhone);
        const { data, error } = await supabase
          .from('profiles')
          .select('*, roles(role_name)')
          .eq('phone_number', authPhone)
          .single();
          
        if (error || !data) {
          toast.error("Không tìm thấy thông tin tài khoản!");
          setLoading(false);
          return;
        }
        if (data.status === false) {
          toast.error("Tài khoản đã bị khóa.");
          setLoading(false);
          return;
        }
        
        const userData = {
          ...data,
          role_name: Array.isArray(data.roles) ? data.roles[0]?.role_name : data.roles?.role_name
        };
        localStorage.setItem('shop_user', JSON.stringify(userData));
        toast.success(`Đăng nhập thành công!`);
        window.location.href = '/dashboard';
      }
    } catch (err: any) {
      toast.error(err.message || 'Lỗi xác thực sinh trắc học.');
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // 1. Truy vấn trực tiếp vào bảng profiles để tìm số điện thoại
      const { data, error } = await supabase
        .from('profiles')
        .select('*, roles(role_name)')
        .eq('phone_number', phone.trim())
        .single(); // single() sẽ báo lỗi nếu không tìm thấy hoặc tìm thấy > 1 dòng

      if (error) {
        console.error('Lỗi truy vấn dữ liệu:', error);
        if (error.message?.includes('exceed_storage_size_quota')) {
          toast.error("Hệ thống Database đang bị khóa do vượt quá dung lượng lưu trữ (Quota Exceeded). Vui lòng kiểm tra lại Supabase!");
        } else {
          toast.error("Lỗi hệ thống hoặc Số điện thoại không tồn tại!");
        }
        setLoading(false);
        return;
      }
      
      if (!data) {
        toast.error("Số điện thoại không tồn tại trong hệ thống!");
        setLoading(false);
        return;
      }

      if (data.status === false) {
        toast.error("Tài khoản của bạn đã bị khóa hoặc không hoạt động. Vui lòng liên hệ quản trị viên.");
        setLoading(false);
        return;
      }

      const roleName = Array.isArray(data.roles) ? data.roles[0]?.role_name : data.roles?.role_name;
      
      if (roleName?.toUpperCase() === 'PG') {
        const today = new Date().toISOString().split('T')[0];
        const { data: userSchedules, error: scheduleError } = await supabase
          .from('schedules')
          .select('schedule_id')
          .eq('pg_id', data.id)
          .lte('start_date', today)
          .gte('end_date', today);

        if (scheduleError || !userSchedules || userSchedules.length === 0) {
          toast.error("Bạn không có lịch bán hàng trong ngày hôm nay. Thuê bao đã bị từ chối truy cập.");
          setLoading(false);
          return;
        }
      }

      // 2. Lấy mã PIN từ database để kiểm tra
      const storedPin = data.login_pin ? String(data.login_pin) : '123456';
      
      if (storedPin !== pin.trim()) {
        toast.error("Mã PIN không đúng!");
        setLoading(false);
        return;
      }

      // Setup biometric if requested
      if (enableBiometric) {
        try {
          await registerBiometric(phone.trim(), data.full_name);
          toast.success("Đã thiết lập đăng nhập sinh trắc học thành công!");
        } catch (bioError) {
          console.error("Biometric setup failed:", bioError);
          toast.error("Không thể thiết lập sinh trắc học. Bạn vẫn được đăng nhập bình thường.");
        }
      }

      // 4. Nếu mọi thứ đúng, lưu thông tin vào LocalStorage
      const userData = {
        ...data,
        role_name: Array.isArray(data.roles) ? data.roles[0]?.role_name : data.roles?.role_name
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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-indigo-100 p-4 sm:p-6 lg:p-8">
      <div className="max-w-md w-full">
        {/* Logo/Header Section */}
        <div className="text-center mb-8">
          <div className="mx-auto h-16 w-16 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-200 mb-4 transform transition-transform hover:scale-105">
            <Store className="h-8 w-8 text-white" />
          </div>
          <h2 className="text-3xl font-extrabold text-gray-900 tracking-tight">
            PG Canteen
          </h2>
          <p className="mt-2 text-sm text-gray-600">
            Đăng nhập để quản lý công việc của bạn
          </p>
        </div>

        {/* Login Card */}
        <div className="bg-white py-8 px-6 shadow-2xl rounded-3xl sm:px-10 border border-gray-100">
          {hasBiometric && (
            <div className="mb-6">
              <button
                type="button"
                onClick={handleBiometricLogin}
                disabled={loading}
                className="w-full flex justify-center items-center py-4 px-4 border border-transparent rounded-xl shadow-md text-base font-bold text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-all duration-200 disabled:opacity-70"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Đang xử lý...
                  </>
                ) : (
                  <>
                    <Fingerprint className="w-6 h-6 mr-2" />
                    Đăng nhập bằng Sinh trắc học
                  </>
                )}
              </button>
              <div className="mt-6 flex items-center justify-center">
                <div className="h-px bg-gray-200 w-full"></div>
                <span className="px-4 text-sm text-gray-500 whitespace-nowrap">Hoặc dùng mật khẩu</span>
                <div className="h-px bg-gray-200 w-full"></div>
              </div>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-6">
            <div>
              <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1">
                Số điện thoại
              </label>
              <div className="relative rounded-xl shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Phone className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  id="phone"
                  type="tel"
                  required
                  className="block w-full pl-10 pr-3 py-3 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200 sm:text-sm"
                  placeholder="Ví dụ: 0909987220"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label htmlFor="pin" className="block text-sm font-medium text-gray-700 mb-1">
                Mã PIN
              </label>
              <div className="relative rounded-xl shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  id="pin"
                  type="password"
                  maxLength={6}
                  required
                  className="block w-full pl-10 pr-3 py-3 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200 text-center tracking-[0.5em] font-mono text-lg"
                  placeholder="••••••"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                />
              </div>
            </div>
            
            {bioSupported && !hasBiometric && (
              <div className="flex items-center">
                <input
                  id="biometric"
                  type="checkbox"
                  className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                  checked={enableBiometric}
                  onChange={(e) => setEnableBiometric(e.target.checked)}
                />
                <label htmlFor="biometric" className="ml-2 block text-sm text-gray-900">
                  Sử dụng Face ID / Touch ID cho lần sau
                </label>
              </div>
            )}

            <div className="space-y-4">
              <button
                type="submit"
                disabled={loading}
                className={`w-full flex justify-center items-center py-3.5 px-4 border rounded-xl shadow-sm text-sm font-bold transition-all duration-200 disabled:opacity-70 disabled:cursor-not-allowed ${
                  hasBiometric 
                    ? 'border-gray-300 text-gray-700 bg-white hover:bg-gray-50 focus:ring-indigo-500' 
                    : 'border-transparent text-white bg-indigo-600 hover:bg-indigo-700 focus:ring-indigo-500 focus:ring-offset-2 focus:outline-none focus:ring-2'
                }`}
              >
                {loading ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Đang đăng nhập...
                  </>
                ) : (
                  <>
                    <LogIn className="w-5 h-5 mr-2" />
                    ĐĂNG NHẬP {hasBiometric && 'BẰNG MẬT KHẨU'}
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
        
        {/* Footer */}
        <p className="mt-8 text-center text-xs text-gray-500">
          &copy; {new Date().getFullYear()} PG Canteen System. All rights reserved.
        </p>
      </div>
    </div>
  );
}