// =============================================================================
// TeksERP - Mobil güncelleme deposu (yol çözümü)
// =============================================================================
// Tabletler güncellemeyi İNTERNETTEN (VPS) alır — bkz.
// `docs/ops/MOBIL-UZAKTAN-GUNCELLEME.md`. Buradaki uçlar o kanalın
// **internetsiz kurulum için LAN ikizidir**: aynı paketleri, VPS'teki nginx ile
// BİREBİR AYNI yol düzeniyle servis eder.
//
//   <kök>/ota/<runtimeVersion>/manifest            → donmuş + imzalı manifest
//   <kök>/ota/<runtimeVersion>/manifest-<damga>    → geri alma kopyaları
//   <kök>/ota/<runtimeVersion>/<damga>/…           → paket dosyaları
//   <kök>/apk/surum.json + *.apk                   → kurulum dosyası
//
// ⚠️ SUNUCU MANİFEST ÜRETMEZ, yalnız bayt servis eder. Sebep kod imzalama:
// imza gövdenin HAM baytları üzerinden doğrulanır, dolayısıyla manifest yayın
// anında dondurulur (`mobil/scripts/lib/manifest.mjs` — TEK üretici). Sunucu
// onu yeniden üretseydi baytlar değişir ve tablet paketi REDDEDERDİ.
//
// ⚠️ NEDEN `app\` KLASÖRÜNÜN **DIŞINDA**: `deploy/kur.ps1` çalışan kurulumu
// `app.eski-<damga>`ya taşıyıp yerine yeni `app\`ı koyar. Depo içeride olsaydı
// HER backend deploy'unda yayındaki paket ve geri dönüş geçmişi SİLİNİRDİ —
// yani backend'i güncellemek mobil güncellemeyi öldürürdü, sessizce.
//
// Varsayılan, çalışma dizininin KARDEŞİdir (`backups\` ile aynı katta):
//   üretim : cwd = C:\Etkili-Yazilim\app → C:\Etkili-Yazilim\mobil-guncelleme
// Ortam değişkeniyle taşınabilir: MOBILE_UPDATE_DIR (mutlak yol).
// =============================================================================

import path from "path";

/** Deponun kökü. Mutlak yola çevrilir — göreli kalırsa pm2'nin cwd'sine göre kayar. */
export const MOBILE_UPDATE_ROOT = path.resolve(
  process.env.MOBILE_UPDATE_DIR?.trim() || path.join(process.cwd(), "..", "mobil-guncelleme"),
);

/**
 * Multipart gövdenin SABİT sınırlayıcısı.
 *
 * ⚠️ `mobil/scripts/lib/feed.cjs` → `MULTIPART_BOUNDARY` ile AYNI olmak
 * ZORUNDA: gövdeyi yayın script'i üretir, `Content-Type` başlığını sunucu
 * basar. Ayrışırlarsa istemcinin MIME ayrıştırıcısı gövdeyi hiç göremez ve
 * durum "hata" değil "güncelleme yok" olarak görünür (sessiz arıza).
 * Bekçi: `scripts/test_mobile_update.ts`.
 */
export const MULTIPART_BOUNDARY = "tekserpota";
