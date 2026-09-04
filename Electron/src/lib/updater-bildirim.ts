import { toast } from "sonner";
import type { UpdateStatus } from "@shared/ipc-contract";
import { UPDATE_CHECK_INTERVAL_LABEL } from "@shared/update-schedule";

/**
 * ELLE DENETLEMENİN SONUÇ BİLDİRİMİ — TEK KAYNAK (2026-09-04 kullanıcı isteği).
 *
 * ⚠️ **YALNIZ ELLE BASIŞTA.** Bu dosyayı çağıran TEK yer topbar düğmesinin tık
 * işleyicisidir; `{UPDATE_CHECK_INTERVAL_LABEL}` koşan otomatik kontrol ve
 * giriş anındaki kontrol buradan HİÇ geçmez. Ayrımın "kim tetikledi" bayrağıyla
 * değil ÇAĞRI YERİYLE kurulması bilinçlidir: paylaşılan bir `useRef` bayrağı,
 * otomatik kontrol elle basışın hemen ardına denk geldiğinde yanlış baloncuk
 * bastırırdı (iki yazar, tek bayrak). Burada yazar tektir — kullanıcının kendi
 * tıkı — ve gösterilen değer o tıkın `check()` çağrısının DÖNDÜĞÜ durumdur,
 * yayınlanan ortak durum değil.
 *
 * ⚠️ **HATA KIRMIZI BASMAZ** (`updater-durum.ts` ile aynı kural). Başarısız
 * denetleme "nötr" tonda ve suçlamadan yazılır; internete çıkamayan makinede
 * her denemede kırmızı yanan bir bildirim, gerçek güncelleme geldiğinde de
 * görmezden gelinir. Hata METNİ Sistem → Güncelleme ekranındadır.
 */
export type GuncellemeBildirimTuru = "basari" | "bilgi" | "notr";

export interface GuncellemeBildirimi {
  tur: GuncellemeBildirimTuru;
  baslik: string;
  aciklama?: string;
}

/**
 * Elle denetlemenin SONUCUNU baloncuk metnine çevirir (saf fonksiyon).
 *
 * `null`/`undefined` girdi = sonuç okunamadı (IPC düştü) → "denetlenemedi";
 * sessiz kalmak, düğmeye basıp hiçbir şey görmemek demek olurdu ve kullanıcı
 * basışın işlenip işlenmediğini bilemezdi.
 *
 * Güncelleyici kapalıyken (`enabled:false`, geliştirme modu) `null` döner —
 * düğme zaten kilitlidir, oraya bir cümle yazmak yalan olurdu.
 */
export function elleDenetimBildirimi(
  sonuc: UpdateStatus | null | undefined,
): GuncellemeBildirimi | null {
  if (sonuc && !sonuc.enabled) return null;

  switch (sonuc?.state) {
    case "up-to-date":
      return {
        tur: "basari",
        baslik: "Uygulama güncel",
        aciklama: `Sürüm ${sonuc.currentVersion} — yeni bir sürüm yok.`,
      };
    case "available":
    case "downloading":
      return {
        tur: "bilgi",
        baslik: sonuc.newVersion ? `Yeni sürüm indiriliyor (${sonuc.newVersion})` : "Yeni sürüm indiriliyor",
        aciklama: "İnme bitince üstte “Yeniden Başlat” şeridi çıkacak.",
      };
    case "ready":
      return {
        tur: "bilgi",
        baslik: "Güncelleme kurulmaya hazır",
        aciklama: "Üstteki şeritten yeniden başlatınca kurulur.",
      };
    // error · checking · idle · sonuç okunamadı → hepsi aynı nötr cümle.
    default:
      return {
        tur: "notr",
        baslik: "Şu an denetlenemedi",
        aciklama: `Güncelleme sunucusuna ulaşılamadı; ${UPDATE_CHECK_INTERVAL_LABEL} kendiliğinden yeniden denenir.`,
      };
  }
}

/** Baloncuğu gösterir. Gösterilecek bir şey yoksa sessiz kalır. */
export function gosterElleDenetimBildirimi(sonuc: UpdateStatus | null | undefined): void {
  const bildirim = elleDenetimBildirimi(sonuc);
  if (!bildirim) return;
  const secenek = { description: bildirim.aciklama, duration: 4500 };
  // ⚠️ `toast.error` YOK — bkz. dosya başlığı (kırmızı körleştirir).
  if (bildirim.tur === "basari") toast.success(bildirim.baslik, secenek);
  else if (bildirim.tur === "bilgi") toast.info(bildirim.baslik, secenek);
  else toast(bildirim.baslik, secenek);
}
