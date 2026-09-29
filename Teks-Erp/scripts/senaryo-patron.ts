// =============================================================================
// SENARYO P — patron bulutu uçtan uca (plan §8 "Senaryo P" P1…P16 + ESITLEME §13 P17…P25, SIRAYLA)
// =============================================================================
// Koşum (Teks-Erp/ içinden; hedefler YALNIZ `_test` DB — fabrika DB'lerine ASLA):
//   DATABASE_URL='postgresql://…/<fabrika>_test?schema=public' \
//     node ../scripts/agir-is.mjs -- npx tsx scripts/senaryo-patron.ts [--json=<dosya>] [--son=P7]
// Patron DB'si `patron/sunucu/.env`den (GOC/uygulama/eşitleme — üç rol, aynı `*_test` DB; migrate deploy
// önceden). GERÇEK süreçler: patron bulutu (`patron/sunucu/src/server.ts`) + fabrika backend'i (gerçek
// `src/server.ts`, giriş `lib/senaryo-patron-sunucu.ts`). Lisans: fikstür kökleri + sahte satıcı (URETIM,
// `patron-bulut` hakkı, eşitleme aralığı 1 dk) — gerçek satıcı bu hakkı henüz basmaz. Satıcı iç API'si
// (kurulum kaydı + zil) sahte: gerçek satıcıda `/ic/v1/*` yok. Zil zinciri gerçek: bulut → iç API →
// sahte satıcı SSE → fabrikanın `license-doorbell` işi → konu dağıtımı.
// Çıkış: 0 hepsi yeşil · 1 yeşil olmayan adım var · 2 hedef reddi / düzenek kurulamadı.
// =============================================================================
import fs from "node:fs";
import { duzenekKur, type Duzenek } from "./lib/senaryo-patron-duzenek";
import { Adim, type AdimFn } from "./lib/senaryo-patron-adim";
import { adimlarA } from "./lib/senaryo-patron-adimlar-a";
import { adimlarB } from "./lib/senaryo-patron-adimlar-b";
import { adimlarC } from "./lib/senaryo-patron-adimlar-c";
import { adimlarD } from "./lib/senaryo-patron-adimlar-d";
import { adimlarE } from "./lib/senaryo-patron-adimlar-e";
import { adimlarF } from "./lib/senaryo-patron-adimlar-f";

type Sonuc = "YESIL" | "KIRMIZI" | "KISMI";
interface AdimSonucu {
  no: string;
  baslik: string;
  sonuc: Sonuc;
  kanit: string[];
  neden: string | null;
  ms: number;
}
const sonuclar: AdimSonucu[] = [];

const SON_ADIM = process.argv.find((a) => a.startsWith("--son="))?.slice("--son=".length) ?? null;
const YALNIZ = process.argv.find((a) => a.startsWith("--yalniz="))?.slice("--yalniz=".length).split(",") ?? null;
class DurNoktasi extends Error {}

const adim: AdimFn = async (no, baslik, fn) => {
  if (SON_ADIM && sonuclar.some((s) => s.no === SON_ADIM)) throw new DurNoktasi(SON_ADIM);
  if (YALNIZ && !YALNIZ.includes(no)) return;
  console.log(`\n${no} ${baslik}`);
  const a = new Adim();
  const t0 = Date.now();
  try {
    await fn(a);
  } catch (err) {
    a.kontrol("adım istisnasız tamamlandı", false, (err as Error).stack?.split("\n").slice(0, 3).join(" | ") ?? String(err));
  }
  const sonuc: Sonuc = a.kirmizi > 0 ? "KIRMIZI" : a.kismiNedeni ? "KISMI" : "YESIL";
  sonuclar.push({ no, baslik, sonuc, kanit: a.kanit, neden: a.kismiNedeni, ms: Date.now() - t0 });
};

async function main(): Promise<number> {
  const jsonCikti = process.argv.find((a) => a.startsWith("--json="))?.slice("--json=".length) ?? null;
  let d: Duzenek;
  try {
    d = await duzenekKur();
  } catch (err) {
    console.error(`⛔ Düzenek: ${(err as Error).message}`);
    return 2;
  }
  try {
    await adimlarA(d, adim);
    await adimlarB(d, adim);
    await adimlarC(d, adim);
    await adimlarD(d, adim);
    await adimlarE(d, adim);
    await adimlarF(d, adim);
  } catch (err) {
    if (!(err instanceof DurNoktasi)) console.error(`⛔ koşucu: ${(err as Error).stack ?? String(err)}`);
  }
  const yesil = sonuclar.filter((s) => s.sonuc === "YESIL").length;
  const basarili = yesil === sonuclar.length && sonuclar.length > 0;
  await d.kapat(basarili);
  console.log("\n=== SENARYO P ÖZETİ ===");
  for (const s of sonuclar) console.log(`${s.sonuc === "YESIL" ? "🟢" : s.sonuc === "KISMI" ? "🟡" : "🔴"} ${s.no} ${s.baslik}${s.neden ? ` — ${s.neden}` : ""} (${Math.round(s.ms / 1000)} sn)`);
  console.log(`\n${yesil}/${sonuclar.length} yeşil`);
  if (jsonCikti) fs.writeFileSync(jsonCikti, JSON.stringify(sonuclar, null, 2));
  return basarili ? 0 : 1;
}

main()
  .then((kod) => process.exit(kod))
  .catch((err: Error) => {
    console.error(`⛔ ${err.stack ?? err.message}`);
    process.exit(2);
  });
