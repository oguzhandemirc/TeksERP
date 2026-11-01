// Kasa hareketinin kategori ANAHTARI (D4-KUC3c; DALGA4 §9.8): `ozet-masraf` kategori satırı ile patron kasa
// listesinin süzgeci AYNI anahtardan konuşur. Anahtarı fabrika `cashCategoryKey` ile üretir (panel süzgeci ve masraf
// özeti de bunu kullanır); bulut yalnız saklı alan eşitliği yapar — kırpma/katlama bulutta YOK.
import { cashCategoryKey } from "../services/helpers/expense-summary.helper";

type RawRow = Record<string, unknown> & { id: string };
type DerivedValues = Map<string, Record<string, unknown>>;

async function cashTransactionDerived(rows: readonly RawRow[]): Promise<DerivedValues> {
  return new Map(rows.map((r) => [r.id, { kategoriAnahtari: cashCategoryKey(r.category as string | null).key }]));
}

export const CASH_DERIVERS = { "kasa-hareketi": cashTransactionDerived } as const;
export const CASH_DERIVER_ROW_FIELDS: Readonly<Record<string, readonly string[]>> = { "kasa-hareketi": ["category"] };
