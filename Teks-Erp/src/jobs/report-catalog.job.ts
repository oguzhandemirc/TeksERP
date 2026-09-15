// =============================================================================
// RAPOR GÖRÜNÜRLÜK LİSTESİNİN BOOT DENETİMİ (Raporlar K2/K3)
// =============================================================================
// `reports.closedKeys` KATALOG anahtarlarını taşır, ama katalog kod içinde yaşar
// ve liste DB'de: bir rapor katalogdan çıkarıldığında listede BAYAT bir anahtar
// kalır. Bu arıza sessizdir — kapı bayat anahtarı atlar (okumada yok sayılır,
// 1e hükmü), yani hiçbir istek düşmez ve kimse fark etmez.
//
// ⚠️ NEDEN BOOT'TA VE NEDEN YALNIZ UYARI:
//   • Yazma ucu tipo'yu zaten ADIYLA reddeder (400 `REPORT_KEY_UNKNOWN`), yani
//     buraya düşen anahtar bir tipo DEĞİL, bir zamanlar GEÇERLİ olmuş bir
//     anahtardır — kurulumun bir kararının izidir. Sessizce silmek o kararı
//     yok eder; 500 vermek ise bir rapor silindi diye fabrikayı durdurur.
//   • Listeyi temizlemek bir SÜPERADMİN kararıdır (K3): job kendi başına
//     yazmaz. Yazsaydı, `module-profile.job`ın ② kuralının tersini yapardı —
//     fabrikanın panelden verdiği karar her restart'ta sessizce değişirdi.
//
// ⚠️ TEK SEFER: uyarı boot'ta bir kez basılır. Kapının her isteğinde basılsaydı
// log'u boğar ve asıl arıza satırlarını görünmez yapardı.
// =============================================================================
import { REPORT_BY_KEY } from "../constants/report-catalog";
import { readReportsClosedKeys } from "../services/system-setting.service";
import { bilgi, uyari } from "../lib/logger";

const ETIKET = "rapor-katalogu";

/** Boot denetimi — best-effort: DB hazır değilse SESSİZ döner (sunucuyu durdurmaz). */
export async function warnStaleReportKeys(): Promise<void> {
  let visibility: Awaited<ReturnType<typeof readReportsClosedKeys>>;
  try {
    visibility = await readReportsClosedKeys();
  } catch (e) {
    // DB henüz ayakta olmayabilir. Uyarının kendisi bir kapı DEĞİL — kapı
    // `requireReportOpen`tadır ve o fail-closed davranır.
    uyari(ETIKET, `kapalı rapor listesi boot'ta okunamadı: ${(e as Error).message}`);
    return;
  }
  if (visibility.durum === "olculemedi") {
    // ⚠️ BU SATIR BİR ARIZA BEYANIDIR: liste bozuk olduğu SÜRECE 29 rapor ucunun
    // hepsi 403 `REPORT_GATE_UNAVAILABLE` verir. Sessiz kalsaydı destek ekibi
    // "yetki sorunu" diye arardı.
    uyari(ETIKET, `kapalı rapor listesi OKUNAMADI (${visibility.neden}); ` +
      "rapor uçları fail-closed 403 veriyor — Sistem → Raporlar bölümünden liste yeniden kaydedilmeli");
    return;
  }
  const bayat = visibility.kapali.filter((k) => !REPORT_BY_KEY.has(k));
  if (bayat.length === 0) {
    if (visibility.kapali.length > 0) bilgi(ETIKET, `${visibility.kapali.length} rapor kapalı`);
    return;
  }
  uyari(ETIKET, `kapalı rapor listesinde katalogda OLMAYAN ${bayat.length} anahtar var ` +
    `(${bayat.join(", ")}); kapı bunları yok sayıyor — Sistem → Raporlar bölümünden liste ` +
    "yeniden kaydedilerek temizlenir");
}
