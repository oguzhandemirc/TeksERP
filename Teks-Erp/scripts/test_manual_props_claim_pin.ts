// =============================================================================
// Test: "Düzelt" (applyManualProperties) claim'i KARARIN DAYANDIĞI ALANLARI pinler
// Çalıştır: npx tsx scripts/test_manual_props_claim_pin.ts
// =============================================================================
// BULGU-T1-001 (S1/K3) + BULGU-T1-085 (S2): fonksiyonun iki kararı da tx DIŞINDA
// okunan satırdan geliyordu — kapsam/yetki `roll.status`'tan, metraj düzeltme izni
// `rollWhole = initialQty.equals(currentQty)`den. Yazım MUTLAK olduğu için
// (`currentQty = initialQty = m`) aradaki pencerede yapılan Tambur kesimi sessizce
// geri alınıyordu: ölçüldü (audit_repro_D-A-01, 10/10) 100 m'lik top 140,5 m oldu.
//
// ⚠️ Bu testin ölçtüğü şey "kilit var mı" DEĞİL, "yazım okunan satıra ÇAKILI mı".
// `rollWhole` guard'ını tx içine taşımak yetmez (kesim iki metrajı da düşürür →
// guard yeniden hesaplansa bile yeşil kalır); tek çözüm pinlemektir.
//
// KÖRLÜK ZEMİNİ: her bölüm önce "düzeltme normal koşulda ÇALIŞIYOR" ölçümünü yapar.
// O olmadan "409 aldı" sonucu, fonksiyonun tümden bozuk olmasıyla aynı yeşile çıkar.
// =============================================================================
import { RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { InventoryService } from "../src/services/inventory.service";

const inventory = new InventoryService();
const DAMGA = `TSTPIN-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

function need<T>(v: T | null | undefined, ne: string): T {
  if (v == null) throw new Error(`Fixture bulunamadı: ${ne}`);
  return v;
}

async function hata(fn: () => Promise<unknown>): Promise<{ status?: number; message: string } | null> {
  try { await fn(); return null; } catch (e) {
    const err = e as { statusCode?: number; message?: string };
    return { status: err.statusCode, message: err.message ?? "" };
  }
}

async function main(): Promise<void> {
  const admin = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin");
  const item = need(await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } }), "aktif kumaş");

  const topYarat = async (qty: number) =>
    prisma.roll.create({
      data: {
        barcode: `${DAMGA}-${Math.random().toString(36).slice(2, 7)}`,
        itemId: item.id, initialQty: qty, currentQty: qty,
        status: RollStatus.WAREHOUSE, createdById: admin.id,
      },
      select: { id: true, colorId: true, currentQty: true, initialQty: true, status: true },
    });

  const yaratilan: string[] = [];
  try {
    // ── §1 KÖRLÜK ZEMİNİ: metraj düzeltmesi normal koşulda ÇALIŞIR ────────────
    const t1 = await topYarat(100);
    yaratilan.push(t1.id);
    const ok1 = await hata(() =>
      inventory.applyManualProperties(t1.id, { colorId: t1.colorId, propertyIds: [], currentQty: 90, reason: "TEST düzeltme" }, admin.id),
    );
    const sonra1 = await prisma.roll.findUnique({ where: { id: t1.id }, select: { currentQty: true, initialQty: true } });
    check("§1 körlük zemini: çakışma yokken metraj düzeltmesi uygulanıyor", ok1 === null && sonra1?.currentQty.equals(90) === true,
      ok1 ? `beklenmeyen hata: ${ok1.message}` : `currentQty=${sonra1?.currentQty.toString()}`);
    check("§1b düzeltme initialQty'yi de yazar (ölçüm düzeltmesi sözleşmesi)", sonra1?.initialQty.equals(90) === true);

    // ── §2 ASIL KORUMA: okunan metraj ARADA değişirse yazım REDDEDİLİR ────────
    // Yarışı deterministik kur: servisin tx-dışı okumasından sonra satırı biz
    // değiştiriyoruz (Tambur kesiminin yaptığı şeyin birebir aynısı: her iki
    // metrajı da düşürmek — yani `rollWhole` guard'ı yeniden hesaplansa bile
    // YEŞİL kalacağı durum).
    const t2 = await topYarat(100);
    yaratilan.push(t2.id);
    // Servis tx-DIŞI okumayı yaptıktan SONRA satırı değiştir: havuz client'ının
    // `findUnique`'ini tek seferlik sarmalıyoruz. Üretim koduna DOKUNULMAZ; tx
    // içindeki okuma `tx.roll` üzerinden gittiği için etkilenmez.
    type FindUniqueFn = (args: unknown) => Promise<unknown>;
    const delege = prisma.roll as unknown as { findUnique: FindUniqueFn };
    const orijinal = delege.findUnique.bind(prisma.roll) as FindUniqueFn;
    let araya_girildi = false;
    delege.findUnique = async (args: unknown) => {
      const res = await orijinal(args);
      const id = (args as { where?: { id?: string } })?.where?.id;
      if (!araya_girildi && id === t2.id) {
        araya_girildi = true;
        await prisma.roll.update({ where: { id: t2.id }, data: { currentQty: 59.5, initialQty: 59.5 } });
      }
      return res;
    };

    // ⚠️ İSTENEN DEĞER, OKUNAN DEĞERDEN FARKLI OLMALI. Aynı değer gönderilirse
    // servis "değişiklik yok" der ve metrajı hiç YAZMAZ (no-op) — pin devreye
    // girmez, 409 da doğmaz. İlk yazımda test tam bu tuzağa düştü: §2c "metraj
    // korundu" diye YEŞİL veriyordu ama korunmasının sebebi düzeltmenin hiç
    // yazılmamasıydı, yani kontrol hiçbir şey ölçmüyordu.
    const ok2 = await hata(() =>
      inventory.applyManualProperties(t2.id, { colorId: t2.colorId, propertyIds: [], currentQty: 95, reason: "TEST bayat metraj" }, admin.id),
    );
    delege.findUnique = orijinal;

    const sonra2 = await prisma.roll.findUnique({ where: { id: t2.id }, select: { currentQty: true, initialQty: true } });
    check("§2 araya giren kesim gerçekten uygulandı (sonda kuruldu)", araya_girildi);
    check("§2b bayat metrajla gelen düzeltme 409 ile REDDEDİLİR", ok2?.status === 409, ok2 ? ok2.message.slice(0, 120) : "hata alınmadı — yazım geçti");
    check("§2c kesimin yazdığı metraj KORUNDU (lost update yok)", sonra2?.currentQty.equals(59.5) === true,
      `currentQty=${sonra2?.currentQty.toString()} (beklenen 59.5)`);
    check("§2d hata mesajı sebebi söylüyor (metraj değişti)", (ok2?.message ?? "").includes("metrajı bu sırada değişti"));

    // ── §3 Metraj YAZILMAYAN düzeltme, metraj değişse de geçer ───────────────
    // (toplu renk/en düzeltmesi bu yoldan koşar; orada pinlemek gereksiz 409 üretirdi)
    const t3 = await topYarat(100);
    yaratilan.push(t3.id);
    await prisma.roll.update({ where: { id: t3.id }, data: { currentQty: 70 } });
    const ok3 = await hata(() =>
      inventory.applyManualProperties(t3.id, { colorId: t3.colorId, propertyIds: [], width: 150, reason: "TEST en" }, admin.id),
    );
    check("§3 metraj göndermeyen düzeltme (renk/en) metraj farkından etkilenmez", ok3 === null,
      ok3 ? ok3.message.slice(0, 120) : "");
  } finally {
    if (yaratilan.length) {
      await prisma.rollProperty.deleteMany({ where: { rollId: { in: yaratilan } } }).catch(() => {});
      await prisma.rollMovement.deleteMany({ where: { rollId: { in: yaratilan } } }).catch(() => {});
      await prisma.rollOperation.deleteMany({ where: { rollId: { in: yaratilan } } }).catch(() => {});
      await prisma.rollVariance.deleteMany({ where: { rollId: { in: yaratilan } } }).catch(() => {});
      await prisma.systemLog.deleteMany({ where: { recordId: { in: yaratilan } } }).catch(() => {});
      await prisma.roll.deleteMany({ where: { id: { in: yaratilan } } }).catch(() => {});
    }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode = fail > 0 ? 1 : 0;
  }
}

main().catch((e) => {
  console.error("BEKLENMEYEN HATA:", e);
  process.exitCode = 1;
});
