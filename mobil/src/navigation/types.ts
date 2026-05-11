import type { MobileScreenKey } from '../types/permissions';

export type RootStackParamList = {
  Login: undefined;
  Main: undefined;
  NoAccess: undefined;
};

export type MainStackParamList = {
  ModuleSelect: undefined;
} & Record<MobileScreenKey, undefined>;
