import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://vrrbqykaowhebmlxawhc.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZycmJxeWthb3doZWJtbHhhd2hjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzMTg5NDcsImV4cCI6MjA4OTg5NDk0N30.YbDqPA4L_KbxkDymgp064gu0FUW06Jm_7FSMjVrQhnA';

console.log('Initializing Supabase client with URL:', supabaseUrl);

const dummyLock = async (name: string, acquireTimeout: number, fn: () => Promise<any>) => {
  return await fn();
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    lock: dummyLock
  }
});