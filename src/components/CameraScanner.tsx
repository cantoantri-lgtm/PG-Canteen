import React, { useRef, useState, useCallback, useEffect } from 'react';
import { Camera, X, RefreshCcw, Image as ImageIcon } from 'lucide-react';

interface CameraScannerProps {
  onCapture: (file: File) => void;
  onClose: () => void;
}

export default function CameraScanner({ onCapture, onClose }: CameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');

  const startCamera = useCallback(async () => {
    try {
      if (videoRef.current && videoRef.current.srcObject) {
        const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
        tracks.forEach(track => track.stop());
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facingMode, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setHasPermission(true);
    } catch (err) {
      console.error("Error accessing camera:", err);
      setHasPermission(false);
    }
  }, [facingMode]);

  useEffect(() => {
    startCamera();
    return () => {
      if (videoRef.current && videoRef.current.srcObject) {
        const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
        tracks.forEach(track => track.stop());
      }
    };
  }, [startCamera]);

  const handleCapture = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          if (blob) {
            const file = new File([blob], "scan.jpg", { type: "image/jpeg" });
            onCapture(file);
          }
        }, 'image/jpeg', 0.9);
      }
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onCapture(file);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col">
      {/* Header */}
      <div className="flex justify-between items-center p-4 text-white z-10 bg-gradient-to-b from-black/50 to-transparent">
        <button onClick={onClose} className="p-2 rounded-full bg-black/30 hover:bg-black/50">
          <X size={24} />
        </button>
        <div className="flex gap-4">
          <button onClick={() => setFacingMode(prev => prev === 'environment' ? 'user' : 'environment')} className="p-2 rounded-full bg-black/30 hover:bg-black/50">
            <RefreshCcw size={24} />
          </button>
        </div>
      </div>

      {/* Camera View */}
      <div className="flex-1 relative overflow-hidden flex items-center justify-center">
        {hasPermission === false ? (
          <div className="text-white text-center p-6">
            <p className="mb-4">Không có quyền truy cập camera.</p>
            <button onClick={() => fileInputRef.current?.click()} className="bg-purple-600 px-4 py-2 rounded-lg font-bold flex items-center justify-center gap-2 mx-auto">
              <ImageIcon size={20} /> Chọn ảnh từ thư viện
            </button>
          </div>
        ) : (
          <>
            <video 
              ref={videoRef} 
              playsInline 
              className="absolute min-w-full min-h-full object-cover"
            />
            
            {/* Bounding Box Overlay */}
            <div className="absolute inset-0 pointer-events-none flex flex-col">
              <div className="flex-1 bg-black/50"></div>
              <div className="flex justify-center">
                <div className="w-8 bg-black/50"></div>
                <div className="w-full max-w-sm aspect-[1/2] border-2 border-white/70 rounded-lg relative shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]">
                  {/* Corner markers */}
                  <div className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-green-400 rounded-tl-lg"></div>
                  <div className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-green-400 rounded-tr-lg"></div>
                  <div className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-green-400 rounded-bl-lg"></div>
                  <div className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-green-400 rounded-br-lg"></div>
                  
                  <div className="absolute inset-0 flex items-center justify-center">
                    <p className="text-white/70 text-sm font-medium text-center px-4 bg-black/30 py-2 rounded-full">
                      Đặt hóa đơn vừa vặn vào khung này
                    </p>
                  </div>
                </div>
                <div className="w-8 bg-black/50"></div>
              </div>
              <div className="flex-1 bg-black/50"></div>
            </div>
          </>
        )}
      </div>

      {/* Controls */}
      <div className="h-32 bg-black flex items-center justify-center gap-8 pb-8">
        <button onClick={() => fileInputRef.current?.click()} className="p-3 rounded-full bg-gray-800 text-white hover:bg-gray-700">
          <ImageIcon size={24} />
        </button>
        
        <button 
          onClick={handleCapture}
          disabled={!hasPermission}
          className="w-20 h-20 rounded-full border-4 border-white flex items-center justify-center disabled:opacity-50"
        >
          <div className="w-16 h-16 bg-white rounded-full active:scale-95 transition-transform"></div>
        </button>
        
        <div className="w-12"></div> {/* Spacer for centering */}
      </div>

      <canvas ref={canvasRef} className="hidden" />
      <input 
        type="file" 
        accept="image/*" 
        ref={fileInputRef} 
        onChange={handleFileUpload} 
        className="hidden" 
      />
    </div>
  );
}
