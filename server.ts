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
      const { rawText, imageBase64, mimeType, categoryList, modelName } = req.body;

      if (!rawText && !imageBase64) {
        return res.status(400).json({ error: 'Thiếu dữ liệu (văn bản hoặc hình ảnh)' });
      }

      const apiKey = process.env.VITE_GOOGLE_API_KEY || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: 'Lỗi cấu hình AI trên server' });
      }

      const ai = new GoogleGenAI({ apiKey });
      const activeModel = modelName || 'gemini-1.5-flash-8b';

      let promptText = `Bạn là hệ thống AI chuyên trích xuất dữ liệu hóa đơn siêu thị.

NHIỆM VỤ: 
Trích xuất TẤT CẢ các sản phẩm có từ hóa đơn được cung cấp (hình ảnh hoặc văn bản bên dưới). Hãy ưu tiên đọc từ hình ảnh hóa đơn (nếu có) vì nó chính xác hơn, văn bản OCR có thể có lỗi.
Với mỗi sản phẩm, hãy phân loại xem nó thuộc ngành hàng nào trong danh sách sau: [${categoryList || ''}]. Nếu không thuộc ngành hàng nào trong danh sách, hãy xếp vào loại "Khác".

HƯỚNG DẪN BÓC TÁCH GIÁ (CRITICAL):
Phải lấy đúng ĐƠN GIÁ (Unit Price) của 1 sản phẩm. KHÔNG lấy Thành tiền.
Cấu trúc hóa đơn thường hiển thị theo cặp dòng: 
- Dòng trên: [Tên Sản Phẩm]
- Dòng dưới: [Số lượng]      [Đơn giá]      [Thành tiền] Hoặc ngược lại thùy thuộc vào bill.
Đơn giá và Thành tiền có thể hiển thị dạng 109.500 hoặc 109500, HÃY TRẢ VỀ dạng số (ví dụ: 109500).
Tên sản phẩm có thể viết hoa, viết tắt, hãy giữ nguyên từng chữ cái. (VD: "UC SS T.ĂN MÈO CÁ NGỪ 1KG").
Tuyệt đối không tự bịa thêm sản phẩm không có trên bill.

ĐỊNH DẠNG ĐẦU RA:
Trả về JSON với 'raw_name' (giữ nguyên từng chữ cái trên bill), 'qty' (số lượng), 'unit_price' (đơn giá), và 'category' (ngành hàng).`;

      if (rawText) {
        promptText += `\n\nVĂN BẢN HÓA ĐƠN OCR (Dùng để tham khảo):\n"""\n${rawText}\n"""\n`;
      }

      const parts: any[] = [{ text: promptText }];
      
      if (imageBase64) {
        parts.push({
          inlineData: {
            data: imageBase64,
            mimeType: mimeType || 'image/jpeg'
          }
        });
      }

      const response = await ai.models.generateContent({
        model: activeModel,
        contents: {
          parts: parts
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
      
      try {
        const match = responseText.match(/\[[\s\S]*\]/);
        if (match) {
          responseText = match[0];
        } else {
          responseText = '[]';
        }
        const items = JSON.parse(responseText);
        return res.json({ items });
      } catch (parseError: any) {
        console.error('Lỗi parse JSON từ Gemini:', responseText);
        return res.status(500).json({ error: 'AI trả về dữ liệu không đúng định dạng JSON: ' + parseError.message });
      }

    } catch (error: any) {
      console.error('Lỗi API /api/v1/scan-bill:', error);
      const errorMsg = error.message || String(error);
      
      if (errorMsg.includes('429') || errorMsg.includes('quota')) {
        return res.status(429).json({ error: 'AI đang hết lượt xử lý (Over Quota). Vui lòng thử lại sau.' });
      }
      if (errorMsg.includes('503') || errorMsg.includes('UNAVAILABLE') || errorMsg.includes('high demand')) {
        return res.status(503).json({ error: 'Hệ thống AI đang quá tải. Vui lòng quét lại hóa đơn sau vài phút.' });
      }

      return res.status(500).json({ 
        error: 'Lỗi xử lý hóa đơn từ AI: ' + errorMsg 
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
