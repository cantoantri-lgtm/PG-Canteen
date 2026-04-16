-- Hàm RPC lấy chương trình khuyến mãi và tồn kho cho SUP
-- Chạy đoạn mã SQL này trong Supabase SQL Editor

CREATE OR REPLACE FUNCTION get_sup_promotions_and_inventory(p_sup_id UUID, p_shop_id UUID)
RETURNS JSON AS $$
DECLARE
  v_promotions JSON;
  v_inventory JSON;
  v_program_id UUID;
BEGIN
  -- Lấy program_id của shop hiện tại từ lịch làm việc (schedules)
  -- Giả định mỗi shop tại một thời điểm chỉ chạy 1 chương trình
  SELECT program_id INTO v_program_id
  FROM schedules
  WHERE shop_id = p_shop_id
  ORDER BY start_date DESC
  LIMIT 1;

  -- Lấy danh sách khuyến mãi kèm theo các mốc (tiers) và điều kiện (conditions)
  SELECT coalesce(json_agg(
    json_build_object(
      'promotion_id', p.promotion_id,
      'promotion_name', p.promotion_name,
      'promotion_type', p.promotion_type,
      'shop_id', p.shop_id,
      'tiers', (
        SELECT coalesce(json_agg(
          json_build_object(
            'id', t.id,
            'tier_name', t.tier_name,
            'tier_type', t.tier_type,
            'min_total_qty', t.min_total_qty,
            'gift_product_id', t.gift_product_id,
            'gift_quantity', t.gift_quantity,
            'is_ontop', t.is_ontop,
            'conditions', (
              SELECT coalesce(json_agg(
                json_build_object(
                  'condition_type', c.condition_type,
                  'target_values', c.target_values,
                  'min_target_value', c.min_target_value
                )
              ), '[]'::json)
              FROM promotion_conditions c
              WHERE c.tier_id = t.id
            )
          )
        ), '[]'::json)
        FROM promotion_tiers t
        WHERE t.promotion_id = p.promotion_id
      )
    )
  ), '[]'::json) INTO v_promotions
  FROM promotions p
  WHERE p.program_id = v_program_id
    AND (p.shop_id IS NULL OR p.shop_id = p_shop_id);

  -- Lấy tồn kho của SUP quản lý
  SELECT coalesce(json_agg(
    json_build_object(
      'product_id', i.product_id,
      'quantity', i.quantity
    )
  ), '[]'::json) INTO v_inventory
  FROM inventories i
  WHERE i.sup_id = p_sup_id;

  -- Trả về kết quả gộp
  RETURN json_build_object(
    'promotions', v_promotions,
    'inventory', v_inventory
  );
END;
$$ LANGUAGE plpgsql;
