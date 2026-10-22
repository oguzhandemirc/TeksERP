// Hafif dokunsal geri bildirim. Android'de YALNIZ `performAndroidHapticsAsync`: VIBRATE izni `app.json`
// `blockedPermissions`ta engelli kalır (izin kümesi yalnız INTERNET); web'de no-op. Hata hiçbir zaman yükselmez.
import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

export type HapticKind = "selection" | "light" | "success" | "warning" | "error";

const ANDROID: Record<HapticKind, Haptics.AndroidHaptics> = {
  selection: Haptics.AndroidHaptics.Segment_Tick,
  light: Haptics.AndroidHaptics.Context_Click,
  success: Haptics.AndroidHaptics.Confirm,
  warning: Haptics.AndroidHaptics.Reject,
  error: Haptics.AndroidHaptics.Reject,
};

function ios(kind: HapticKind): Promise<void> {
  switch (kind) {
    case "selection":
      return Haptics.selectionAsync();
    case "light":
      return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    case "success":
      return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    case "warning":
      return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    case "error":
      return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  }
}

export function haptic(kind: HapticKind): void {
  if (Platform.OS === "web") return;
  try {
    const p = Platform.OS === "android" ? Haptics.performAndroidHapticsAsync(ANDROID[kind]) : ios(kind);
    void Promise.resolve(p).catch(() => undefined);
  } catch {
    // titreşim yoksa sessiz geç
  }
}
