import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { Store } from 'lucide-react';

// Fix for default marker icon in react-leaflet
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

interface Shop {
  shop_id: string;
  shop_name: string;
  account_id: string;
  latitude?: number;
  longitude?: number;
  allowed_distance?: number;
  accounts?: { account_name: string };
}

export default function ShopMap() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAccountFilter, setSelectedAccountFilter] = useState('');

  // Lấy danh sách accounts để lọc
  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('accounts').select('*').order('account_name');
      if (error) throw error;
      return data;
    }
  });

  // Lấy danh sách shops
  const { data: shops = [], isLoading } = useQuery({
    queryKey: ['shops_map'],
    queryFn: async () => {
      const { data, error } = await supabase.from('shops').select('*, accounts(account_name)').order('shop_name');
      if (error) throw error;
      return data as Shop[];
    }
  });

  const filteredShops = useMemo(() => {
    return shops.filter(s => {
      const matchesSearch = s.shop_name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesAccount = selectedAccountFilter === '' || s.account_id === selectedAccountFilter;
      const hasCoordinates = s.latitude != null && s.longitude != null;
      return matchesSearch && matchesAccount && hasCoordinates;
    });
  }, [shops, searchQuery, selectedAccountFilter]);

  // Tính toán center của map dựa trên các shop được hiển thị
  const mapCenter = useMemo(() => {
    if (filteredShops.length === 0) return [10.762622, 106.660172] as [number, number]; // Default to HCMC
    
    const sumLat = filteredShops.reduce((sum, shop) => sum + (shop.latitude || 0), 0);
    const sumLng = filteredShops.reduce((sum, shop) => sum + (shop.longitude || 0), 0);
    
    return [sumLat / filteredShops.length, sumLng / filteredShops.length] as [number, number];
  }, [filteredShops]);

  if (isLoading) return <div className="p-8 text-center text-indigo-600 font-semibold animate-pulse">Đang tải bản đồ...</div>;

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Bản đồ Cửa hàng</h1>
          <p className="mt-1 text-sm text-gray-500">
            Hiển thị vị trí các cửa hàng đã được thiết lập tọa độ trên bản đồ.
          </p>
        </div>
      </div>

      <div className="bg-white shadow-sm ring-1 ring-gray-900/5 sm:rounded-xl mb-6 p-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tìm kiếm cửa hàng</label>
            <input
              type="text"
              placeholder="Nhập tên cửa hàng..."
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Lọc theo Account</label>
            <select
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
              value={selectedAccountFilter}
              onChange={(e) => setSelectedAccountFilter(e.target.value)}
            >
              <option value="">Tất cả Account</option>
              {accounts.map((acc: any) => (
                <option key={acc.account_id} value={acc.account_id}>{acc.account_name}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-4 text-sm text-gray-500">
          Hiển thị {filteredShops.length} cửa hàng có tọa độ (trên tổng số {shops.length} cửa hàng).
        </div>
      </div>

      <div className="bg-white shadow-sm ring-1 ring-gray-900/5 sm:rounded-xl overflow-hidden h-[600px] relative z-0">
        <MapContainer 
          center={mapCenter} 
          zoom={12} 
          scrollWheelZoom={true} 
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          
          {filteredShops.map((shop) => (
            <Marker 
              key={shop.shop_id} 
              position={[shop.latitude as number, shop.longitude as number]}
            >
              <Popup>
                <div className="p-1">
                  <h3 className="font-bold text-gray-900 flex items-center gap-2">
                    <Store className="h-4 w-4 text-indigo-600" />
                    {shop.shop_name}
                  </h3>
                  <p className="text-sm text-gray-600 mt-1">
                    <span className="font-medium">Account:</span> {shop.accounts?.account_name}
                  </p>
                  <p className="text-sm text-gray-600">
                    <span className="font-medium">Khoảng cách cho phép:</span> {shop.allowed_distance || 500}m
                  </p>
                  <div className="mt-2 text-xs text-gray-400 font-mono">
                    {shop.latitude}, {shop.longitude}
                  </div>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
    </div>
  );
}
