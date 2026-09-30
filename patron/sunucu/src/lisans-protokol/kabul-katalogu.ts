// OTOMATİK ÜRETİLİR — `npx tsx scripts/kabul-metni-uret.ts` (kaynak: docs/hukuk/KABUL-METNI.md §2). ELLE DÜZENLENMEZ.
// Tanınan ilk kurulum kabul metinleri, yayım sırasıyla; SON satır fabrikanın gösterdiği güncel metindir.
import type { AcceptanceTextEntry } from "./kabul";

export const ACCEPTANCE_TEXTS: readonly AcceptanceTextEntry[] = [
  { kimlik: "KM-2026.1-taslak", ozet: "4fe1d14e24fafffafc203f7b4d1c2930ceaa76ee4ec50f7e116a9f780fec5daf", kutular: ["1", "2", "3", "4"] },
];
