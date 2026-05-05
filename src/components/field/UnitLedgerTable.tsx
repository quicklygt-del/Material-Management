export type UnitLedgerLine = {
  id: string;
  created_at: string;
  summary: string | null;
  quantity_delta: number;
  balance_after: number;
  action_type: string;
  operator_name: string | null;
};

function fmtLedgerAction(t: string): string {
  if (t === "inbound") return "移入";
  if (t === "pick") return "移出";
  if (t === "stocktake") return "盤點";
  return t;
}

function fmtShortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("zh-TW", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    return "";
  }
}

export function UnitLedgerTable({
  lines,
  linesBusy,
  maxHeightClass = "max-h-[min(42vh,16rem)]",
}: {
  lines: UnitLedgerLine[];
  linesBusy: boolean;
  maxHeightClass?: string;
}) {
  return (
    <div className={`${maxHeightClass} overflow-auto rounded-xl border border-zinc-200 bg-white`}>
      <table className="w-full text-left text-xs">
        <thead className="sticky top-0 bg-zinc-100">
          <tr>
            <th className="p-2">類別</th>
            <th className="p-2">摘要</th>
            <th className="p-2">±</th>
            <th className="p-2">結餘</th>
          </tr>
        </thead>
        <tbody>
          {linesBusy ? (
            <tr>
              <td colSpan={4} className="p-4 text-center text-zinc-500">
                讀取中…
              </td>
            </tr>
          ) : lines.length === 0 ? (
            <tr>
              <td colSpan={4} className="p-4 text-center text-zinc-400">
                尚無紀錄
              </td>
            </tr>
          ) : (
            lines.map((row) => (
              <tr key={row.id} className="border-t">
                <td className="p-2 font-bold">
                  {fmtLedgerAction(row.action_type)}
                </td>
                <td className="p-2">
                  <div className="text-[10px] text-zinc-400">
                    {fmtShortDate(row.created_at)}
                  </div>
                  <div>{row.summary ?? "—"}</div>
                </td>
                <td
                  className={`p-2 font-bold ${
                    row.quantity_delta > 0
                      ? "text-green-600"
                      : row.quantity_delta < 0
                        ? "text-red-600"
                        : "text-zinc-600"
                  }`}
                >
                  {row.quantity_delta > 0
                    ? `+${row.quantity_delta}`
                    : row.quantity_delta}
                </td>
                <td className="p-2 font-bold">{row.balance_after}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
