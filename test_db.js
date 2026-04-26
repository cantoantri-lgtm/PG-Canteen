import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://vrrbqykaowhebmlxawhc.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZycmJxeWthb3doZWJtbHhhd2hjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzMTg5NDcsImV4cCI6MjA4OTg5NDk0N30.YbDqPA4L_KbxkDymgp064gu0FUW06Jm_7FSMjVrQhnA';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function check() {
  const { data, error } = await supabase.from('orders').select('cart_id, created_at').order('created_at', { ascending: false }).limit(5);
  console.log(JSON.stringify(data, null, 2));
}
check();
