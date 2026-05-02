/** Barcode Detector API（QR 掃描） */

interface BarcodeDetectorOptions {
  formats?: string[];
}

declare class BarcodeDetector {
  constructor(options?: BarcodeDetectorOptions);
  detect(image: ImageBitmapSource): Promise<{ rawValue?: string }[]>;
}

interface Window {
  BarcodeDetector?: typeof BarcodeDetector;
}
