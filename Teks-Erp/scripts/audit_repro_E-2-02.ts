// =============================================================================
// AUDIT REPRO — E-2-02: "aynı clientToken, FARKLI gövde" sınır tablosu
// Ortam: SADECE dev DB. Prod/uzak hedefte çalışmayı REDDEDER.
// Beklenen (sağlıklı sistem): KK1'deki F117 kuralı (payload-özdeşlik) HER
//   idempotent uçta koşar → aynı token + farklı gövde 409 CLIENT_TOKEN_COLLISION.
// Gözlenen: log'a bak (audit/repro/E-2-02.log). Tambur depo kesimi ve çuval açma
//   yollarında özdeşlik kontrolü YOKSA ikinci (FARKLI) istek "başarılı" döner.
// Çalıştır: cd Teks-Erp && npx tsx scripts/audit_repro_E-2-02.ts
// =============================================================================
import "dotenv/config";
function devDbGuard(): void {
  const url = process.env.DATABASE_URL ?? "";
  if ((process.env.NODE_ENV ?? "") === "production" || (process.env.APP_ENV ?? "") === "production")
    throw new Error("REPRO: production ortamında koşturulamaz");
  let host = "";
  let db = "";
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase();
    db = decodeURIComponent(u.pathname.replace(/^\//, ""));
  } catch {
    throw new Error("REPRO: DATABASE_URL çözümlenemedi (fail-closed)");
  }
  if (!["localhost", "127.0.0.1", "::1"].includes(host))
    throw new Error(`REPRO: yerel olmayan host reddedildi: ${host}`);
  if (/saha|prod|canli|sahin/i.test(db) && db !== "adnansahin_db")
    throw new Error(`REPRO: prod kopyası/prod adı reddedildi: ${db}`);
}
devDbGuard();

import { randomUUID } from "node:crypto";
import prisma from "../src/lib/prisma";
import { TamburService } from "../src/services/tambur.service";
import { ShippingService } from "../src/services/shipping.service";

const STAMP = `AUDITREPRO-E-2-02-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const created = {
  rollIds: [] as string[],
  sackIds: [] as string[],
  itemId: null as string | null,
  customerIds: [] as string[],
};

async function main(): Promise<void> {
  // ── Fixture ────────────────────────────────────────────────────────────────
  const item = await prisma.item.create({
    data: { code: `${STAMP}-ITEM`, name: `${STAMP} KUMAS`, itemType: "FABRIC", unit: "MT" },
    select: { id: true },
  });
  created.itemId = item.id;

  const parent = await prisma.roll.create({
    data: {
      itemId: item.id,
      barcode: `T${STAMP.slice(-6)}`.slice(0, 12),
      initialQty: 100,
      currentQty: 100,
      status: "WAREHOUSE",
      entrySource: "MANUAL_ENTRY",
    },
    select: { id: true },
  });
  created.rollIds.push(parent.id);

  // ── §1 Tambur depo kesimi: aynı token, FARKLI cutLength ───────────────────
  const tambur = new TamburService();
  const token = randomUUID();
  const first = await tambur.cutWarehouseRoll(parent.id, { cutLength: 40, clientToken: token });
  const firstChildId = (first.data as { childRoll: { id: string } }).childRoll.id;
  created.rollIds.push(firstChildId);
  console.log(`   1. kesim: child=${firstChildId} (40 m)`);

  let secondOutcome = "";
  try {
    const second = await tambur.cutWarehouseRoll(parent.id, { cutLength: 25, clientToken: token });
    const d = second.data as { childRoll: { id: string; currentQty: unknown } };
    secondOutcome = `BAŞARILI döndü — childId=${d.childRoll.id} qty=${String(d.childRoll.currentQty)} msg="${second.message ?? ""}"`;
  } catch (e) {
    secondOutcome = `HATA: ${(e as { statusCode?: number }).statusCode ?? "?"} ${(e as Error).message}`;
  }
  console.log(`   2. kesim (25 m, AYNI token): ${secondOutcome}`);
  check(
    "Tambur depo kesimi: aynı token + FARKLI metraj REDDEDİLİYOR (409 çakışma)",
    secondOutcome.startsWith("HATA: 409"),
    secondOutcome,
  );

  // ── §2 Çuval aç: aynı token, FARKLI müşteri ───────────────────────────────
  const c1 = await prisma.customer.create({
    data: { code: `${STAMP}-C1`, name: `${STAMP} MUSTERI BIR` },
    select: { id: true, name: true },
  });
  const c2 = await prisma.customer.create({
    data: { code: `${STAMP}-C2`, name: `${STAMP} MUSTERI IKI` },
    select: { id: true, name: true },
  });
  created.customerIds.push(c1.id, c2.id);

  const shipping = new ShippingService();
  const sackToken = randomUUID();
  const s1 = await shipping.openSack({ customerId: c1.id, clientToken: sackToken });
  const s1d = s1.data as { id: string; customerId: string | null; customerName: string | null };
  created.sackIds.push(s1d.id);
  const s2 = await shipping.openSack({ customerId: c2.id, clientToken: sackToken });
  const s2d = s2.data as { id: string; customerId: string | null; customerName: string | null };
  if (s2d.id !== s1d.id) created.sackIds.push(s2d.id);
  console.log(`   1. açılış: sack=${s1d.id} müşteri=${s1d.customerName}`);
  console.log(`   2. açılış (FARKLI müşteri, AYNI token): sack=${s2d.id} müşteri=${s2d.customerName}`);
  check(
    "Çuval açma: aynı token + FARKLI müşteri REDDEDİLİYOR ya da doğru müşteriyi döndürüyor",
    s2d.customerId === c2.id,
    `dönen müşteri=${s2d.customerName ?? "-"} (istenen: ${c2.name})`,
  );
}

async function cleanup(): Promise<void> {
  try {
    await prisma.rollVariance.deleteMany({ where: { rollId: { in: created.rollIds } } });
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: created.rollIds } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: created.rollIds } } });
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: created.rollIds } } });
    await prisma.roll.deleteMany({ where: { parentRollId: { in: created.rollIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: created.rollIds } } });
    await prisma.sack.deleteMany({ where: { id: { in: created.sackIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: created.customerIds } } });
    if (created.itemId) await prisma.item.deleteMany({ where: { id: created.itemId } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...created.rollIds, ...created.sackIds] } } });
  } catch (e) {
    console.log("⚠️ temizlik kısmi:", (e as Error).message);
  }
}

main()
  .catch((e) => {
    console.error("HATA:", e instanceof Error ? e.message : String(e));
    fail++;
  })
  .finally(async () => {
    await cleanup();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız (damga ${STAMP}) ===`);
    await prisma.$disconnect();
    process.exitCode = fail > 0 ? 1 : 0;
  });
