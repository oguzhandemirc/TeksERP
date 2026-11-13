// ERP kipi telefon push kaydı (push köprüsü P4): izin → Expo belirteci → fabrikaya `POST /bildirim/cihaz`. Native
// modüle dokunan her şey `PushPortlari` arkasında (`erp-push-native.ts`, yalnız kapı açıkken `require`). Uygulama TEK fabrika
// bağlantısı tutar; kaydedilen belirteç adresle saklanır ve çıkışta YALNIZ o fabrikadan bırakılır (çevrimdışıysa sessiz —
// fabrika oturum iptalinde belirteci zaten bırakır). İzin yalnız kullanıcının açık eylemiyle istenir (`iste: true`).
import { Platform } from "react-native";
import type { PushCihazci } from "../api/bildirim";
import type { KeyValue } from "../state/browser-store";
import { ApiError } from "../api/client";
import { VARSAYILAN_SES, sesSecimiKaydet, sesSecimiYukle, type Ses, type SesSecimi, type SesSinifi } from "./sesler";
import { NATIVE_PUSH_ETKIN } from "./support";

export type IzinDurumu = "VERILDI" | "REDDEDILDI" | "SORULMADI" | "DESTEKLENMIYOR";

export interface PushPortlari {
  readonly platform: "android" | "ios";
  izinOku(): Promise<IzinDurumu>;
  /** Android'de kanal izinden ÖNCE kurulur (13+ istemi ancak kanal varken çıkar). */
  izinIste(): Promise<IzinDurumu>;
  /** Expo belirteci; EAS proje kimliği yoksa null (YAPILANDIRMA_EKSIK). */
  belirtecAl(): Promise<string | null>;
  /** Cihaz belirteci değişince çağrılır; dönüş aboneliği kaldırır. */
  belirtecDegisince(cb: () => void): () => void;
  cihazAdi(): string | null;
  /** S0: seçili BİLDİRİM + ALARM kanallarını kurar (Android; seçilmeyen `tekserp-*` ve eski `varsayilan` silinir). */
  kanallariKur(s: SesSecimi): Promise<void>;
  /** Sesi yerel bildirimle çalar (önizleme). */
  sesiOnizle(sinif: SesSinifi, ses: Ses): Promise<void>;
  /** Seçili kanalın telefon ayarını açar (her sistem sesi orada seçilebilir). */
  kanalAyariniAc(sinif: SesSinifi, ses: Ses): Promise<void>;
}

/** Gizli depoda: son kaydedilen belirteç + kaydedildiği fabrika adresi. */
export const ERP_PUSH_KEY = "patron.pushBelirteci";

export type ErpPushSonucu =
  | { readonly kind: "KAYITLI" }
  | { readonly kind: "KAPALI" | "IZIN_YOK" | "REDDEDILDI" | "DESTEKLENMIYOR" | "YAPILANDIRMA_EKSIK" };

export interface ErpPushBaglam {
  /** yetenek `patronPush` ∧ derleme kapısı ∧ telefon (web değil). */
  readonly acik: boolean;
  readonly adres: string;
  readonly cihazci: PushCihazci;
  readonly store: KeyValue;
  readonly portlar: () => PushPortlari;
}

/** Bu cihazda ERP telefon push'u sunulabilir mi (yetenek ∧ derleme kapısı ∧ telefon). */
export function erpPushAcik(patronPush: boolean, nativePush: boolean = NATIVE_PUSH_ETKIN, os: string = Platform.OS): boolean {
  return patronPush && nativePush && os !== "web";
}

/** Gizli depo çağrı anında alınır: ekran modülü yüklenirken yerel depo modülü istenmesin. */
const gizliDepo = (): KeyValue => (require("../state/store") as typeof import("../state/store")).secretStore;

export const yerelPortlar = (): PushPortlari =>
  (require("./erp-push-native") as typeof import("./erp-push-native")).erpPushPortlari(() => sesSecimiYukle(gizliDepo()));

const ret = (d: IzinDurumu): ErpPushSonucu => ({ kind: d === "DESTEKLENMIYOR" ? "DESTEKLENMIYOR" : d === "REDDEDILDI" ? "REDDEDILDI" : "IZIN_YOK" });

/**
 * Kayıt: izin verilmişse belirteci fabrikaya yazar (idempotent; aynı belirteç aynı satır). `iste` yanlışsa izin
 * İSTENMEZ (açılışta sessiz tazeleme). Ağ/sunucu hatası yükselir; sessiz çağıran yutar.
 */
export async function erpPushEtkinlestir(b: ErpPushBaglam, o: { iste: boolean }): Promise<ErpPushSonucu> {
  if (!b.acik) return { kind: "KAPALI" };
  const p = b.portlar();
  let izin = await p.izinOku();
  if (izin === "DESTEKLENMIYOR") return ret(izin);
  if (izin !== "VERILDI") {
    if (!o.iste) return ret(izin);
    izin = await p.izinIste();
    if (izin !== "VERILDI") return ret(izin);
  }
  const belirtec = await p.belirtecAl();
  if (!belirtec) return { kind: "YAPILANDIRMA_EKSIK" };
  const ad = p.cihazAdi()?.trim().slice(0, 80);
  // Ses seçimi cihaz kaydıyla gider: fabrika buluta iletir, bulut Expo iletisinde kanal + sesi bundan kurar.
  // Eski fabrika (alanı bilmeyen katı şema) için: varsayılan seçimde alan HİÇ gitmez; sapan seçim 400 PATRON_PUSH_GOVDE
  // alırsa sessiz yeniden deneme alansız (bildirim gelir, ses fabrika güncellenince seçilene döner).
  const ses = await sesSecimiYukle(b.store);
  const temel = { belirtec, platform: p.platform, ...(ad ? { cihazAdi: ad } : {}) };
  if (ses.bildirim === VARSAYILAN_SES.bildirim && ses.alarm === VARSAYILAN_SES.alarm) await b.cihazci.kaydet(temel);
  else {
    try {
      await b.cihazci.kaydet({ ...temel, sesBildirim: ses.bildirim, sesAlarm: ses.alarm });
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 400 && err.code === "PATRON_PUSH_GOVDE")) throw err;
      await b.cihazci.kaydet(temel);
    }
  }
  await b.store.set(ERP_PUSH_KEY, JSON.stringify({ adres: b.adres, belirtec }));
  return { kind: "KAYITLI" };
}

/**
 * Ses değişimi: seçim cihaza yazılır → kanallar kurulur → izin verilmişse kayıt yenilenir (fabrika buluta iletir).
 * İzin yoksa yalnız yerelde kalır; "Telefon bildirimlerini aç" kaydı seçimi zaten taşır.
 */
export async function erpPushSesDegistir(b: ErpPushBaglam, secim: SesSecimi): Promise<ErpPushSonucu> {
  await sesSecimiKaydet(b.store, secim);
  if (!b.acik) return { kind: "KAPALI" };
  await b.portlar().kanallariKur(secim);
  return erpPushEtkinlestir(b, { iste: false });
}

function sakliOku(raw: string | null): { adres: string; belirtec: string } | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { adres?: unknown; belirtec?: unknown };
    return typeof v.adres === "string" && typeof v.belirtec === "string" ? { adres: v.adres, belirtec: v.belirtec } : null;
  } catch {
    return null;
  }
}

/** Çıkış: saklı belirteç BU fabrikanınsa `DELETE` (hata sessiz); kayıt her durumda silinir. Kapıdan bağımsızdır. */
export async function erpPushBirak(b: { adres: string; cihazci: PushCihazci; store: KeyValue }): Promise<void> {
  const s = sakliOku(await b.store.get(ERP_PUSH_KEY).catch(() => null));
  if (s && s.adres === b.adres) await b.cihazci.birak(s.belirtec).catch(() => undefined);
  await b.store.remove(ERP_PUSH_KEY).catch(() => undefined);
}
