import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://vrrbqykaowhebmlxawhc.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZycmJxeWthb3doZWJtbHhhd2hjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzMTg5NDcsImV4cCI6MjA4OTg5NDk0N30.YbDqPA4L_KbxkDymgp064gu0FUW06Jm_7FSMjVrQhnA';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function run() {
  const { data: tiers } = await supabase.from('promotion_tiers').select('*');
  const giftIds = tiers.map(t => t.gift_product_id).filter(Boolean);
  const { data: products } = await supabase.from('products').select('product_id, product_name, product_group_id, item_type').in('product_id', giftIds);
  console.log("Gift Products:", JSON.stringify(products, null, 2));
}

run();
