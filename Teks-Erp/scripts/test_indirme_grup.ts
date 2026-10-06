// =============================================================================
// BEKÇİ — İNDİRME BELİRTECİ YANITINDA GÜNCELLEME GRUBU (tek ortak paket O3, TEK-ORTAK-PAKET.md §3.4)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts indirme_grup   (DB'siz; saf + statik)
//
// NE ÖLÇER:
//   §1 `updateGroupOf` (saf): kira yok → null · biçimsiz kod (büyük harf, boşluk, `/`, `..`, 41 karakter) → null ·
//      pasif/eski kanal kodu (demofabrika · adnansahin · deneme-kanal) ve ayrılmış `ota` → null · üç grup → kendisi
//   §2 panel görünümü (`updateStatusFrom`): kira yok → grup null · eski kanalın kirası → kanal kodu durur, grup null ·
//      grup kirası → grup = kanal
//   §3 bağlantı (statik): uç yanıtı `grup`u YALNIZ doğrulanmış kiradan (`snap.lease`) alır, sorgudaki `kanal`
//      parametresinden değil · yanıt tipinde `grup` · swagger notu `grup` alanını yazar
// NEGATİF SONDA (elle, geri alındı; commit mesajında).
// =============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import { msToIso, type LeaseDoc } from "../src/lib/license/protocol";
import { UPDATE_GROUPS, updateGroupOf } from "../src/lib/license/update-group";
import { updateStatusFrom } from "../src/services/update-status.service";

const KOK = path.resolve(__dirname, "..");
const SIMDI = Date.parse("2026-10-06T10:00:00.000Z");

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}${detay ? ` — ${detay}` : ""}`);
}

function saf(): void {
  console.log("\n§1 updateGroupOf (saf)");
  check("§1a kira yok (null/undefined) → null", updateGroupOf(null) === null && updateGroupOf(undefined) === null);
  const bicimsiz = ["", "Test", "test ", " test", "test/electron", "../test", "-test", "t".repeat(41), "tеst"];
  const kacan = bicimsiz.filter((k) => updateGroupOf(k) !== null);
  check("§1b biçimsiz kod → null", kacan.length === 0, kacan.join(", "));
  const eski = ["demofabrika", "adnansahin", "deneme-kanal", "testfabrika", "ota", "hazirlik"];
  const sizan = eski.filter((k) => updateGroupOf(k) !== null);
  check("§1c ⭐ pasif/eski kanal ve ayrılmış ad → null (pasif kanalın kirası da kod taşır)", sizan.length === 0, sizan.join(", "));
  check("§1d üç grup → kendisi, terfi sırasıyla", JSON.stringify(UPDATE_GROUPS) === '["test","oncu","genel"]' && UPDATE_GROUPS.every((g) => updateGroupOf(g) === g));
}

function kira(kod: string): LeaseDoc {
  return {
    kanal: { kod },
    bitis: msToIso(SIMDI + 30 * 24 * 3600 * 1000),
    yaptirim: { kademe: null, mesaj: null, kisitlamaTarihi: null, donmusModuller: [], guncellemeDonuk: false },
    guncelleme: undefined,
  } as unknown as LeaseDoc;
}

function panel(): void {
  console.log("\n§2 panel görünümü (updateStatusFrom)");
  const read = { status: { kind: "missing" }, history: [] } as never;
  const gor = (lease: LeaseDoc | null) => updateStatusFrom({ lease, tokens: [], read, kuruluSurum: "2.14.0", nowMs: SIMDI });
  const yok = gor(null);
  check("§2a kira yok → grup null", yok.grup === null && yok.kanal === null);
  const eski = gor(kira("demofabrika"));
  check("§2b ⭐ eski kanalın kirası → kanal durur, grup null", eski.kanal === "demofabrika" && eski.grup === null, JSON.stringify({ kanal: eski.kanal, grup: eski.grup }));
  const oncu = gor(kira("oncu"));
  check("§2c grup kirası → grup = kanal", oncu.kanal === "oncu" && oncu.grup === "oncu");
}

function baglanti(): void {
  console.log("\n§3 bağlantı (statik)");
  const oku = (rel: string) => readFileSync(path.join(KOK, rel), "utf8");
  const svc = oku("src/services/license-view.service.ts");
  const govde = /export function getDownloadToken\([\s\S]*?\n\}\n/.exec(svc)?.[0] ?? "";
  const donus = /return \{ \.\.\.d\.token, grup: ([^}]+) \};/.exec(govde)?.[1]?.trim() ?? "";
  check("§3a ⭐ yanıtın grubu doğrulanmış kiradan", donus === "updateGroupOf(snap.lease?.document.kanal.kod)", donus || "dönüş satırı bulunamadı");
  check("§3b grup sorgu parametresinden türemez", !donus.includes("g.kanal") && !/\bkanal\)/.test(donus));
  const tip = /export type LicenseDownloadToken = DownloadTokenCore & \{([^}]*)\};/.exec(svc)?.[1] ?? "";
  check("§3c yanıt tipinde grup: UpdateGroup | null", /readonly grup: UpdateGroup \| null\s*$/.test(tip));
  const rota = oku("src/routes/license.routes.ts");
  check("§3d swagger notu grup alanını yazar", /200: \{ description: "\{ yolOneki, belirtec, gecerlilikSonu, grup \}/.test(rota));
  const gnc = oku("src/routes/update.routes.ts");
  check("§3e güncelleme durumu swagger'ı grup alanını yazar", gnc.includes("{ kuruluSurum, kanal, grup,"));
}

function main(): void {
  console.log("=== İNDİRME GRUBU (O3) ===");
  saf();
  panel();
  baglanti();
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
