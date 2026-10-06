// =============================================================================
// SUNUCU SİMGESİ DURUMU — `GET /health/tepsi` (yalnız döngü adresi; docs/design/GUNCELLEYICI.md §14)
// =============================================================================
// Kullanıcı oturumundaki bildirim alanı simgesi (deploy/kurulum/tepsi.ps1) yönetici yetkisiz çalışır ve
// güncelleyicinin korumalı durum dizinini okuyamaz; durumu backend'in zaten okuduğu `durum.json`dan, SIR
// TAŞIMAYAN sabit bir görünümle alır. Renk kararı BURADADIR (simge yalnız gösterir, karar vermez).
// =============================================================================
import type { UpdaterRead } from "./license/updater-ipc";
import { pendingUpdate, updaterLiveness } from "../services/update-status.service";

export type TepsiRenk = "YESIL" | "SARI" | "KIRMIZI";

export interface TrayStatus {
  readonly v: 1;
  readonly renk: TepsiRenk;
  readonly baslik: string;
  /** Renk YEŞİL değilse nedenler (kısa, sabit Türkçe cümleler; güncelleyici iletisi/yol/sır YOK). */
  readonly nedenler: readonly string[];
  readonly surum: string;
  readonly veritabani: "UP" | "DOWN";
  readonly lisansKipi: string | null;
  /** Güncelleme sürüyorsa (indirme ya da uygulama): simge balon + ilerleme penceresi açar. */
  readonly guncelleme: {
    readonly surucu: boolean;
    readonly adim: string | null;
    readonly hedefSurum: string | null;
    readonly ilerleme: { readonly indirilen: number; readonly toplam: number } | null;
  };
  readonly zaman: string;
}

const KIRMIZI_KIPLER = new Set(["KISITLI", "DURDURULMUS"]);
const SARI_KIPLER = new Set(["UYARI", "EK_SURE"]);
const BEKLEYEN_KARARLAR = new Set(["ONAY_BEKLIYOR", "PENCERE_BEKLIYOR", "KUR"]);

export function trayStatus(g: {
  readonly db: "UP" | "DOWN";
  readonly surum: string;
  readonly lisansKipi: string | null;
  readonly read: UpdaterRead;
  readonly nowMs: number;
}): TrayStatus {
  const kirmizi: string[] = [];
  const sari: string[] = [];
  if (g.db === "DOWN") kirmizi.push("Veritabanına ulaşılamıyor.");
  if (g.lisansKipi && KIRMIZI_KIPLER.has(g.lisansKipi)) kirmizi.push("Lisans kısıtlı kipte.");
  else if (g.lisansKipi && SARI_KIPLER.has(g.lisansKipi)) sari.push("Lisans için uyarı var.");

  const d = g.read.status.kind === "ok" ? g.read.status.doc : null;
  let surucu = false;
  let adim: string | null = null;
  let target: string | null = null;
  let ilerleme: { indirilen: number; toplam: number } | null = null;
  if (g.read.status.kind === "invalid") sari.push("Güncelleyici durumu okunamıyor.");
  else if (!d) sari.push("Güncelleyici henüz durum yazmadı.");
  else {
    if (d.durum === "HATA") kirmizi.push("Güncelleyici bir hata nedeniyle durdu.");
    else if (updaterLiveness(d, g.nowMs).yanitVermiyor) sari.push("Güncelleyici yanıt vermiyor.");
    if (d.durum === "INDIRILIYOR" || d.durum === "UYGULANIYOR") {
      surucu = true;
      sari.push(d.durum === "INDIRILIYOR" ? "Güncelleme indiriliyor." : "Güncelleme uygulanıyor.");
      adim = d.adim && /^[A-Z0-9_:]{1,60}$/.test(d.adim) ? d.adim : null;
      target = d.surum && /^[0-9A-Za-z.+-]{1,40}$/.test(d.surum) ? d.surum : null;
      ilerleme = d.ilerleme ?? null;
    }
    const b = pendingUpdate(d);
    if (b && BEKLEYEN_KARARLAR.has(b.karar)) sari.push(`Yeni sürüm hazır (${b.surum}); ${b.karar === "ONAY_BEKLIYOR" ? "onay bekliyor." : "uygun zaman bekliyor."}`);
  }

  const renk: TepsiRenk = kirmizi.length ? "KIRMIZI" : sari.length ? "SARI" : "YESIL";
  return {
    v: 1,
    renk,
    baslik: renk === "YESIL" ? "TeksERP Sunucu: çalışıyor" : renk === "SARI" ? "TeksERP Sunucu: dikkat" : "TeksERP Sunucu: sorun var",
    nedenler: [...kirmizi, ...sari],
    surum: g.surum,
    veritabani: g.db,
    lisansKipi: g.lisansKipi,
    guncelleme: { surucu, adim, hedefSurum: target, ilerleme },
    zaman: new Date(g.nowMs).toISOString(),
  };
}
