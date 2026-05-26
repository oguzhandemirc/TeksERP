import { useWindowDimensions } from 'react-native';

const TABLET_SHORTEST_SIDE = 600;

export type DeviceType = 'phone' | 'tablet';

export function useDeviceType(): DeviceType {
  const { width, height } = useWindowDimensions();
  return Math.min(width, height) >= TABLET_SHORTEST_SIDE ? 'tablet' : 'phone';
}

export function useIsPortrait(): boolean {
  const { width, height } = useWindowDimensions();
  return height >= width;
}
