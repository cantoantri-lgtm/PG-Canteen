-- Tạo bảng product_aliases để lưu trữ các tên gọi khác nhau của sản phẩm từ hóa đơn
CREATE TABLE IF NOT EXISTS public.product_aliases (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    product_id UUID REFERENCES public.products(product_id) ON DELETE CASCADE,
    alias_name TEXT NOT NULL,
    confirmed_count INTEGER DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(product_id, alias_name)
);

-- Tạo index để tìm kiếm nhanh hơn
CREATE INDEX IF NOT EXISTS idx_product_aliases_alias_name ON public.product_aliases (alias_name);
CREATE INDEX IF NOT EXISTS idx_product_aliases_product_id ON public.product_aliases (product_id);

-- Bật RLS (Row Level Security)
ALTER TABLE public.product_aliases ENABLE ROW LEVEL SECURITY;

-- Policy cho phép đọc tất cả
CREATE POLICY "Cho phép đọc tất cả product_aliases" 
ON public.product_aliases FOR SELECT 
USING (true);

-- Policy cho phép insert/update (có thể giới hạn cho PG/Admin tùy logic)
CREATE POLICY "Cho phép insert/update product_aliases" 
ON public.product_aliases FOR ALL 
USING (true) 
WITH CHECK (true);
