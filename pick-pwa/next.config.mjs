/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    /** 在建置時寫入，供客戶端顯示「目前部署是哪一次 commit」 */
    NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA:
      process.env.VERCEL_GIT_COMMIT_SHA ?? "",
  },
};

export default nextConfig;
