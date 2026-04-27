-- Xóa hàm cũ nếu tồn tại (để tránh lỗi PGRST203: function overloading)
DROP FUNCTION IF EXISTS create_order_transaction(json, json);
DROP FUNCTION IF EXISTS create_order_transaction(jsonb, jsonb[]);
DROP FUNCTION IF EXISTS create_order_transaction(jsonb, jsonb);

-- Khởi tạo hàm mới với Exception control được tối ưu
CREATE OR REPLACE FUNCTION create_order_transaction(p_header jsonb, p_details jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER -- Cho phép function bypass RLS thao tác Insert, bạn có thể xóa nếu muốn RLS kiểm tra gắt gao.
AS $$
DECLARE
  v_order_id UUID;
  v_detail jsonb;
  v_result jsonb;
BEGIN
  -- Validate inputs
  IF p_header IS NULL THEN
    RAISE EXCEPTION 'p_header cannot be null';
  END IF;

  IF p_details IS NULL OR jsonb_array_length(p_details) = 0 THEN
    RAISE EXCEPTION 'p_details cannot be null or empty';
  END IF;

  -- 1. INSERT INTO orders (header)
  BEGIN
    INSERT INTO orders (
      cart_id,
      created_at,
      pg_id,
      program_id,
      shop_id,
      bill_image_url,
      latitude,
      longitude,
      distance_from_shop,
      customer_name,
      customer_phone
    ) VALUES (
      p_header->>'cart_id',
      COALESCE(CAST(NULLIF(p_header->>'created_at', 'null') AS TIMESTAMPTZ), now()),
      CAST(NULLIF(p_header->>'pg_id', 'null') AS UUID),
      CAST(NULLIF(p_header->>'program_id', 'null') AS UUID),
      CAST(NULLIF(p_header->>'shop_id', 'null') AS UUID),
      NULLIF(p_header->>'bill_image_url', 'null'),
      CAST(NULLIF(p_header->>'latitude', 'null') AS NUMERIC),
      CAST(NULLIF(p_header->>'longitude', 'null') AS NUMERIC),
      CAST(NULLIF(p_header->>'distance_from_shop', 'null') AS DOUBLE PRECISION),
      NULLIF(p_header->>'customer_name', 'null'),
      NULLIF(p_header->>'customer_phone', 'null')
    ) RETURNING id INTO v_order_id;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Error inserting into orders: % (SQLSTATE: %)', SQLERRM, SQLSTATE;
  END;

  -- 2. INSERT INTO order_details
  FOR v_detail IN SELECT * FROM jsonb_array_elements(p_details)
  LOOP
    BEGIN
      INSERT INTO order_details (
        order_id,
        product_id,
        qty,
        net_value,
        promotion_id,
        is_gift,
        switched_from_brand
      ) VALUES (
        v_order_id,
        CAST(NULLIF(v_detail->>'product_id', 'null') AS UUID),
        CAST(NULLIF(v_detail->>'qty', 'null') AS INT),
        CAST(NULLIF(v_detail->>'net_value', 'null') AS NUMERIC),
        CAST(NULLIF(v_detail->>'promotion_id', 'null') AS UUID),
        COALESCE(CAST(NULLIF(v_detail->>'is_gift', 'null') AS BOOLEAN), false),
        NULLIF(v_detail->>'switched_from_brand', 'null')
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Error inserting into order_details for product_id %: % (SQLSTATE: %)', v_detail->>'product_id', SQLERRM, SQLSTATE;
    END;
  END LOOP;

  -- Return success response
  v_result := jsonb_build_object(
    'status', 'success',
    'order_id', v_order_id,
    'message', 'Order created successfully'
  );

  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  -- Catch any remaining exception, rollback happens automatically in PL/pgSQL
  RAISE EXCEPTION 'Transaction failed: %', SQLERRM;
END;
$$;
