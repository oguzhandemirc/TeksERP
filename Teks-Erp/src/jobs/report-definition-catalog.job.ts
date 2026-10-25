// =============================================================================
// SİSTEM RAPOR TANIMLARI + SİSTEM KATEGORİLERİ — boot uzlaştırması (R1-KAYIT; plan §3.3)
// =============================================================================
// Katalog kodda, kayıtlı rapor dünyası DB'de: ön ayar ve görüntü sistem raporuna da `definitionId`
// ile bağlanır, o yüzden her `nesil:"v2"` + `hazir:true` satırın bir SISTEM tanımı olmalı. İdempotent
// ve SİLMEZ: katalogdan çıkan (ya da hazırlığı geri alınan) satır ARSIV'e geçer, geri gelirse YAYINDA'ya
// döner — her ikisi atomik claim + audit. Best-effort: DB hazır değilse sunucuyu durdurmaz.
// =============================================================================
import prisma from "../lib/prisma";
import { AuditService } from "../services/audit.service";
import { REPORT_CATALOG, RAPOR_KATEGORILERI_V2, type ReportCatalogEntryV2 } from "../constants/report-catalog";
import { DEFAULT_CATEGORY_CODE } from "../services/rapor-kategori.service";
import { bilgi, uyari } from "../lib/logger";

const LOG_TAG = "rapor-tanim-katalogu";

/** Sistem kategorilerinin adı ve sırası (Rapor Merkezi bölüm sırası, plan §4.2). */
export const SYSTEM_CATEGORY_NAMES: Record<(typeof RAPOR_KATEGORILERI_V2)[number] | typeof DEFAULT_CATEGORY_CODE, string> = {
  "satis-sevkiyat": "Satış ve sevkiyat",
  uretim: "Üretim",
  kalite: "Kalite",
  dokuma: "Dokuma",
  para: "Para",
  "muhasebe-araclari": "Muhasebe araçları",
  [DEFAULT_CATEGORY_CODE]: "Kayıtlı raporlar",
};

export interface ReconcileSummary {
  kategoriEklenen: number;
  tanimEklenen: number;
  tanimGuncellenen: number;
  arsivlenen: number;
}

async function reconcileCategories(): Promise<{ ids: Map<string, string>; added: number }> {
  const ids = new Map<string, string>();
  let added = 0;
  const codes = Object.keys(SYSTEM_CATEGORY_NAMES) as Array<keyof typeof SYSTEM_CATEGORY_NAMES>;
  for (const [i, code] of codes.entries()) {
    const found = await prisma.reportCategory.findUnique({ where: { code }, select: { id: true } });
    if (found) {
      ids.set(code, found.id);
      continue;
    }
    // Eşzamanlı ikinci boot aynı kodu yazarsa `code @unique` keser; kaybeden yeniden okur.
    const row = await prisma.reportCategory
      .create({ data: { code, name: SYSTEM_CATEGORY_NAMES[code], sortOrder: (i + 1) * 10 }, select: { id: true } })
      .catch(() => prisma.reportCategory.findUniqueOrThrow({ where: { code }, select: { id: true } }));
    ids.set(code, row.id);
    added++;
    await AuditService.log({ userId: undefined, action: "CREATE", tableName: "REPORT_CATEGORY", recordId: row.id, newData: { kod: code, ad: SYSTEM_CATEGORY_NAMES[code], kaynak: "boot-uzlastirma" } });
  }
  return { ids, added };
}

/** Katalogla DB'yi hizalar; dönüş yalnız sayımdır (bekçi ve log için). */
export async function reconcileReportDefinitionCatalog(): Promise<ReconcileSummary> {
  const { ids: categoryIds, added: kategoriEklenen } = await reconcileCategories();
  const live = REPORT_CATALOG.filter((e): e is ReportCatalogEntryV2 => e.nesil === "v2" && e.hazir);
  const summary: ReconcileSummary = { kategoriEklenen, tanimEklenen: 0, tanimGuncellenen: 0, arsivlenen: 0 };
  for (const e of live) {
    const categoryId = categoryIds.get(e.kategoriV2 ?? DEFAULT_CATEGORY_CODE)!;
    const row = await prisma.reportDefinition.findUnique({ where: { key: e.key }, select: { id: true, name: true, description: true, categoryId: true, status: true } });
    if (!row) {
      const created = await prisma.reportDefinition
        .create({ data: { kind: "SISTEM", key: e.key, name: e.baslik, description: e.soru, categoryId, visibility: "HERKES", status: "YAYINDA" }, select: { id: true } })
        .catch(() => null);
      if (!created) continue; // eşzamanlı boot yazdı
      summary.tanimEklenen++;
      await AuditService.log({ userId: undefined, action: "CREATE", tableName: "REPORT_DEFINITION", recordId: created.id, newData: { anahtar: e.key, ad: e.baslik, kaynak: "boot-uzlastirma" } });
      continue;
    }
    const data = {
      ...(row.name !== e.baslik ? { name: e.baslik } : {}),
      ...(row.description !== e.soru ? { description: e.soru } : {}),
      ...(row.categoryId !== categoryId ? { categoryId } : {}),
    };
    const revive = row.status === "ARSIV";
    if (!revive && Object.keys(data).length === 0) continue;
    const n = await prisma.reportDefinition.updateMany({
      where: { id: row.id, kind: "SISTEM", status: row.status },
      data: { ...data, ...(revive ? { status: "YAYINDA" } : {}) },
    });
    if (n.count === 0) continue;
    summary.tanimGuncellenen++;
    await AuditService.log({
      userId: undefined, action: "UPDATE", tableName: "REPORT_DEFINITION", recordId: row.id,
      oldData: { ad: row.name, kategoriId: row.categoryId, durum: row.status }, newData: { ...data, ...(revive ? { durum: "YAYINDA" } : {}), kaynak: "boot-uzlastirma" },
    });
  }
  const liveKeys = live.map((e) => e.key);
  const stale = await prisma.reportDefinition.findMany({
    where: { kind: "SISTEM", status: { not: "ARSIV" }, ...(liveKeys.length ? { key: { notIn: liveKeys } } : {}) },
    select: { id: true, key: true, status: true },
  });
  for (const s of stale) {
    const n = await prisma.reportDefinition.updateMany({ where: { id: s.id, status: s.status }, data: { status: "ARSIV" } });
    if (n.count === 0) continue;
    summary.arsivlenen++;
    await AuditService.log({ userId: undefined, action: "UPDATE", tableName: "REPORT_DEFINITION", recordId: s.id, oldData: { durum: s.status }, newData: { durum: "ARSIV", neden: "katalogda yok", kaynak: "boot-uzlastirma" } });
  }
  return summary;
}

/** Boot girişi — best-effort, gürültülü log. */
export async function startReportDefinitionCatalog(): Promise<void> {
  try {
    const s = await reconcileReportDefinitionCatalog();
    if (s.kategoriEklenen || s.tanimEklenen || s.tanimGuncellenen || s.arsivlenen) {
      bilgi(LOG_TAG, `kategori +${s.kategoriEklenen} · tanım +${s.tanimEklenen} · güncellenen ${s.tanimGuncellenen} · arşive ${s.arsivlenen}`);
    }
  } catch (e) {
    uyari(LOG_TAG, `sistem rapor tanımları uzlaştırılamadı: ${(e as Error).message}`);
  }
}
