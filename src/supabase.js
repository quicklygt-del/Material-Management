import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';

// 您的 Supabase 配置（已填入）
const SUPABASE_URL = 'https://krudgjrzgxodrozfdlgs.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtydWRnanJ6Z3hvZHJvemZkbGdzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwNzA4MjAsImV4cCI6MjA5MjY0NjgyMH0.WjiqQEuyBoryjV7AqnDT-kWbFJCxmcTgHL-to8C5HJ4';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);