// Depo arşiv kapısı — URUN-YASAM-DONGUSU.md §6 (bugün yalnız sert silmede top sayılıyordu).
import type { ArchiveSpec } from "../master-data-archive.helper";
import { LIVE_ROLL } from "../live-ref-where.helper";
import { SETTING_KEYS } from "../../system-setting/keys";

export const WAREHOUSE_ARCHIVE: ArchiveSpec = {
  entity: "warehouse",
  noun: "deposu",
  table: "warehouses",
  auditTable: "WAREHOUSE",
  live: [
    {
      kind: "ROLL",
      label: "Depodaki canlı top",
      count: (db, id) => db.roll.count({ where: { warehouseId: id, ...LIVE_ROLL } }),
      list: async (db, id, take) =>
        (await db.roll.findMany({ where: { warehouseId: id, ...LIVE_ROLL }, take, orderBy: { barcode: "asc" }, select: { id: true, barcode: true, status: true } }))
          .map((r) => ({ id: r.id, title: r.barcode ?? r.id, detail: r.status })),
    },
    {
      kind: "YARN_STOCK",
      label: "İplik bakiyesi",
      count: (db, id) => db.yarnStock.count({ where: { warehouseId: id, balanceKg: { not: 0 } } }),
      list: async (db, id, take) =>
        (await db.yarnStock.findMany({ where: { warehouseId: id, balanceKg: { not: 0 } }, take, select: { id: true, balanceKg: true, item: { select: { name: true } } } }))
          .map((y) => ({ id: y.id, title: y.item.name, detail: `${y.balanceKg.toString()} kg` })),
    },
    // F1b: emanet deposu pasife alınırsa sahipli doğum 400 verir (fail-closed) — önce ayar boşaltılır ya da değiştirilir.
    {
      kind: "EMANET_DEFAULT_WAREHOUSE",
      label: "Emanet varsayılan deposu ayarı",
      count: (db, id) => db.systemSetting.count({ where: { key: SETTING_KEYS.EMANET_DEFAULT_WAREHOUSE_ID, value: { equals: id } } }),
      list: async (db, id) =>
        (await db.systemSetting.count({ where: { key: SETTING_KEYS.EMANET_DEFAULT_WAREHOUSE_ID, value: { equals: id } } })) > 0
          ? [{ id: SETTING_KEYS.EMANET_DEFAULT_WAREHOUSE_ID, title: "Emanet varsayılan deposu", detail: "ayar" }]
          : [],
    },
  ],
  config: [],
};
