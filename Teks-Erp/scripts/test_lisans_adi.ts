// =============================================================================
// BEKÇİ — LİSANS ADI (O4, K-7): ağdaki ve giriş ekranındaki ad lisanstan, belge unvanı ilk kez lisanstan
// Koşum: npx tsx scripts/run-all-tests.ts lisans_adi
// =============================================================================
// Tasarım: docs/design/TEK-ORTAK-PAKET.md §4. Ad HAK `musteri.ad`ından türer ve TEK helper'da yaşar
// (`lib/license/licensee-name.ts`). Keşif yükü ve `login-methods.companyName` `company.name`e BAKMAZ;
// belge unvanı (`company.name`) satırı yoksa ya da nötr yedekse bir kez lisans adıyla yazılır, fabrikanın
// girdiği ad hiçbir HAK'la ezilmez.
//
// §1 saf türetim · §2 keşif yükü (etkinleşmemiş → nötr + etkin:false) · §3 giriş ekranı adı (canlı uç)
// §4 unvan tohumlaması (DB; satır yok → yazılır + audit · ikinci çağrı dokunmaz · nötr → değişir ·
//    fabrika adı → dokunulmaz · lisans yok → yazılmaz) · §5 bağlantılar (kabul yolu, HAK adı okuyucuları)
//
// NEGATİF SONDALAR (ölçüldü 2026-10-06, cp+cmp ile birebir geri alındı; taban 19/0):
//   ① keşif `companyName`i sabit DEFAULT'a döndürülür                  → §2c + §2d ❌
//   ② tohumlamadaki `value: { equals: DEFAULT }` koşulu kaldırılır      → §4c + §4d ❌ (fabrika adı ezildi)
//   ③ login-methods `readCompanyName()`e döndürülür                     → §3a + §3b + §5c ❌
//   ④ kabul yolundan `seedCompanyNameQuietly` çağrısı silinir           → §5a ❌
// =============================================================================
import * as fs from "node:fs";
import * as path from "node:path";
import type { Request, Response } from "express";
import prisma, { pool } from "../src/lib/prisma";
import { DEFAULT_COMPANY_NAME, SETTING_KEYS } from "../src/services/system-setting.service";
import { __setEntitlementReaderForTests, licenseeNameFrom, screenCompanyName } from "../src/lib/license/licensee-name";
import { buildDiscoveryIdentity } from "../src/services/discovery.service";
import { seedCompanyNameFromLicense } from "../src/services/licensee-company-name.service";
import { AuthController } from "../src/controllers/auth.controller";
import { walkTs } from "./lib/ts-tarama";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

const engel = hedefDbEngeli();
if (engel) {
  console.error(`⛔ DURDURULDU — ${engel}`);
  process.exit(1);
}

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console[ok ? "log" : "error"](`${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}

const KOK = path.resolve(__dirname, "..");
const SRC = path.join(KOK, "src");
const read = (rel: string): string => fs.readFileSync(path.join(SRC, rel), "utf8");
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1");
const fakeHak = (ad: string) => () => ({ musteri: { id: "00000000-0000-4000-8000-000000000001", ad } });

function section1(): void {
  console.log("\n§1 saf türetim");
  check("§1a belge yok → null", licenseeNameFrom(null) === null && licenseeNameFrom(undefined) === null);
  check("§1b ad kırpılır", licenseeNameFrom({ musteri: { id: "x", ad: "  Örnek Dokuma  " } }) === "Örnek Dokuma");
  check("§1c boş ad → null", licenseeNameFrom({ musteri: { id: "x", ad: "   " } }) === null);
}

function section2(): void {
  console.log("\n§2 keşif yükü");
  __setEntitlementReaderForTests(() => null);
  const bos = buildDiscoveryIdentity();
  check("§2a etkinleşmemiş → nötr ad", bos.companyName === DEFAULT_COMPANY_NAME && screenCompanyName() === DEFAULT_COMPANY_NAME, bos.companyName);
  check("§2b etkinleşmemiş → etkin:false", bos.etkin === false);
  __setEntitlementReaderForTests(fakeHak("Lisans Dokuma Ltd"));
  const dolu = buildDiscoveryIdentity();
  check("§2c HAK → keşif adı lisanstan", dolu.companyName === "Lisans Dokuma Ltd" && dolu.etkin === true, dolu.companyName);
  __setEntitlementReaderForTests(fakeHak("A".repeat(150)));
  check("§2d uzun ad TXT bütçesine kırpılır (63)", buildDiscoveryIdentity().companyName.length === 63);
  __setEntitlementReaderForTests(() => {
    throw new Error("motor hazır değil");
  });
  check("§2e okuma hatası → nötr (fail-closed)", buildDiscoveryIdentity().companyName === DEFAULT_COMPANY_NAME && !buildDiscoveryIdentity().etkin);
}

async function loginMethodsName(): Promise<string | undefined> {
  let body: { data?: { companyName?: string } } | undefined;
  const res = {
    status() {
      return this;
    },
    json(b: unknown) {
      body = b as typeof body;
      return this;
    },
  } as unknown as Response;
  let err: unknown = null;
  await AuthController.loginMethods({} as Request, res, (e?: unknown) => {
    err = e ?? null;
  });
  if (err) throw err;
  return body?.data?.companyName;
}

async function section3(): Promise<void> {
  console.log("\n§3 giriş ekranı adı (login-methods)");
  await prisma.systemSetting.upsert({
    where: { key: SETTING_KEYS.COMPANY_NAME },
    create: { key: SETTING_KEYS.COMPANY_NAME, value: "Belge Unvanı A.Ş." },
    update: { value: "Belge Unvanı A.Ş." },
  });
  __setEntitlementReaderForTests(fakeHak("Lisans Dokuma Ltd"));
  const ad = await loginMethodsName();
  check("§3a ad lisanstan, company.name'e bakmaz", ad === "Lisans Dokuma Ltd", String(ad));
  __setEntitlementReaderForTests(() => null);
  const notr = await loginMethodsName();
  check("§3b lisanssız → nötr ürün adı", notr === DEFAULT_COMPANY_NAME, String(notr));
}

async function companyRow(): Promise<unknown> {
  const r = await prisma.systemSetting.findUnique({ where: { key: SETTING_KEYS.COMPANY_NAME }, select: { value: true } });
  return r ? r.value : null;
}

async function section4(): Promise<void> {
  console.log("\n§4 belge unvanı tohumlaması");
  const key = SETTING_KEYS.COMPANY_NAME;
  await prisma.systemSetting.deleteMany({ where: { key } });
  check("§4a lisans yok → yazılmaz", (await seedCompanyNameFromLicense(null)) === "LISANS_YOK" && (await companyRow()) === null);

  const basla = new Date();
  const ilk = await seedCompanyNameFromLicense("  Lisans Dokuma Ltd ");
  const log = await prisma.systemLog.count({ where: { tableName: "SYSTEM_SETTING", recordId: key, action: "CREATE", createdAt: { gte: basla } } });
  check("§4b satır yok → bir kez yazılır + audit", ilk === "YAZILDI" && (await companyRow()) === "Lisans Dokuma Ltd" && log === 1, `${ilk} · audit ${log}`);
  const ikinci = await seedCompanyNameFromLicense("Başka Lisans Adı");
  check("§4c ikinci çağrı dokunmaz", ikinci === "DOKUNULMADI" && (await companyRow()) === "Lisans Dokuma Ltd", ikinci);

  await prisma.systemSetting.update({ where: { key }, data: { value: "Fabrikanın Unvanı San. Tic." } });
  const fab = await seedCompanyNameFromLicense("Yeni HAK Adı");
  check("§4d fabrikanın girdiği ad ezilmez", fab === "DOKUNULMADI" && (await companyRow()) === "Fabrikanın Unvanı San. Tic.", `${fab} · ${String(await companyRow())}`);

  await prisma.systemSetting.update({ where: { key }, data: { value: DEFAULT_COMPANY_NAME } });
  const notr = await seedCompanyNameFromLicense("Lisans Dokuma Ltd");
  check("§4e nötr yedek → lisans adı", notr === "NOTR_DEGISTI" && (await companyRow()) === "Lisans Dokuma Ltd", notr);
}

function section5(): void {
  console.log("\n§5 bağlantılar");
  const sync = stripComments(read("services/license-sync.service.ts"));
  const acc = sync.slice(sync.indexOf("export async function acceptLicenseResponse"), sync.indexOf("function acceptVerifiedResponse"));
  check("§5a kabul yolu unvanı tohumlar + ilanı yeniler", /await seedCompanyNameQuietly\(\)/.test(acc) && /refreshMdnsTxt\(\)/.test(acc), `${acc.length} bayt`);
  const disc = stripComments(read("services/discovery.service.ts"));
  check("§5b keşif DB'ye ve company.name'e dokunmaz", disc.includes("currentLicenseeName") && !/\bprisma\b/.test(disc) && !/SETTING_KEYS|systemSetting|readCompanyName/.test(disc));
  const auth = stripComments(read("controllers/auth.controller.ts"));
  const lm = auth.slice(auth.indexOf("static async loginMethods"), auth.indexOf("static async loginMethods") + 900);
  check("§5c login-methods adı tek helper'dan", lm.includes("screenCompanyName()") && !lm.includes("readCompanyName"), `${lm.length} bayt`);
  // HAK adını okuyan yerler beyanlı: yeni bir okuyucu ad türetimini çoğaltır.
  const BEYAN = new Set(["lib/license/licensee-name.ts", "services/license-view.service.ts"]);
  const hits: string[] = [];
  let taranan = 0;
  for (const f of walkTs(SRC)) {
    taranan++;
    const rel = path.relative(SRC, f).split(path.sep).join("/");
    if (/\.test\.ts$/.test(rel)) continue;
    if (/\bmusteri\??\.ad\b/.test(stripComments(fs.readFileSync(f, "utf8")))) hits.push(rel);
  }
  const beyansiz = hits.filter((h) => !BEYAN.has(h));
  const olu = [...BEYAN].filter((b) => !hits.includes(b));
  check("§5d HAK `musteri.ad` yalnız beyanlı okuyucularda", taranan > 200 && beyansiz.length === 0 && olu.length === 0, `taranan ${taranan} · beyansız [${beyansiz.join(",")}] · ölü [${olu.join(",")}]`);
}

async function main(): Promise<void> {
  const before = await prisma.systemSetting.findUnique({ where: { key: SETTING_KEYS.COMPANY_NAME } });
  try {
    section1();
    section2();
    await section3();
    await section4();
    section5();
  } finally {
    __setEntitlementReaderForTests(null);
    await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.COMPANY_NAME } });
    if (before) await prisma.systemSetting.create({ data: { key: before.key, value: before.value as object, description: before.description, updatedById: before.updatedById } });
    await prisma.$disconnect();
    await pool.end();
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

void main();
