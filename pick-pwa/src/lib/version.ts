/** 顯示於首頁、後台等（作業頁不顯示版號）。Vercel 建置時可帶入 commit 短碼。 */

const LABEL = "v0.22.2";

function shortSha(): string | undefined {
  const raw = (
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || ""
  ).trim();
  if (raw.length >= 7) return raw.slice(0, 7);
  if (raw.length > 0) return raw;
  return undefined;
}

const sha = shortSha();

export const APP_VERSION = sha ? `${LABEL} (${sha})` : `${LABEL} · local`;
