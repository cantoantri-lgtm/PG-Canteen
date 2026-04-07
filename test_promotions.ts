import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://vrrbqykaowhebmlxawhc.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZycmJxeWthb3doZWJtbHhhd2hjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzMTg5NDcsImV4cCI6MjA4OTg5NDk0N30.YbDqPA4L_KbxkDymgp064gu0FUW06Jm_7FSMjVrQhnA';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function test() {
  const { data: program, error: pError } = await supabase.from('programs').insert([{
    program_name: 'Test Program',
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    status: 'active'
  }]).select();
  
  if (pError) { console.error('Program error:', pError); return; }
  const programId = program[0].program_id;

  const { data: promotion, error: promError } = await supabase.from('promotions').insert([{
    program_id: programId,
    promotion_name: 'Test Promotion',
    promotion_type: 'Discount',
    mechanic_rules: { start_date: '2026-01-01', end_date: '2026-12-31' }
  }]).select();

  if (promError) { console.error('Promotion error:', promError); return; }
  const promotionId = promotion[0].promotion_id;

  const { data: tier, error: tError } = await supabase.from('promotion_tiers').insert([{
    promotion_id: promotionId,
    tier_name: 'Tier 1',
    tier_type: 'Chiết khấu số lượng',
    support_amount: 1000,
    min_total_qty: 10
  }]).select();

  if (tError) { console.error('Tier error:', tError); return; }
  const tierId = tier[0].id;

  const { data: condition, error: cError } = await supabase.from('promotion_conditions').insert([{
    tier_id: tierId,
    condition_type: 'Dòng sản phẩm',
    target_values: 'FTKZ, FTKM',
    min_target_value: 1
  }]).select();

  if (cError) { console.error('Condition error:', cError); return; }

  console.log('Promotion created:', promotionId);
  console.log('Tier created:', tierId);
  console.log('Condition created:', condition?.[0]?.id);
  
  // Cleanup
  await supabase.from('promotion_conditions').delete().eq('tier_id', tierId);
  await supabase.from('promotion_tiers').delete().eq('promotion_id', promotionId);
  await supabase.from('promotions').delete().eq('promotion_id', promotionId);
  await supabase.from('programs').delete().eq('program_id', programId);
}
test();
