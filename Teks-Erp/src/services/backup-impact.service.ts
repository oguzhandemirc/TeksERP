// =============================================================================
// "Bu yedeğe dönersem ne kaybederim?" — geri yükleme etki önizlemesi
// =============================================================================
// Kök CLAUDE.md: "Yıkıcı işlemlerde detaylı onay zorunlu … backend preview
// endpoint döner … 'X kayıt etkilenecek' gibi soyut sayı yetmez." Geri yükleme
// sistemdeki EN yıkıcı işlem ve bu kuralı uygulamayan tek yerdi.
//
// `backup.service.ts`'ten AYRI dosya: o modül bilinçli olarak prisma import
// etmiyor (yalnız fs/child_process) — dump/restore zinciri DB havuzundan bağımsız
// kalmalı. Bağımlılık yönü tek: impact → backup, tersi YOK.
//
// ⚠ SAYIMLAR YALNIZ INSERT'LERİ YAKALAR. Top statüsü değişimi, çuval tartısı,
// sipariş onayı, sevk ataması — hepsi UPDATE'tir ve bu tabloda GÖRÜNMEZ. Bu
// yüzden ikinci bir panel olarak audit rollup veriyoruz (`SystemLog` DOMAIN
// kayıtları UPDATE'i de içerir). Sayıları "en az" dilinde sunmak ZORUNLU.
// =============================================================================

import path from "path";
import {
  OrderStatus,
  RollStatus,
  ShipmentStatus,
  WorkOrderStatus,
} from "@prisma/client";
import prisma from "../lib/prisma";
import {
  isBackupRunning,
  listBackups,
  resolveBackupPath,
  verifyBackupFile,
  type BackupRestoreTarget,
  type BackupVerifyResult,
} from "./backup.service";
import { resolveBackupCutoff, safetyBackupName } from "./helpers/backup-naming.helper";

// =============================================================================
// Tipler
// =============================================================================

export type ImpactGroupKey = "production" | "orders" | "subcontract" | "system";

export interface ImpactRow {
  key: string;
  label: string;
  /** `null` = ÖLÇÜLEMEDİ (timeout/hata). Sıfır ile karıştırılmamalı. */
  count: number | null;
  /** Hangi zaman damgası kolonuyla sayıldı — şeffaflık için. */
  timestampField: string;
  note?: string;
}

export interface ImpactGroup {
  key: ImpactGroupKey;
  label: string;
  rows: ImpactRow[];
}

export interface AuditRollup {
  /** Audit kapsamı cutoff'a uzanıyor mu. false ise sayılar ALT SINIR bile değil. */
  available: boolean;
  oldestLogAt: string | null;
  created: number;
  updated: number;
  deleted: number;
  byTable: Array<{ tableName: string; created: number; updated: number; deleted: number; total: number }>;
}

export interface RestoreImpact {
  /** `absPath` BACKEND'in `path.join`'iyle üretilir — istemci ayırıcı tahmin
   *  etmesin. Sabit `\` ile birleştirmek POSIX sunucuda bozuk yol üretiyordu. */
  file: { name: string; sizeBytes: number; time: string; absPath: string };
  cutoff: { at: string; source: "name" | "mtime" };
  isNewest: boolean;
  newerBackup: { name: string; time: string } | null;
  canRestore: boolean;
  blockReasons: string[];
  warnings: string[];
  restoreTarget: BackupRestoreTarget | null;
  verify: BackupVerifyResult;
  safetyBackup: { fileName: string; absPath: string } | null;
  /** Backend çalışma dizini — komut bloğundaki `prisma migrate deploy` oradan koşar.
   *  İstemci sunucunun cwd'sini bilemez; bu yüzden backend bildirir. */
  backendCwd: string;
  /** pm2 süreç adı — `pm2 stop/start` satırları için. */
  pm2AppName: string;
  audit: AuditRollup;
  groups: ImpactGroup[];
  totalCreated: number;
  /** Bir satır bile ölçülemediyse false → toplam "en az" dilinde sunulmalı. */
  measuredAllRows: boolean;
  computedAt: string;
  durationMs: number;
}

// =============================================================================
// Guard'lar — SAF fonksiyon
// =============================================================================
// Saf tutulması load-bearing: `running=true` dalını gerçek `runBackupJob` ile
// yarıştırarak test etmek flaky olurdu.

export interface RestoreGuardInput {
  backupDirConfigured: boolean;
  running: boolean;
  restoreTarget: BackupRestoreTarget | null;
  verify: BackupVerifyResult;
  isNewest: boolean;
  newerBackupName: string | null;
}

export function restoreGuards(input: RestoreGuardInput): {
  canRestore: boolean;
  blockReasons: string[];
  warnings: string[];
} {
  const blockReasons: string[] = [];
  const warnings: string[] = [];

  if (!input.backupDirConfigured) {
    blockReasons.push("Yedekleme yapılandırılmamış (BACKUP_DIR tanımsız).");
  }
  if (input.running) {
    blockReasons.push(
      "Şu anda yedek alınıyor. pg_dump ile pg_restore çakışır ve yarım bir dosya geri yüklenebilir — yedek bitene kadar bekleyin.",
    );
  }
  if (!input.restoreTarget) {
    blockReasons.push("DATABASE_URL çözümlenemedi — geri yükleme komutu kurulamaz.");
  }
  if (input.verify === "corrupt") {
    blockReasons.push(
      "Bu yedek dosyası okunamıyor (pg_restore --list başarısız). Geri yüklenirse veritabanı yarım kalır.",
    );
  }
  if (input.verify === "unknown") {
    warnings.push(
      "Yedeğin bütünlüğü DOĞRULANAMADI (dosya çok büyük olabilir ya da pg_restore bulunamadı). Geri yükleme engellenmedi, ama dosyanın sağlamlığı garanti değil.",
    );
  }
  if (!input.isNewest && input.newerBackupName) {
    warnings.push(
      `Bu en yeni yedek DEĞİL — daha yeni bir yedek var: ${input.newerBackupName}. Daha az veri kaybetmek için onu seçmek isteyebilirsiniz.`,
    );
  }

  return { canRestore: blockReasons.length === 0, blockReasons, warnings };
}

// =============================================================================
// Sayım tanımları
// =============================================================================
// Her satır kendi DOMAIN zaman damgasını kullanır — `createdAt` her modelde
// indexli DEĞİL (bkz. schema.prisma @@index tanımları).
//
// **enum-IN hilesi:** `Roll`/`Order`/`WorkOrder`/`Shipment`'ta düz `createdAt`
// index'i yok, yalnız composite `[status, createdAt]` var. PG'de skip-scan
// olmadığı için öncü kolon sabitlenmeden bu index üzerinde seek yapılamaz.
// `status: { in: Object.values(Enum) }` → `status = ANY(...)` → enum değeri başına
// bir index descent. `Object.values()` KULLAN, elle liste YAZMA: yeni bir enum
// değeri eklendiğinde sayım sessizce eksilmesin.
//
// ÖLÇÜM (dev, rolls = 13.876 satır, EXPLAIN ANALYZE):
//   düz  `createdAt >= X`                  → Index Only Scan (entrySource_createdAt), 1.68ms
//   enum-IN `status = ANY(...) AND ...`    → Index Only Scan (status_createdAt),      0.94ms
// Yani bu ölçekte hiçbir biçimde SEQ SCAN yok — PG, `count(*)` için createdAt'i
// kapsayan herhangi bir composite index'i tam tarasa bile heap'e gitmiyor. Hile
// yine de hedeflenen index'i kullandırıyor ve daha az satır okuyor; üretim ölçeği
// (500k+) dev'de temsil EDİLMİYOR, bu yüzden hile korunuyor. Kaldırmak isteyen
// önce üretim boyutunda EXPLAIN koşsun.
//
// ⚠ Bu sayımlar tek bir `$queryRaw UNION ALL`'a "sadeleştirilmemeli":
// `SwatchStockReduction.createdAt` şemadaki tek `@db.Timestamptz` kolonu ve pg
// adapter offset'siz UTC literal yazıyor → ham SQL orada 3 saat kayar. Tipli
// `count()` kolon tipini bilir. Ayrıca UNION ALL tek statement olduğu için
// statement_timeout=50s tek daldan TÜM önizlemeyi öldürür.

interface CountSpec {
  key: string;
  label: string;
  group: ImpactGroupKey;
  timestampField: string;
  note?: string;
  run: (cutoff: Date) => Promise<number>;
}

const COUNT_SPECS: CountSpec[] = [
  // --- Üretim
  {
    key: "roll",
    label: "Yeni top / kumaş kaydı",
    group: "production",
    timestampField: "createdAt",
    run: (c) =>
      prisma.roll.count({
        where: { status: { in: Object.values(RollStatus) }, createdAt: { gte: c } },
      }),
  },
  {
    key: "rollOperation",
    label: "Top işlemi (KK1/KK2/kurşun/tambur)",
    group: "production",
    timestampField: "createdAt",
    run: (c) => prisma.rollOperation.count({ where: { createdAt: { gte: c } } }),
  },
  {
    key: "rollMovement",
    label: "İstasyon giriş/çıkış hareketi",
    group: "production",
    timestampField: "enteredAt",
    run: (c) => prisma.rollMovement.count({ where: { enteredAt: { gte: c } } }),
  },
  {
    key: "rollError",
    label: "Tespit edilen hata",
    group: "production",
    timestampField: "detectedAt",
    run: (c) => prisma.rollError.count({ where: { detectedAt: { gte: c } } }),
  },
  {
    key: "workOrder",
    label: "Yeni iş emri",
    group: "production",
    timestampField: "createdAt",
    run: (c) =>
      prisma.workOrder.count({
        where: { status: { in: Object.values(WorkOrderStatus) }, createdAt: { gte: c } },
      }),
  },

  // --- Sipariş / Sevk
  {
    key: "order",
    label: "Yeni sipariş",
    group: "orders",
    timestampField: "createdAt",
    run: (c) =>
      prisma.order.count({
        where: { status: { in: Object.values(OrderStatus) }, createdAt: { gte: c } },
      }),
  },
  {
    key: "orderLine",
    label: "Sipariş satırı",
    group: "orders",
    timestampField: "createdAt",
    run: (c) => prisma.orderLine.count({ where: { createdAt: { gte: c } } }),
  },
  {
    key: "shipment",
    label: "Sevkiyat",
    group: "orders",
    timestampField: "createdAt",
    run: (c) =>
      prisma.shipment.count({
        where: { status: { in: Object.values(ShipmentStatus) }, createdAt: { gte: c } },
      }),
  },
  {
    key: "sack",
    label: "Çuval",
    group: "orders",
    timestampField: "createdAt",
    run: (c) => prisma.sack.count({ where: { createdAt: { gte: c } } }),
  },
  {
    key: "rollReturn",
    label: "Müşteri iadesi",
    group: "orders",
    timestampField: "createdAt",
    run: (c) => prisma.rollReturn.count({ where: { createdAt: { gte: c } } }),
  },

  // --- Fason / Kartela
  {
    key: "subDispatch",
    label: "Fason sevki",
    group: "subcontract",
    timestampField: "dispatchedAt",
    run: (c) => prisma.subcontractorDispatch.count({ where: { dispatchedAt: { gte: c } } }),
  },
  {
    key: "subReceipt",
    label: "Fason kabulü",
    group: "subcontract",
    timestampField: "receivedAt",
    run: (c) => prisma.subcontractorReceipt.count({ where: { receivedAt: { gte: c } } }),
  },
  {
    key: "directShipment",
    label: "Fasondan doğrudan sevk",
    group: "subcontract",
    timestampField: "shippedAt",
    run: (c) => prisma.directShipment.count({ where: { shippedAt: { gte: c } } }),
  },
  {
    key: "kartelaDispatch",
    label: "Kartela sevki",
    group: "subcontract",
    timestampField: "dispatchedAt",
    run: (c) => prisma.kartelaDispatch.count({ where: { dispatchedAt: { gte: c } } }),
  },
  {
    key: "kartelaReceipt",
    label: "Kartela kabulü",
    group: "subcontract",
    timestampField: "receivedAt",
    run: (c) => prisma.kartelaReceipt.count({ where: { receivedAt: { gte: c } } }),
  },
  {
    key: "swatch",
    label: "Yeni kartela",
    group: "subcontract",
    timestampField: "createdAt",
    note: "İptal edilmemiş kartelalar",
    // `cancelledAt: null` ZORUNLU — bu modelin createdAt index'i DB'de PARTIAL
    // (`WHERE cancelledAt IS NULL`); koşul düşerse index kullanılmaz → seq scan.
    run: (c) => prisma.swatch.count({ where: { cancelledAt: null, createdAt: { gte: c } } }),
  },

  // --- Sistem (iş kaybı DEĞİL, ayrı grup)
  {
    key: "systemLog",
    label: "Denetim (audit) kaydı",
    group: "system",
    timestampField: "createdAt",
    note: "İş kaybı değil — iz kaydı",
    run: (c) => prisma.systemLog.count({ where: { createdAt: { gte: c } } }),
  },
  {
    key: "session",
    label: "Açılmış oturum",
    group: "system",
    timestampField: "createdAt",
    note: "Geri yükleme sonrası kullanıcılar yeniden giriş yapar",
    run: (c) => prisma.session.count({ where: { createdAt: { gte: c } } }),
  },
];

const GROUP_LABELS: Record<ImpactGroupKey, string> = {
  production: "Üretim",
  orders: "Sipariş & Sevkiyat",
  subcontract: "Fason & Kartela",
  system: "Sistem kayıtları",
};

// =============================================================================
// Sınırlı eşzamanlılık — pool max:30 ve canlı vardiya
// =============================================================================
// 18 sayımı aynı anda salmak vardiya saatinde I/O sıçraması yapar ve havuzun
// yarısını tutar. `allSettled` semantiği: bir satırın hatası (örn. 50sn
// statement_timeout) diğerlerini DÜŞÜRMEZ — o satır `null` ("ölçülemedi") olur.

const MAX_CONCURRENCY = 6;

async function countAll(cutoff: Date): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = cursor++;
      if (i >= COUNT_SPECS.length) return;
      const spec = COUNT_SPECS[i]!;
      try {
        out.set(spec.key, await spec.run(cutoff));
      } catch (err) {
        console.error(`[backup-impact] ${spec.key} sayılamadı:`, err);
        out.set(spec.key, null);
      }
    }
  };
  await Promise.all(Array.from({ length: MAX_CONCURRENCY }, () => worker()));
  return out;
}

// =============================================================================
// Audit rollup — UPDATE'leri de kapsayan tek kaynak
// =============================================================================
// Gerçek aggregation olduğu için $queryRaw haklı (CLAUDE.md #8) ve `SystemLog`
// `[category, createdAt]` index'i sürüyor. `SystemLog.createdAt` düz `timestamp`
// (Timestamptz DEĞİL) → adapter'ın offset'siz UTC literal'i burada doğru.

interface RawRollupRow {
  action: string;
  tableName: string;
  cnt: bigint;
}

async function auditRollup(cutoff: Date): Promise<AuditRollup> {
  const empty: AuditRollup = {
    available: false,
    oldestLogAt: null,
    created: 0,
    updated: 0,
    deleted: 0,
    byTable: [],
  };

  let oldest: Date | null = null;
  try {
    const agg = await prisma.systemLog.aggregate({ _min: { createdAt: true } });
    oldest = agg._min.createdAt ?? null;
  } catch (err) {
    console.error("[backup-impact] audit kapsamı okunamadı:", err);
    return empty;
  }

  // Kapsam kontrolü: archive-scheduler 6 aydan eski log'ları SystemLogArchive'a
  // taşıyor. En eski log cutoff'tan SONRA ise rollup alt sınır bile değildir →
  // available=false. Bu durumda UI "ölçülemedi" yazmalı, ASLA 0 göstermemeli:
  // "0 değişiklik" ile "ölçemedik" arasındaki fark, operatörün yıkıcı bir kararı
  // verirken güvendiği tek şey.
  if (!oldest || oldest.getTime() > cutoff.getTime()) {
    return { ...empty, oldestLogAt: oldest ? oldest.toISOString() : null };
  }

  try {
    const rows = await prisma.$queryRaw<RawRollupRow[]>`
      SELECT "action", "tableName", COUNT(*)::bigint AS cnt
      FROM system_logs
      WHERE "category" = 'DOMAIN' AND "createdAt" >= ${cutoff}
      GROUP BY "action", "tableName"
    `;
    const byTable = new Map<string, { created: number; updated: number; deleted: number }>();
    let created = 0;
    let updated = 0;
    let deleted = 0;
    for (const r of rows) {
      const n = Number(r.cnt); // BigInt → JSON.stringify BigInt'i serialize EDEMEZ
      const slot = byTable.get(r.tableName) ?? { created: 0, updated: 0, deleted: 0 };
      if (r.action === "CREATE") {
        slot.created += n;
        created += n;
      } else if (r.action === "UPDATE") {
        slot.updated += n;
        updated += n;
      } else if (r.action === "DELETE") {
        slot.deleted += n;
        deleted += n;
      }
      byTable.set(r.tableName, slot);
    }
    const list = [...byTable.entries()]
      .map(([tableName, v]) => ({ tableName, ...v, total: v.created + v.updated + v.deleted }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 12);
    return {
      available: true,
      oldestLogAt: oldest.toISOString(),
      created,
      updated,
      deleted,
      byTable: list,
    };
  } catch (err) {
    console.error("[backup-impact] audit rollup başarısız:", err);
    return { ...empty, oldestLogAt: oldest.toISOString() };
  }
}

// =============================================================================
// Ana giriş
// =============================================================================
// Modül-içi `computing` bayrağı: sabırsız admin'in üst üste tıklaması 18 sayımı
// yığmasın (runBackupJob'daki `running` kalıbının aynısı).

let computing = false;

/** Dosya bulunamazsa `null` → rota katmanı 404 döndürür. */
export async function getRestoreImpact(name: string): Promise<RestoreImpact | null> {
  const startedMs = Date.now();
  // Yolu YENİDEN çöz — istemcinin verdiği ada güvenme. Liste ile dialog açılışı
  // arasında dosya rotasyona girmiş/silinmiş olabilir.
  const abs = resolveBackupPath(name);
  if (!abs) return null;

  const listing = await listBackups();
  const entry = listing.files.find((f) => f.name === name);
  if (!entry) return null;

  const cutoff = resolveBackupCutoff(name, new Date(entry.time).getTime());

  // En yeni yedek mi? (liste en yeni önce sıralı)
  //
  // `pre-restore_` dosyaları KARŞILAŞTIRMAYA GİRMEZ: onlar bir geri yükleme
  // ÖNCESİNDEKİ — yani terk edilmek üzere olan — durumun anlık görüntüsüdür.
  // Operatöre "daha yeni bir yedek var: pre-restore_..." demek yanıltıcıdır; o
  // dosya daha iyi bir dönüş noktası değil, kaçılan durumun kopyasıdır. (Canlı
  // testte fark edildi: taze bir pre-restore dosyası mtime'a göre listenin
  // başında oturup "en yeni yedek" gibi önerilmişti.)
  // `premigrate_` ve elle getirilen dosyalar meşru dönüş noktalarıdır → dahil.
  const comparable = listing.files.filter((f) => f.kind !== "pre-restore");
  const newest = comparable[0];
  const isNewest = !newest || newest.name === name;
  const newerBackup = isNewest ? null : { name: newest!.name, time: newest!.time };

  const verify = await verifyBackupFile(abs);

  const guards = restoreGuards({
    backupDirConfigured: listing.backupDir !== null,
    running: isBackupRunning(),
    restoreTarget: listing.restoreTarget,
    verify,
    isNewest,
    newerBackupName: newerBackup?.name ?? null,
  });

  const warnings = [...guards.warnings];
  if (cutoff.source === "mtime") {
    warnings.push(
      "Kesim anı dosya adından çözülemedi; dosyanın değişiklik zamanı kullanıldı. Gerçek kesim anı yedeğin SÜRESİ kadar daha erken olabilir — aşağıdaki sayılar eksik kalabilir.",
    );
  }

  let counts = new Map<string, number | null>();
  if (computing) {
    warnings.push("Başka bir etki hesabı sürüyor — sayımlar atlandı, yeniden deneyin.");
    for (const s of COUNT_SPECS) counts.set(s.key, null);
  } else {
    computing = true;
    try {
      counts = await countAll(cutoff.at);
    } finally {
      computing = false;
    }
  }

  const audit = await auditRollup(cutoff.at);

  const groups: ImpactGroup[] = (
    ["production", "orders", "subcontract", "system"] as ImpactGroupKey[]
  ).map((key) => ({
    key,
    label: GROUP_LABELS[key],
    rows: COUNT_SPECS.filter((s) => s.group === key).map((s) => ({
      key: s.key,
      label: s.label,
      count: counts.get(s.key) ?? null,
      timestampField: s.timestampField,
      ...(s.note ? { note: s.note } : {}),
    })),
  }));

  // Toplam yalnız İŞ KAYBI gruplarından — sistem kayıtları (audit/oturum) iş
  // kaybı değil, toplamı şişirip operatörü yanıltmasın.
  const businessRows = groups.filter((g) => g.key !== "system").flatMap((g) => g.rows);
  const totalCreated = businessRows.reduce((acc, r) => acc + (r.count ?? 0), 0);
  const measuredAllRows = businessRows.every((r) => r.count !== null);

  const safetyBackup = listing.backupDir
    ? (() => {
        const fileName = safetyBackupName(new Date());
        return { fileName, absPath: path.join(listing.backupDir!, fileName) };
      })()
    : null;

  return {
    file: { name: entry.name, sizeBytes: entry.sizeBytes, time: entry.time, absPath: abs },
    cutoff: { at: cutoff.at.toISOString(), source: cutoff.source },
    isNewest,
    newerBackup,
    canRestore: guards.canRestore,
    blockReasons: guards.blockReasons,
    warnings,
    restoreTarget: listing.restoreTarget,
    verify,
    safetyBackup,
    backendCwd: process.cwd(),
    pm2AppName: listing.pm2AppName,
    audit,
    groups,
    totalCreated,
    measuredAllRows,
    computedAt: new Date().toISOString(),
    durationMs: Date.now() - startedMs,
  };
}
