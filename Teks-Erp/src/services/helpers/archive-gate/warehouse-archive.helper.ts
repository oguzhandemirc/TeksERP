// Depo arşiv kapısı — URUN-YASAM-DONGUSU.md §6 (bugün yalnız sert silmede top sayılıyordu).
import type { ArchiveSpec, RefKind } from "../master-data-archive.helper";
import { LIVE_ROLL } from "../live-ref-where.helper";
import { SETTING_KEYS } from "../../system-setting/keys";
import { readEmanetDefaultWarehouseId } from "../../system-setting/tambur-fason";

/** F1b: ayarda emanet deposu olarak kayıtlı depo pasife alınamaz ve kalıcı silinemez (sahipli doğum 400 verirdi).
 *  Okuma doğum boğazıyla AYNI okuyucudan (kanonik küçük harf) — biçim farkı kapıyı atlatmasın. Tek kaynak: pasife alma
 *  `live` listesi, kalıcı silme `hardDelete` bu nesneyi sayar. */
export const EMANET_DEFAULT_WAREHOUSE_REF: RefKind = {
  kind: "EMANET_DEFAULT_WAREHOUSE",
  label: "Emanet varsayılan deposu ayarı",
  count: async (db, id) => ((await readEmanetDefaultWarehouseId(db)) === id.toLowerCase() ? 1 : 0),
  list: async (db, id) =>
    (await readEmanetDefaultWarehouseId(db)) === id.toLowerCase()
      ? [{ id: SETTING_KEYS.EMANET_DEFAULT_WAREHOUSE_ID, title: `Ayar ${SETTING_KEYS.EMANET_DEFAULT_WAREHOUSE_ID}`, detail: "sistem yöneticisi önce ayarı boşaltmalı ya da başka depoya çevirmeli (PUT /api/feature-flags/emanet-default-warehouse)" }]
      : [],
};

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
    EMANET_DEFAULT_WAREHOUSE_REF,
  ],
  config: [],
};
