import { BleManager, Device } from 'react-native-ble-plx';

// Geliştirme modunda mock; production'da gerçek BLE kullanılır
const IS_MOCK = __DEV__;

const manager = IS_MOCK ? null : new BleManager();

export const bluetoothService = {
  scanDevices: async (onDevice: (device: Device) => void) => {
    if (IS_MOCK) {
      setTimeout(() => onDevice({ id: 'mock-001', name: 'Mock Scanner' } as Device), 500);
      return () => {};
    }
    manager!.startDeviceScan(null, null, (error, device) => {
      if (device) onDevice(device);
    });
    return () => manager!.stopDeviceScan();
  },

  stopScan: () => {
    if (!IS_MOCK) manager!.stopDeviceScan();
  },

  destroy: () => {
    if (!IS_MOCK) manager!.destroy();
  },
};
