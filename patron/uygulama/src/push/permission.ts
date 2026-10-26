// Bu cihazın bildirim İZNİ durumu (UX-4): Bildirim Ayarları ekranının en üstünde okunur ki izin akışı bulunabilsin.
// Okuma izin İSTEMEZ (istek yalnız "Bu cihazda bildirimleri aç" düğmesinde); native modüle yalnız etkin kapıyla dokunulur.
import type { StatusKind } from "../ui/tokens";
import { NATIVE_PUSH_ETKIN } from "./support";

export type PermissionState = "VERILDI" | "REDDEDILDI" | "SORULMADI" | "DESTEKLENMIYOR";

export function webPermission(): PermissionState {
  const n = (globalThis as { Notification?: { permission?: string } }).Notification;
  if (!n || !("PushManager" in globalThis)) return "DESTEKLENMIYOR";
  return n.permission === "granted" ? "VERILDI" : n.permission === "denied" ? "REDDEDILDI" : "SORULMADI";
}

export async function readPermission(os: string, nativePush: boolean = NATIVE_PUSH_ETKIN): Promise<PermissionState> {
  if (os === "web") return webPermission();
  if (!nativePush) return "DESTEKLENMIYOR";
  return (require("./register-native") as typeof import("./register-native")).nativePermission();
}

export interface PermissionView {
  readonly kind: StatusKind;
  readonly label: string;
  readonly hint: string;
  /** "ayarlar": izin reddedilmiş, yalnız sistem ayarından açılır (telefonda düğme; web'de yalnız yönerge). */
  readonly action: "iste" | "ayarlar" | null;
}

export function permissionView(state: PermissionState, os: string): PermissionView {
  switch (state) {
    case "VERILDI":
      return { kind: "iyi", label: "İzin verildi", hint: "Bildirimler bu cihaza gelebilir; kayıtlı değilse aşağıdan açın", action: null };
    case "SORULMADI":
      return { kind: "bilgi", label: "İzin sorulmadı", hint: "Aşağıdaki düğmeye dokununca izin istenir", action: "iste" };
    case "REDDEDILDI":
      return os === "web"
        ? { kind: "kritik", label: "İzin reddedildi", hint: "Tarayıcının site ayarlarından bildirim iznini açın, sonra bu ekranı yenileyin", action: "ayarlar" }
        : { kind: "kritik", label: "İzin reddedildi", hint: "Telefon ayarlarından bu uygulamanın bildirim iznini açın", action: "ayarlar" };
    case "DESTEKLENMIYOR":
      return { kind: "uyari", label: "Desteklenmiyor", hint: "Bu tarayıcı bildirim desteklemiyor (iPhone'da 16.4+ ve ana ekrana eklenmiş olmalı)", action: null };
  }
}
