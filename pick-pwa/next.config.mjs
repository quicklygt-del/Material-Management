/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // 佈署時忽略 ESLint 錯誤[cite: 2]
    ignoreDuringBuilds: true,
  },
  typescript: {
    // 已通過 `npx tsc --noEmit`；佈署時一併做型別檢查
    ignoreBuildErrors: false,
  },
};

// 修正點：在 .mjs 檔案中使用 ESM 的匯出語法
export default nextConfig;