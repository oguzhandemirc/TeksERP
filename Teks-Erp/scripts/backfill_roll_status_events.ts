// =============================================================================
// GEÇMİŞ DOLDURMA — top durum defterine (roll_status_events) eski iptaller (K-A3)
// =============================================================================
//   npx tsx scripts/backfill_roll_status_events.ts                                  → KURU ANLATIM (varsayılan)
//   npx tsx scripts/backfill_roll_status_events.ts --apply --onay=<N> --hedef=<db>  → gerçekten yazar
//   [--dokum=<yol>]  etkilenen HER topun CSV dökümü (varsayılan scripts/out/…csv; kuru koşumda da yazılır)
//
// NE: defter 20260925160000 migration'ıyla doğdu; ondan önceki iptallerin satırı yok ve
// operatör aktivitesi (çalışma oturumu dökümü) iptalleri artık yalnız bu defterden okur.
// Defterde CANCELLED satırı olmayan her CANCELLED top için İKİ GEÇİŞ (preEpoch=true):
//   ① ROLL_COLUMNS — topun kendi iptal kolonları (cancelledById ∧ cancelledAt dolu):
//      fromStatus=preCancelStatus · actorId=cancelledById · createdAt=cancelledAt.
//   ② AUDIT (K-A3b, 1e kararı 2026-09-25) — kolonda aktör YOKSA system_logs ∪
//      system_log_archives'ta `ROLL · newData.status=CANCELLED · userId dolu` satırlarının EN
//      SONUNCUSU (iptal → geri alma → yeniden iptalde güncel iptal): actorId=userId ·
//      createdAt=o anı · fromStatus=preCancelStatus ?? oldData.status. Eski dökümün yüklemiyle
//      AYNI; kuralın beyanlı "bir kez aktaran göç" istisnası (lib/audit-okuma-beyan.ts).
//   ③ AUDIT ebeveyn (B-RM, 1e kararı 2026-09-25) — tambur geri alma parçayı iptal ederken aktörü
//      ne kolona ne parçanın audit'ine yazıyordu; iz EBEVEYNİN `TAMBUR_UNDO_*` satırında
//      (`cancelledChildId`/`cancelledChildIds` + userId, sıcak ∪ arşiv): actorId=userId ·
//      createdAt=o anı · fromStatus=preCancelStatus. ①/②'nin bulamadığı toplar için.
//      Defter sütunu `preEpochSource=AUDIT` (kaynak audit); dökümde `AUDIT_EBEVEYN` diye ayrışır.
//      ③ K-A2'den bağımsızdır: topun satırına (cancelReasonCode dahil) yazmaz, yalnız deftere ekler.
//
// ⚠️ BEYANLI KAYIP: iki geçişte de kaynağı bulunamayan iptal (aktör hiçbir yerde yok) ve
// iptali sonradan GERİ ALINMIŞ eski toplar doldurulamaz; sayıları basılır.
//
// KAPI: `--apply` iki teyit ister — `--onay=<N>` (N = kuru koşumdaki ①+②+③ toplamı, birebir)
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

type Kaynak = "ROLL_COLUMNS" | "AUDIT" | "AUDIT_EBEVEYN";
interface Aday {
  id: string;
  barcode: string | null;
  fromStatus: RollStatus | null;
  actorId: string;
  at: Date;
  kaynak: Kaynak;
}

const ROLL_STATUSES = new Set<string>(Object.values(RollStatus));
const statusOf = (v: string | null): RollStatus | null => (v && ROLL_STATUSES.has(v) ? (v as RollStatus) : null);

/** ① Topun kendi iptal kolonları. */
async function kolonAdaylari(): Promise<Aday[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string; barcode: string | null; preCancelStatus: string | null; cancelledById: string; cancelledAt: Date }>>`
    SELECT r.id, r.barcode, r."preCancelStatus"::text AS "preCancelStatus", r."cancelledById", r."cancelledAt"
      FROM rolls r
     WHERE r.status = 'CANCELLED' AND r."cancelledById" IS NOT NULL AND r."cancelledAt" IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM roll_status_events e WHERE e."rollId" = r.id AND e."toStatus" = 'CANCELLED')
     ORDER BY r."cancelledAt", r.id
  `;
  return rows.map((r) => ({ id: r.id, barcode: r.barcode, fromStatus: statusOf(r.preCancelStatus), actorId: r.cancelledById, at: r.cancelledAt, kaynak: "ROLL_COLUMNS" }));
}

/** ② Kolonda aktör yok → audit'in (sıcak ∪ arşiv) SON CANCELLED satırı. */
async function auditAdaylari(): Promise<Aday[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string; barcode: string | null; preCancelStatus: string | null; userId: string; createdAt: Date; oldStatus: string | null }>>`
    SELECT r.id, r.barcode, r."preCancelStatus"::text AS "preCancelStatus", a."userId", a."createdAt", a."oldStatus"
      FROM rolls r
      CROSS JOIN LATERAL (
        SELECT u."userId", u."createdAt", u."oldStatus" FROM (
          SELECT l."userId", l."createdAt", l."oldData" ->> 'status' AS "oldStatus"
            FROM system_logs l
           WHERE l."tableName" = 'ROLL' AND l."recordId" = r.id::text
             AND l."newData" ->> 'status' = 'CANCELLED' AND l."userId" IS NOT NULL
          UNION ALL
          SELECT l."userId", l."createdAt", l."oldData" ->> 'status'
            FROM system_log_archives l
           WHERE l."tableName" = 'ROLL' AND l."recordId" = r.id::text
             AND l."newData" ->> 'status' = 'CANCELLED' AND l."userId" IS NOT NULL
        ) u
        ORDER BY u."createdAt" DESC
        LIMIT 1
      ) a
     WHERE r.status = 'CANCELLED' AND r."cancelledById" IS NULL
       AND NOT EXISTS (SELECT 1 FROM roll_status_events e WHERE e."rollId" = r.id AND e."toStatus" = 'CANCELLED')
     ORDER BY a."createdAt", r.id
  `;
  return rows.map((r) => ({
    id: r.id, barcode: r.barcode, fromStatus: statusOf(r.preCancelStatus) ?? statusOf(r.oldStatus),
    actorId: r.userId, at: r.createdAt, kaynak: "AUDIT",
  }));
}

/** ③ Tambur geri alma parçası: ebeveynin `TAMBUR_UNDO_*` audit satırı (sıcak ∪ arşiv), EN SONUNCUSU. */
async function ebeveynAuditAdaylari(haric: Set<string>): Promise<Aday[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string; barcode: string | null; preCancelStatus: string | null; userId: string; createdAt: Date }>>`
    SELECT r.id, r.barcode, r."preCancelStatus"::text AS "preCancelStatus", a."userId", a."createdAt"
      FROM rolls r
      CROSS JOIN LATERAL (
        SELECT u."userId", u."createdAt" FROM (
          SELECT l."userId", l."createdAt", l."newData"
            FROM system_logs l
           WHERE l."tableName" = 'ROLL' AND l."recordId" = r."parentRollId"::text AND l."userId" IS NOT NULL
          UNION ALL
          SELECT l."userId", l."createdAt", l."newData"
            FROM system_log_archives l
           WHERE l."tableName" = 'ROLL' AND l."recordId" = r."parentRollId"::text AND l."userId" IS NOT NULL
        ) u
        WHERE starts_with(u."newData" ->> 'event', 'TAMBUR_UNDO')
          AND ((u."newData" ->> 'cancelledChildId') = r.id::text OR (u."newData" -> 'cancelledChildIds') @> to_jsonb(r.id::text))
        ORDER BY u."createdAt" DESC
        LIMIT 1
      ) a
     WHERE r.status = 'CANCELLED' AND r."cancelledById" IS NULL AND r."parentRollId" IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM roll_status_events e WHERE e."rollId" = r.id AND e."toStatus" = 'CANCELLED')
     ORDER BY a."createdAt", r.id
  `;
  return rows.filter((r) => !haric.has(r.id)).map((r) => ({
    id: r.id, barcode: r.barcode, fromStatus: statusOf(r.preCancelStatus),
    actorId: r.userId, at: r.createdAt, kaynak: "AUDIT_EBEVEYN",
  }));
}

async function main(): Promise<void> {
  const db = hedefDbAdi();
  console.log(`=== Top durum defteri — eski iptaller — ${APPLY ? `UYGULAMA (onay=${ONAY}, hedef=${HEDEF})` : "KURU ANLATIM"} ===`);
  console.log(`HEDEF VERİTABANI: ${db} @ ${dbHost()}\n`);

  const kolon = await kolonAdaylari();
  const audit = await auditAdaylari();
  const ebeveyn = await ebeveynAuditAdaylari(new Set([...kolon, ...audit].map((r) => r.id)));
  const liste = [...kolon, ...audit, ...ebeveyn];
  const total = liste.length;
  const dokunulmayan = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*) AS n FROM rolls r
     WHERE r.status = 'CANCELLED'
       AND NOT EXISTS (SELECT 1 FROM roll_status_events e WHERE e."rollId" = r.id AND e."toStatus" = 'CANCELLED')`;
  const kaynaksiz = Number(dokunulmayan[0]?.n ?? 0) - total;

  for (const [baslik, grup] of [
    ["① topun iptal kolonlarından (ROLL_COLUMNS)", kolon],
    ["② audit'in son CANCELLED satırından (AUDIT)", audit],
    ["③ ebeveynin TAMBUR_UNDO_* audit satırından (AUDIT_EBEVEYN)", ebeveyn],
  ] as const) {
    console.log(`${baslik}: ${grup.length} top`);
    for (const r of grup) {
      console.log(`  ${r.barcode ?? r.id} · ${r.fromStatus ?? "?"} → CANCELLED · ${r.at.toISOString()} · kullanıcı ${r.actorId}`);
    }
  }
  console.log(`Doldurulacak iptal: ${total} top (① ${kolon.length} + ② ${audit.length} + ③ ${ebeveyn.length})`);
  console.log(`\nBEYANLI KAYIP: kaynağı bulunamayan ${kaynaksiz} iptal edilmiş top doldurulmaz (aktör ne kolonda ne audit'te);` +
    " iptali sonradan geri alınmış eski toplar da doldurulamaz.");

  const yol = dokumYolu(db);
  mkdirSync(dirname(yol), { recursive: true });
  writeFileSync(yol,
    ["rollId;barcode;fromStatus;cancelledAt;actorId;kaynak", ...liste.map((r) =>
      [r.id, r.barcode ?? "", r.fromStatus ?? "", r.at.toISOString(), r.actorId, r.kaynak].join(";"))].join("\n") + "\n");
  console.log(`Döküm: ${yol}`);

  if (!APPLY) {
    console.log(`\nKURU ANLATIM — hiçbir şey yazılmadı. Uygulamak için (kullanıcı onayıyla, HEDEF adı birebir; onay = ① + ② + ③):\n  npx tsx scripts/backfill_roll_status_events.ts --apply --onay=${total} --hedef=${db}`);
    return;
  }
  if (!HEDEF || HEDEF !== db) { console.error(`❌ --hedef=${HEDEF || "(yok)"} ≠ çözülen veritabanı "${db}". Yazma YOK.`); process.exitCode = 1; return; }
  if (!Number.isFinite(ONAY) || ONAY !== total) { console.error(`❌ ONAY UYUŞMUYOR: kuru koşum ${total} top (① ${kolon.length} + ② ${audit.length} + ③ ${ebeveyn.length}), --onay=${ONAY}. Yazma YOK.`); process.exitCode = 1; return; }

  let written = 0;
  for (let i = 0; i < liste.length; i += BATCH) {
    const dilim = liste.slice(i, i + BATCH);
    const res = await prisma.rollStatusEvent.createMany({
      data: dilim.map((r) => ({
        rollId: r.id,
        fromStatus: r.fromStatus,
        toStatus: RollStatus.CANCELLED,
        actorId: r.actorId,
        preEpoch: true,
        preEpochSource: r.kaynak === "ROLL_COLUMNS" ? "ROLL_COLUMNS" : "AUDIT",
        createdAt: r.at,
      })),
    });
    written += res.count;
    console.log(`  ${written}/${total}`);
  }
  const kalanKolon = await kolonAdaylari();
  const kalanAudit = await auditAdaylari();
  const kalan = kalanKolon.length + kalanAudit.length
    + (await ebeveynAuditAdaylari(new Set([...kalanKolon, ...kalanAudit].map((r) => r.id)))).length;
  console.log(`\n✅ ${written} satır yazıldı (① ${kolon.length} + ② ${audit.length} + ③ ${ebeveyn.length}). Yeniden koşumda yazılacak: ${kalan} (beklenen 0).`);

  // İZ: bir kerelik göçün kendisi audit'e düşer (ayak izi; iş verisi defterde).
  const izOnce = AuditService.getHealth().failureCount;
  await AuditService.logEvent({
    category: "SYSTEM",
    action: "ROLL_STATUS_EVENTS_BACKFILL",
    tableName: "ROLL",
    payload: { source: "scripts/backfill_roll_status_events.ts", veritabani: db, yazilan: written, kolondan: kolon.length, auditten: audit.length, ebeveynAuditten: ebeveyn.length, kaynaksizAtlanan: kaynaksiz, dokum: yol },
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
