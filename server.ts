import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));

  // API Route for Scanbill
  app.post('/api/v1/scan-bill', async (req, res) => {
    try {
      const { rawText, categoryList } = req.body;

      if (!rawText) {
        return res.status(400).json({ error: 'Thiếu dữ liệu văn bản (rawText)' });
      }

      const apiKey = process.env.VITE_GOOGLE_API_KEY || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: 'Lỗi cấu hình AI trên server' });
      }

      const ai = new GoogleGenAI({ apiKey });
      const promptText = `Bạn là hệ thống AI chuyên trích xuất dữ liệu hóa đơn siêu thị.

NHIỆM VỤ: 
Trích xuất TẤT CẢ các sản phẩm có từ đoạn văn bản hóa đơn được cung cấp dưới đây.
Với mỗi sản phẩm, hãy phân loại xem nó thuộc ngành hàng nào trong danh sách sau: [${categoryList || ''}]. Nếu không thuộc ngành hàng nào trong danh sách, hãy xếp vào loại "Khác".

HƯỚNG DẪN BÓC TÁCH GIÁ (CRITICAL):
Phải lấy đúng ĐƠN GIÁ (Unit Price) của 1 sản phẩm. KHÔNG lấy Thành tiền.
Cấu trúc hóa đơn thường hiển thị theo cặp dòng: 
- Dòng trên: [Tên Sản Phẩm]
- Dòng dưới: [Số lượng]      [Đơn giá]      [Thành tiền]

VĂN BẢN HÓA ĐƠN:
"""
${rawText}
"""

ĐỊNH DẠNG ĐẦU RA:
Trả về JSON với 'raw_name' (giữ nguyên từng chữ cái trên bill), 'qty' (số lượng), 'unit_price' (đơn giá), và 'category' (ngành hàng).`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: {
          parts: [
            { text: promptText }
          ]
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                raw_name: { type: Type.STRING },
                qty: { type: Type.NUMBER },
                unit_price: { type: Type.NUMBER },
                category: { type: Type.STRING }
              }
            }
          }
        }
      });

      let responseText = response.text || '[]';
      responseText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();

      const items = JSON.parse(responseText);
      return res.json({ items });

    } catch (error: any) {
      console.error('Lỗi API /api/v1/scan-bill:', error);
      const isQuota = error.message?.includes('429') || error.message?.includes('quota');
      return res.status(isQuota ? 429 : 500).json({ 
        error: isQuota ? 'AI đã hết lượt. Thử lại sau.' : 'Lỗi xử lý hóa đơn trên server.' 
      });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
