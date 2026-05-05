/** 最低限度 Web Bluetooth 型別（Chrome／Edge） */

interface BluetoothDevice extends EventTarget {
  readonly gatt?: BluetoothRemoteGATTServer;
}

interface BluetoothRemoteGATTServer {
  connected: boolean;
  connect(): Promise<BluetoothRemoteGATTServer>;
  disconnect(): void;
  getPrimaryService(service: string): Promise<BluetoothRemoteGATTService>;
}

interface BluetoothRemoteGATTService {
  getCharacteristic(name: string): Promise<BluetoothRemoteGATTCharacteristic>;
}

interface BluetoothRemoteGATTCharacteristic {
  writeValue(value: ArrayBuffer | ArrayBufferView): Promise<void>;
}

interface Bluetooth extends EventTarget {
  requestDevice(options: {
    acceptAllDevices?: boolean;
    optionalServices?: string[];
    filters?: unknown[];
  }): Promise<BluetoothDevice>;
}

interface Navigator {
  bluetooth?: Bluetooth;
}
