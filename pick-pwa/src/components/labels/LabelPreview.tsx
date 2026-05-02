"use client";

import { QRCodeSVG } from "qrcode.react";

export type LabelSizePreset = "50x30" | "40x20" | "30x30" | "20x20";

/** 視覺範本：自定義黑頭／不良雙側粗框+「不」字 */
export type LabelVisualTemplate = "default" | "rnd_header" | "defect_stamp";

const SIZE_CLASS: Record<LabelSizePreset, string> = {
  "50x30": "w-[50mm] min-h-[30mm]",
  "40x20": "w-[40mm] min-h-[20mm]",
  "30x30": "h-[30mm] w-[30mm]",
  "20x20": "h-[20mm] w-[20mm]",
};

const QR_SIZE: Record<LabelSizePreset, number> = {
  "50x30": 112,
  "40x20": 88,
  "30x30": 96,
  "20x20": 72,
};

type Props = {
  qrValue: string;
  headline: string;
  footer: string;
  size: LabelSizePreset;
  /** @deprecated 請改用 template */
  variant?: "default" | "danger";
  template?: LabelVisualTemplate;
};

export function LabelPreview({
  qrValue,
  headline,
  footer,
  size,
  variant = "default",
  template = "default",
}: Props) {
  const resolvedTemplate: LabelVisualTemplate =
    template !== "default"
      ? template
      : variant === "danger"
        ? "defect_stamp"
        : "default";

  const headlineClass =
    resolvedTemplate === "defect_stamp"
      ? "text-sm font-black leading-tight text-red-950 sm:text-lg md:text-xl"
      : size === "20x20"
        ? "text-[11px] font-black text-slate-950 sm:text-sm md:text-base"
        : "text-sm font-black text-slate-950 sm:text-lg md:text-2xl";

  const inner = (
    <>
      {resolvedTemplate === "rnd_header" && (
        <div className="-mx-2 -mt-2 mb-1 bg-black py-1.5 text-center text-[10px] font-black tracking-wide text-white sm:text-xs">
          自定義
        </div>
      )}
      <div className={`whitespace-pre-line text-center ${headlineClass}`}>
        {headline}
      </div>
      <div className="relative flex flex-1 items-center justify-center py-1">
        {resolvedTemplate === "defect_stamp" && (
          <span
            className="pointer-events-none absolute inset-0 flex items-center justify-center text-5xl font-black leading-none text-black/[0.12] sm:text-6xl md:text-7xl"
            aria-hidden
          >
            不
          </span>
        )}
        <QRCodeSVG
          value={qrValue}
          size={QR_SIZE[size]}
          level="H"
          includeMargin={false}
          className="relative z-10"
        />
      </div>
      <div className="text-center text-[7px] font-bold leading-tight text-slate-600 sm:text-[8px]">
        {footer}
      </div>
    </>
  );

  if (resolvedTemplate === "defect_stamp") {
    return (
      <div
        className={`mx-auto flex overflow-hidden rounded-lg bg-red-50 shadow-inner print:shadow-none ${SIZE_CLASS[size]}`}
      >
        <div className="w-2 shrink-0 bg-black sm:w-3" aria-hidden />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col border-y-4 border-red-600 bg-red-50 p-2 text-red-950">
          {inner}
        </div>
        <div className="w-2 shrink-0 bg-black sm:w-3" aria-hidden />
      </div>
    );
  }

  const frame =
    resolvedTemplate === "rnd_header"
      ? "border-slate-900 bg-white text-slate-900"
      : "border-slate-800 bg-white text-slate-900";

  return (
    <div
      className={`mx-auto flex flex-col items-stretch overflow-hidden rounded-lg border-4 ${frame} ${SIZE_CLASS[size]} p-2 shadow-inner print:shadow-none`}
    >
      {inner}
    </div>
  );
}
