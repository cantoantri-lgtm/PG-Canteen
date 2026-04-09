import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://vrrbqykaowhebmlxawhc.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZycmJxeWthb3doZWJtbHhhd2hjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzMTg5NDcsImV4cCI6MjA4OTg5NDk0N30.YbDqPA4L_KbxkDymgp064gu0FUW06Jm_7FSMjVrQhnA';
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkColumns() {
  const { data } = await supabase.from('products').select('item_type');
  const types = new Set(data?.map(d => d.item_type));
  console.log('item_types:', Array.from(types));
}
checkColumns();
