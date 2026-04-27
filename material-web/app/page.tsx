'use client';

import { useSession, useSupabaseClient } from '@supabase/auth-helpers-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function Home() {
  const session = useSession();
  const supabase = useSupabaseClient();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);

  useEffect(() => {
    if (session) router.push('/dashboard');
  }, [session, router]);

  const handleAuth = async () => {
    setLoading(true);
    let error;
    if (isSignUp) {
      const { error: signUpError } = await supabase.auth.signUp({ email, password });
      error = signUpError;
    } else {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      error = signInError;
    }
    if (error) alert(error.message);
    else if (!isSignUp) router.push('/dashboard');
    setLoading(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-md">
        <h1 className="mb-6 text-2xl font-bold">物料管理系統</h1>
        <input
          type="email"
          placeholder="電子郵件"
          className="mb-3 w-full rounded border p-2"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          type="password"
          placeholder="密碼"
          className="mb-4 w-full rounded border p-2"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button
          onClick={handleAuth}
          disabled={loading}
          className="w-full rounded bg-blue-600 py-2 text-white hover:bg-blue-700"
        >
          {loading ? '處理中…' : isSignUp ? '註冊' : '登入'}
        </button>
        <p className="mt-4 text-center text-sm">
          {isSignUp ? '已有帳號？' : '沒有帳號？'}
          <button onClick={() => setIsSignUp(!isSignUp)} className="ml-1 text-blue-600">
            {isSignUp ? '登入' : '註冊'}
          </button>
        </p>
      </div>
    </div>
  );
}
