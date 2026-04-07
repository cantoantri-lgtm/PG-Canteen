import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://vrrbqykaowhebmlxawhc.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZycmJxeWthb3doZWJtbHhhd2hjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzMTg5NDcsImV4cCI6MjA4OTg5NDk0N30.YbDqPA4L_KbxkDymgp064gu0FUW06Jm_7FSMjVrQhnA';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function check() {
  const { data, error } = await supabase.from('promotions').select('*').limit(1);
  console.log('Promotions columns:', Object.keys(data?.[0] || {}));
  
  const { data: tiers } = await supabase.from('promotion_tiers').select('*').limit(1);
  console.log('Tiers columns:', Object.keys(tiers?.[0] || {}));

  const { data: conditions } = await supabase.from('promotion_conditions').select('*').limit(1);
  console.log('Conditions columns:', Object.keys(conditions?.[0] || {}));
}
check();
