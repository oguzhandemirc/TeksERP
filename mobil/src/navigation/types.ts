import type { MobileScreenKey } from '../types/permissions';

export type RootStackParamList = {
  Pairing: undefined;
  Login: undefined;
  Main: undefined;
  NoAccess: undefined;
  Settings: undefined;
  DevicePairing: undefined;
};

export type MainStackParamList = {
  ModuleSelect: undefined;
} & Record<MobileScreenKey, undefined>;
