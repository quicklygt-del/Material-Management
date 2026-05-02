/**
 * Web Bluetooth：依常見 BLE UART（Nordic UART Service）寫入列印資料。
 * 實際 ESC/POS／指令需依標籤機型調整；此處送出 UTF-8 文字列供驗證連線。
 */

const NUS_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const NUS_TX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";

export function isWebBluetoothAvailable(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "bluetooth" in navigator &&
    typeof navigator.bluetooth?.requestDevice === "function"
  );
}

function encodeUtf8Lines(lines: string[]): Uint8Array {
  const text = lines.join("\n") + "\n\n";
  return new TextEncoder().encode(text);
}

/**
 * 連線並寫入一段文字（含換行）。若裝置不支援 NUS，嘗試提示使用者。
 */
export async function bluetoothSendText(lines: string[]): Promise<void> {
  if (!isWebBluetoothAvailable()) {
    throw new Error(
      "此瀏覽器或環境不支援 Web Bluetooth（請使用 Chrome／Edge 並開啟 HTTPS）",
    );
  }

  const bluetooth = navigator.bluetooth;
  if (!bluetooth) {
    throw new Error(
      "此瀏覽器或環境不支援 Web Bluetooth（請使用 Chrome／Edge 並開啟 HTTPS）",
    );
  }

  const device = await bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: [NUS_SERVICE],
  });

  const server = await device.gatt?.connect();
  if (!server) throw new Error("無法連線 GATT");

  let service;
  try {
    service = await server.getPrimaryService(NUS_SERVICE);
  } catch {
    await server.disconnect();
    throw new Error(
      "找不到 Nordic UART 服務；請確認標籤機為 BLE UART 模組，或改用廠商指定 App。",
    );
  }

  const tx = await service.getCharacteristic(NUS_TX);
  const payload = encodeUtf8Lines(lines);
  const chunk = 160;
  for (let i = 0; i < payload.length; i += chunk) {
    const slice = payload.subarray(i, i + chunk);
    await tx.writeValue(slice);
  }

  await server.disconnect();
}

/** 將標籤可讀內容組成送印文字（可依機台改為 ESC/POS byte array） */
export function formatLabelPrintLines(params: {
  qrPayload: string;
  itemLine: string;
  footerLine: string;
  title?: string;
  /** 操作單位（紀錄追蹤用） */
  operationUnit?: string;
}): string[] {
  const lines = [
    params.title ?? "標籤列印",
    "",
    params.itemLine,
    "",
    `QR：${params.qrPayload}`,
    ...(params.operationUnit ? [`操作單位：${params.operationUnit}`] : []),
    params.footerLine,
  ];
  return lines;
}
