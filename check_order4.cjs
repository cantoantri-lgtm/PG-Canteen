const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  'https://vrrbqykaowhebmlxawhc.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZycmJxeWthb3doZWJtbHhhd2hjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzMTg5NDcsImV4cCI6MjA4OTg5NDk0N30.YbDqPA4L_KbxkDymgp064gu0FUW06Jm_7FSMjVrQhnA'
);
async function main() {
  const { data, error } = await supabase.from('orders').select('cart_id').eq('cart_id', 'CART-260503-29CD');
  console.log(data);
}
main();
