// =============================================================================
// BACKEND YAYIN GÖRÜNÜMÜ (3.9 D5) — DB'siz. `backendPublished` iki imza takımını okur:
//   §1 yalnız son.json → imza ESKI, eskiSurum null
//   §2 son.json + son-zincir.json → imza ZINCIR, sürüm zincirden, eskiSurum son.json'dan (köprü görünümü)
//   §3 yalnız son-zincir.json → ZINCIR, eskiSurum null · §4 hiçbiri → null · §5 bozuk zincir işaretçisi → sürüm null, ZINCIR
// Koşum: npx tsx scripts/test_backend_yayin_gorunumu.ts
// =============================================================================
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

let gecti = 0;
let kaldi = 0;
function ol(ad: string, ok: boolean, detay = ""): void {
  if (ok) gecti++;
  else kaldi++;
  console.log(`${ok ? "✅" : "❌"} ${ad}${ok || !detay ? "" : ` — ${detay}`}`);
}
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const isaretci = (surum: string) => `${JSON.stringify({ v: 1, bildirim: `${b64({ alg: "EdDSA", kid: "k" })}.${b64({ surum })}.c2FodGU` })}\n`;

async function main(): Promise<void> {
  // Görünüm modülü prisma'yı tip için değil yan etkiyle yükler; bağlantı AÇILMAZ (yalnız diske bakılır).
  process.env.DATABASE_URL ??= "postgresql://bekci@127.0.0.1:1/baglanilmaz_test";
  const { backendPublished } = await import("../src/distribution/releases.view");
  const kok = mkdtempSync(path.join(os.tmpdir(), "backend-yayin-gorunumu-"));
  try {
    const dizin = (g: string) => {
      const d = path.join(kok, "html", g, "backend");
      mkdirSync(d, { recursive: true });
      return d;
    };
    writeFileSync(path.join(dizin("a"), "son.json"), isaretci("2.14.0"));
    const a = await backendPublished(kok, "a");
    ol("§1 yalnız son.json → ESKI, eskiSurum null", a?.surum === "2.14.0" && a.imza === "ESKI" && a.eskiSurum === null, JSON.stringify(a));

    writeFileSync(path.join(dizin("b"), "son.json"), isaretci("2.14.0"));
    writeFileSync(path.join(dizin("b"), "son-zincir.json"), isaretci("2.15.0"));
    const b = await backendPublished(kok, "b");
    ol("§2 iki işaretçi → ZINCIR önce, eski takımın sürümü ayrı (köprü görünümü)", b?.surum === "2.15.0" && b.imza === "ZINCIR" && b.eskiSurum === "2.14.0", JSON.stringify(b));

    writeFileSync(path.join(dizin("c"), "son-zincir.json"), isaretci("2.15.0"));
    const c = await backendPublished(kok, "c");
    ol("§3 yalnız son-zincir.json → ZINCIR, eskiSurum null", c?.surum === "2.15.0" && c.imza === "ZINCIR" && c.eskiSurum === null, JSON.stringify(c));

    dizin("d");
    ol("§4 işaretçi yok → null", (await backendPublished(kok, "d")) === null);

    writeFileSync(path.join(dizin("e"), "son.json"), isaretci("2.14.0"));
    writeFileSync(path.join(dizin("e"), "son-zincir.json"), "bozuk");
    const e = await backendPublished(kok, "e");
    ol("§5 bozuk zincir işaretçisi → ZINCIR, sürüm null (eskiye sessiz dönüş yok)", e?.imza === "ZINCIR" && e.surum === null && e.eskiSurum === "2.14.0", JSON.stringify(e));
  } finally {
    rmSync(kok, { recursive: true, force: true });
  }
  console.log(`\n=== Sonuç: ${gecti} geçti, ${kaldi} başarısız ===`);
  if (kaldi) process.exit(1);
}
void main();
