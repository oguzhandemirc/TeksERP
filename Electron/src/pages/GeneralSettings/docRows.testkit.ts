// Panel `docRows` testlerinin ORTAK kurulumu. Üç test dosyası (satır üretimi ·
// stil · başlık) aynı belge tanımını ve aynı oku/yaz kısayolunu kullanır;
// kopyalansaydı biri güncellenip ötekiler sessizce eskirdi.
import { buildDocRowGroups, readDocRow, writeDocRow, type DocRow } from "./docRows";
import { DOC_DEF_MAP, resolveDocConfig, type DocumentConfig } from "@/services/documentConfig";

export const FASON = DOC_DEF_MAP.fasonSevk!;
export const SEVK = DOC_DEF_MAP.shipmentDispatch!;

/** Satırı config ile birlikte okumak için kısayol (panelin yaptığının aynısı). */
export const read = (defKey: string, cfg: DocumentConfig, row: DocRow) =>
  readDocRow(cfg, resolveDocConfig({ [defKey]: cfg }, defKey), row);
export const write = (
  defKey: string,
  cfg: DocumentConfig,
  row: DocRow,
  patch: Parameters<typeof writeDocRow>[3],
) => writeDocRow(cfg, resolveDocConfig({ [defKey]: cfg }, defKey), row, patch);

export const allRows = (def: typeof FASON) => buildDocRowGroups(def).flatMap((g) => g.rows);
export const rowById = (def: typeof FASON, id: string): DocRow => {
  const r = allRows(def).find((x) => x.id === id);
  if (!r) throw new Error(`satır yok: ${id}`);
  return r;
};
