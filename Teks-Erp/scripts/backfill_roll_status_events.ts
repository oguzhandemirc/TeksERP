// =============================================================================
// GEÇMİŞ DOLDURMA — top durum defterine (roll_status_events) eski iptaller (K-A3)
// =============================================================================
//   npx tsx scripts/backfill_roll_status_events.ts                                  → KURU ANLATIM (varsayılan)
//   npx tsx scripts/backfill_roll_status_events.ts --apply --onay=<N> --hedef=<db>  → gerçekten yazar
//   [--dokum=<yol>]  etkilenen HER topun CSV dökümü (varsayılan scripts/out/…csv; kuru koşumda da yazılır)
//
// NE: defter 20260925160000 migration'ıyla doğdu; ondan önceki iptallerin satırı yok ve
// operatör aktivitesi (çalışma oturumu dökümü) iptalleri artık yalnız bu defterden okur.
// Kaynak TOPUN KENDİ iptal kolonlarıdır (1e kararı 2026-09-25): status=CANCELLED ∧
// cancelledById ∧ cancelledAt dolu ve defterde CANCELLED satırı olmayan top → bir satır
// (fromStatus=preCancelStatus · actorId=cancelledById · createdAt=cancelledAt · preEpoch=true).
// Audit'ten DOLDURULMAZ — audit yalnız ayak izidir.
//
// ⚠️ BEYANLI KAYIP: iptali sonradan GERİ ALINMIŞ eski toplar (restoreCancelledRoll kolonları
// null'lar) ve cancelledById'si boş eski iptaller doldurulamaz; sayıları basılır.
//
// KAPI: `--apply` iki teyit ister — `--onay=<N>` (N = kuru koşumdaki satır sayısı, birebir)
// ve `--hedef=<db-adı>` (DATABASE_URL'den çözülen adla birebir). Biri tutmazsa yazma YOK.
// İdempotent: defterde CANCELLED satırı olan top atlanır; ikinci koşum 0 yazar.
// =============================================================================
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { AuditService } from "../src/services/audit.service";
import { hedefDbAdi } from "./lib/hedef-db-kapisi";

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const ONAY = Number((argv.find((a) => a.startsWith("--onay=")) ?? "").split("=")[1] ?? NaN);
const HEDEF = (argv.find((a) => a.startsWith("--hedef=")) ?? "").split("=")[1] ?? "";
const DOKUM = (argv.find((a) => a.startsWith("--dokum=")) ?? "").split("=")[1] ?? "";
const BATCH = 500;

function dbHost(): string {
  try { const u = new URL(process.env.DATABASE_URL ?? ""); return `${u.hostname}:${u.port || "5432"}`; } catch { return "(okunamadı)"; }
}
function dokumYolu(db: string): string {
  if (DOKUM) return resolve(DOKUM);
  const damga = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
  return resolve(__dirname, "out", `backfill_roll_status_events-${db}-${damga}.csv`);
}

interface Aday {
  id: string;
  barcode: string | null;
  preCancelStatus: RollStatus | null;
  cancelledById: string;
  cancelledAt: Date;
}

async function adaylar(): Promise<Aday[]> {
  return prisma.$queryRaw<Aday[]>`
    SELECT r.id, r.barcode, r."preCancelStatus", r."cancelledById", r."cancelledAt"
      FROM rolls r
     WHERE r.status = 'CANCELLED' AND r."cancelledById" IS NOT NULL AND r."cancelledAt" IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM roll_status_events e WHERE e."rollId" = r.id AND e."toStatus" = 'CANCELLED'
       )
     ORDER BY r."cancelledAt", r.id
  `;
}

async function main(): Promise<void> {
  const db = hedefDbAdi();
  console.log(`=== Top durum defteri — eski iptaller — ${APPLY ? `UYGULAMA (onay=${ONAY}, hedef=${HEDEF})` : "KURU ANLATIM"} ===`);
  console.log(`HEDEF VERİTABANI: ${db} @ ${dbHost()}\n`);

  const liste = await adaylar();
  const total = liste.length;
  const aktorsuz = await prisma.roll.count({ where: { status: RollStatus.CANCELLED, cancelledById: null } });

  console.log(`Doldurulacak iptal: ${total} top`);
  for (const r of liste) {
    console.log(`  ${r.barcode ?? r.id} · ${r.preCancelStatus ?? "?"} → CANCELLED · ${r.cancelledAt.toISOString()} · kullanıcı ${r.cancelledById}`);
  }
  console.log(`\nBEYANLI KAYIP: cancelledById'si boş ${aktorsuz} iptal edilmiş top doldurulmaz (aktör bilinmiyor);` +
    " iptali sonradan geri alınmış eski topların iptal anı kolonlarda yok, onlar da doldurulamaz.");

  const yol = dokumYolu(db);
  mkdirSync(dirname(yol), { recursive: true });
  writeFileSync(yol,
    ["rollId;barcode;fromStatus;cancelledAt;actorId", ...liste.map((r) =>
      [r.id, r.barcode ?? "", r.preCancelStatus ?? "", r.cancelledAt.toISOString(), r.cancelledById].join(";"))].join("\n") + "\n");
  console.log(`Döküm: ${yol}`);

  if (!APPLY) {
    console.log(`\nKURU ANLATIM — hiçbir şey yazılmadı. Uygulamak için (kullanıcı onayıyla, HEDEF adı birebir):\n  npx tsx scripts/backfill_roll_status_events.ts --apply --onay=${total} --hedef=${db}`);
    return;
  }
  if (!HEDEF || HEDEF !== db) { console.error(`❌ --hedef=${HEDEF || "(yok)"} ≠ çözülen veritabanı "${db}". Yazma YOK.`); process.exitCode = 1; return; }
  if (!Number.isFinite(ONAY) || ONAY !== total) { console.error(`❌ ONAY UYUŞMUYOR: kuru koşum ${total} top, --onay=${ONAY}. Yazma YOK.`); process.exitCode = 1; return; }

  let written = 0;
  for (let i = 0; i < liste.length; i += BATCH) {
    const dilim = liste.slice(i, i + BATCH);
    const res = await prisma.rollStatusEvent.createMany({
      data: dilim.map((r) => ({
        rollId: r.id,
        fromStatus: r.preCancelStatus,
        toStatus: RollStatus.CANCELLED,
        actorId: r.cancelledById,
        preEpoch: true,
        createdAt: r.cancelledAt,
      })),
    });
    written += res.count;
    console.log(`  ${written}/${total}`);
  }
  const kalan = (await adaylar()).length;
  console.log(`\n✅ ${written} satır yazıldı. Yeniden koşumda yazılacak: ${kalan} (beklenen 0).`);

  // İZ: bir kerelik göçün kendisi audit'e düşer (ayak izi; iş verisi defterde).
  const izOnce = AuditService.getHealth().failureCount;
  await AuditService.logEvent({
    category: "SYSTEM",
    action: "ROLL_STATUS_EVENTS_BACKFILL",
    tableName: "ROLL",
    payload: { source: "scripts/backfill_roll_status_events.ts", veritabani: db, yazilan: written, kuruKosumdakiToplam: total, aktorsuzAtlanan: aktorsuz, dokum: yol },
  });
  if (AuditService.getHealth().failureCount !== izOnce) {
    console.error(`\n⚠️  AUDIT SATIRI YAZILAMADI — dökümü (${yol}) ve bu çıktıyı göçün izi olarak saklayın.`);
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error("Beklenmeyen hata:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
