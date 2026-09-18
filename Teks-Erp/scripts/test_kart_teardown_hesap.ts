// =============================================================================
// BEKÇİ — KART DOĞURAN BEKÇİ TEARDOWN'U HESABI DA SİLER VE HATAYI YUTMAZ (Z-A sonrası, 2026-09-18)
// =============================================================================
//   §0 statik tarama: `scripts/` altında kartı SERVİS/HTTP ile açan (`CustomerService(` · `customerService.create(` ·
//      `POST /api/customers`) ve kart silen HER bekçi ortak temizleyiciyi (`cleanupTestCustomers`) çağırır ya da hesabı
//      açıkça siler; `customer.delete*(…).catch(` deseni (hatayı yutan teardown) YASAK — kalıntı bırakan teardown yeşil
//      görünüyordu ve sonraki paketleri vergi-no seddi / bulanık ad grubuyla düşürüyordu.
//   §1 işlevsel (finans AÇIK): servisle açılan kart hesabıyla doğar → yalın `customer.delete` FK'ya takılır (P2003 —
//      sınıfın kanıtı) → `cleanupTestCustomers` kart + hesap + şubeyi siler, geriye satır kalmaz; finans KAPALI: hesapsız
//      kart da aynı yoldan temizlenir (helper iki kolda çalışır).
//   §2 `withBarcodeRetry` yalnız KOD P2002'sini yeniden dener: `nameFold` P2002'si `p2002TargetsCode` ile false →
//      `customerService.create` dürüst 409 `CUSTOMER_NAME_DUPLICATE` (5 boş deneme + "Barkod üretimi" mesajı yok)
//
// ⭐ NEGATİF SONDA (ölçüldü 2026-09-18): ① helper'dan `cariAccount.deleteMany` satırı düşürülünce §0d ❌ + §1c'de P2003 ile
//    ÇÖKME (kart silinemez; kırmızı yine kırmızı) · ② `test_customer.ts` teardown'u `.catch(() => {})`'lı eski biçime çevrilince §0b/§0c ❌.
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; `finance.enabled` fotoğrafa döner; temizlik `temizle`.
// =============================================================================
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { customerService } from "../src/routes/customer.routes";
import { cleanupTestCustomers } from "./fixture-customer-cleanup";
import { p2002TargetsCode } from "../src/utils/barcode-retry";
import { AppError } from "../src/utils/app-error";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
const ROOT = path.resolve(__dirname, "..");
const TAG = `TEST-KTH-${process.pid}`;
const FIN = SETTING_KEYS.FINANCE_ENABLED;

const KART_ACAN = /new CustomerService\(|customerService\.create\(|["'`]\/api\/customers["'`,]|POST",\s*["'`]\/api\/customers/;
const KART_SILEN = /prisma\.customer\.delete(Many)?\(|cleanupTestCustomers\(/;
const YUTAN = /customer\.delete(Many)?\([^;]*\)\s*\.catch\(/;

function statik(): void {
  console.log("── §0 Statik tarama ──");
  const dosyalar = readdirSync(path.join(ROOT, "scripts")).filter((f) => f.startsWith("test_") && f.endsWith(".ts") && f !== path.basename(__filename));
  const kapsam: string[] = [];
  const eksik: string[] = [];
  const yutan: string[] = [];
  for (const f of dosyalar) {
    const src = readFileSync(path.join(ROOT, "scripts", f), "utf8");
    if (!KART_ACAN.test(src) || !KART_SILEN.test(src)) continue;
    kapsam.push(f);
    if (!/cleanupTestCustomers\(/.test(src) && !/cariAccount\.deleteMany\(/.test(src)) eksik.push(f);
    if (YUTAN.test(src)) yutan.push(f);
  }
  check(`§0a kapsam ölçüldü: servis/HTTP ile kart açıp kart silen bekçi sayısı ≥ 7 (${kapsam.length})`, kapsam.length >= 7, kapsam.join(", "));
  check("§0b ⭐ kapsamdaki her bekçi hesabı da siler (`cleanupTestCustomers` ya da açık `cariAccount.deleteMany`)", eksik.length === 0, eksik.join(", ") || "eksik yok");
  check("§0c ⭐ kapsamda `customer.delete*(…).catch(` (hatayı yutan teardown) YOK", yutan.length === 0, yutan.join(", ") || "yutan yok");
  const helper = readFileSync(path.join(ROOT, "scripts/fixture-customer-cleanup.ts"), "utf8").split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");
  check("§0d helper sırası: hareket → bakiye → hesap → şube → kart; hiçbir adım `.catch` ile susturulmaz", /cariTransaction\.deleteMany[\s\S]*cariBalance\.deleteMany[\s\S]*cariAccount\.deleteMany[\s\S]*customerBranch\.deleteMany[\s\S]*customer\.deleteMany/.test(helper) && !/\.catch\(/.test(helper));
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exit(2);
  }
  console.log("=== KART TEARDOWN ↔ HESAP BEKÇİSİ ===\n");
  statik();
  const foto = await prisma.systemSetting.findMany({ where: { key: FIN }, select: { key: true, value: true } });
  const setFin = (v: boolean) => prisma.systemSetting.upsert({ where: { key: FIN }, create: { key: FIN, value: v }, update: { value: v } });
  const ids: string[] = [];
  try {
    console.log("\n── §1 İşlevsel ──");
    await setFin(true);
    const k1 = (await customerService.create({ name: `${TAG} Açık`, isCustomerRole: true })) as { data: { id: string } };
    ids.push(k1.data.id);
    check("§1a finans AÇIK: servisle açılan kart hesabıyla doğdu", (await prisma.cariAccount.count({ where: { customerId: k1.data.id } })) === 1);
    let p2003 = false;
    try {
      await prisma.customer.delete({ where: { id: k1.data.id } });
    } catch (e) {
      p2003 = e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003";
    }
    check("§1b sınıfın kanıtı: yalın `customer.delete` FK'ya takılır (P2003) — `.catch` bunu yutunca kalıntı kalırdı", p2003);
    await cleanupTestCustomers([k1.data.id]);
    check("§1c ⭐ `cleanupTestCustomers`: kart + hesap gitti, satır kalmadı", (await prisma.customer.count({ where: { id: k1.data.id } })) === 0 && (await prisma.cariAccount.count({ where: { customerId: k1.data.id } })) === 0);
    await setFin(false);
    const k2 = (await customerService.create({ name: `${TAG} Kapalı`, isCustomerRole: true, branches: [{ name: `${TAG} Şube`, code: `${TAG}-SB` }] })) as { data: { id: string } };
    ids.push(k2.data.id);
    check("§1d finans KAPALI: hesap doğmaz; helper şubeli kartı da temizler", (await prisma.cariAccount.count({ where: { customerId: k2.data.id } })) === 0);
    await cleanupTestCustomers([k2.data.id]);
    check("§1e kapalı kolda da satır kalmadı (şube dahil)", (await prisma.customer.count({ where: { id: k2.data.id } })) === 0 && (await prisma.customerBranch.count({ where: { customerId: k2.data.id } })) === 0);

    console.log("\n── §2 Retry yalnız kod P2002'sine ──");
    const mk = (target: unknown) => new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x", meta: { target } });
    check("§2a `p2002TargetsCode`: ['code'] → true · 'customers_code_key' → true · 'customers_name_fold_live_uq' → false · ['taxNumber'] → false · hedefsiz → true (geriye uyumlu)", p2002TargetsCode(mk(["code"])) && p2002TargetsCode(mk("customers_code_key")) && !p2002TargetsCode(mk("customers_name_fold_live_uq")) && !p2002TargetsCode(mk(["taxNumber"])) && p2002TargetsCode(mk(undefined)));
    const k3 = (await customerService.create({ name: `${TAG} Tekil Ad`, isCustomerRole: true })) as { data: { id: string } };
    ids.push(k3.data.id);
    // Ad-mükerrer guard'ını ATLAYIP doğrudan sed'e çarpmak için aynı `nameFold`u taşıyan bir kartı guard'ın göremeyeceği yerden
    // ölçemeyiz (guard önce koşar ve 409 verir) — o yüzden guard'ın kendi 409'unu ve mesajını ölçüyoruz: iki durumda da
    // "Barkod üretimi … başarısız" DEĞİL, ad-mükerrer cümlesi.
    let e3: AppError | null = null;
    try {
      await customerService.create({ name: `${TAG} tekil ad`, isCustomerRole: true });
    } catch (e) {
      if (e instanceof AppError) e3 = e;
      else throw e;
    }
    check("§2b aynı ad (harf farkı) → 409, mesaj 'adında bir müşteri zaten var' (Barkod üretimi cümlesi YOK)", e3?.statusCode === 409 && /adında bir müşteri zaten var/.test(e3.message) && !/Barkod/.test(e3.message), e3?.message ?? "geçti");
  } finally {
    await temizle(ids, foto);
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

async function temizle(ids: string[], foto: Array<{ key: string; value: Prisma.JsonValue }>): Promise<void> {
  await cleanupTestCustomers(ids);
  await prisma.systemLog.deleteMany({ where: { recordId: { in: ids } } });
  const eski = foto.find((f) => f.key === FIN);
  if (eski) await prisma.systemSetting.upsert({ where: { key: FIN }, create: { key: FIN, value: eski.value as Prisma.InputJsonValue }, update: { value: eski.value as Prisma.InputJsonValue } });
  else await prisma.systemSetting.deleteMany({ where: { key: FIN } });
}

main().catch(async (e) => {
  console.error("HATA", e);
  await pool.end();
  process.exit(1);
});
