// =============================================================================
// KAPI DEFTERİ — commit kapısının her adımı makine-yerel bir TSV'ye tek satır yazar
// =============================================================================
// NEDEN (1e hükmü 2026-09-14): hook çıktısı yalnız o oturumun terminalinde kalıyor;
// "hangi mandal kimi ısırdı", "semafor kaç sn bekletti" soruları beyana bağlıydı.
// Satır: zaman · wt BASENAME (tam yol değil) · adım · ✅/❌/⏭ · sn · çıkış kodu · load1.
// load1 (1 dk yük ortalaması) sonradan eklendi: 0c'nin Electron test adımı yük altında
// 3×5000 ms zaman aşımıyla düştü, tek başına 21 sn — semafor kapıları sayar, oturumların
// kapı-DIŞI tsc/tsx koşumlarını saymaz; ısırığın yükle ilişkisi yalnız bu sütunla ölçülür.
// Kimlik/sır YOK. Append-only; okuyan `cut -f`/awk ile keser.
//
// KAPSAM BEYANI: yalnız BU MAKİNENİN commit kapıları ve `agir-is.mjs` ile sarmalanan
//    işler; CI kapıları burada yok, tmpdir temizlenirse iz gider. Bir ölçüm aracıdır,
//    defter/denetim kaydı değil (saklama süresi sonlu — kök CLAUDE.md § telemetri).
//
// ⚠️ BEST-EFFORT: defter yüzünden kapı ASLA düşmez — yazılamıyorsa sessiz. Tek istisna
//    TANIMSIZ GLİF: ✅/❌/⏭ dışı bir sonuç satır OLMAZ (sessiz "?" değil) ve stderr'e tek
//    satır düşer; çıkış kodu yine değişmez — glif/beyan öneki yeniden adlandırılırsa
//    defter sessizce "?"le dolmasın (sessiz kapı ölümü ailesi, d9 ölçtü 2026-09-14).
//    Kapının kararı adımların çıkış kodudur; defter yalnız izdir.
// =============================================================================
import { appendFileSync } from "node:fs";
import { loadavg, tmpdir } from "node:os";
import { join } from "node:path";

// Sonda kendi yolunu verir; üretimde env YOK.
export const DEFTER_YOLU = process.env.TEKSERP_KAPI_DEFTERI ?? join(tmpdir(), "tekserp-kapi-defteri.tsv");

const temizle = (s) => String(s ?? "").replace(/[\t\r\n]+/g, " ").trim();
export const GLIFLER = ["✅", "❌", "⏭"];

/** Tek satırın biçimi — bekçi bu fonksiyonu ölçer, dosyayı değil. Tanımsız glif → null. */
export function defterSatiri({ wt, adim, sonuc, sn, cikis }) {
  if (!GLIFLER.includes(sonuc)) return null;
  const kolon = [
    new Date().toISOString(),
    temizle(wt).replace(/[\\/]/g, "_") || "-",
    temizle(adim) || "-",
    sonuc,
    Number.isFinite(Number(sn)) ? Number(sn).toFixed(1) : "-",
    cikis === null || cikis === undefined ? "-" : temizle(cikis),
    loadavg()[0].toFixed(1),
  ];
  return `${kolon.join("\t")}\n`;
}

/** Append; hata yutulur (bkz. başlık). Döner: yazıldı mı (yalnız teşhis/bekçi için). */
export function deftereYaz(kayit) {
  const satir = defterSatiri(kayit);
  if (satir === null) {
    process.stderr.write(`   kapı defteri: tanımsız sonuç glifi ${JSON.stringify(kayit?.sonuc)} — satır yazılmadı (${GLIFLER.join(" ")})\n`);
    return false;
  }
  try {
    appendFileSync(DEFTER_YOLU, satir);
    return true;
  } catch {
    return false;
  }
}
