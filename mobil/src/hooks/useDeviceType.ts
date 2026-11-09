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

/** Dar genişlik (el terminali / telefon dikey, ~360–400dp): sıkışık yerleşim dalı. Tablet ve yatay telefon (≥600dp) eski yerleşimde kalır. */
export const COMPACT_MAX_WIDTH = 600;

export function isCompactWidth(width: number): boolean {
  return width < COMPACT_MAX_WIDTH;
}

export function useIsCompact(): boolean {
  return isCompactWidth(useWindowDimensions().width);
}
