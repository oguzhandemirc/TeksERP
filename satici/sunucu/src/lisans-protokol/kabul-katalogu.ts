// OTOMATİK ÜRETİLİR — `npx tsx scripts/kabul-metni-uret.ts` (kaynak: docs/hukuk/KABUL-METNI.md §2). ELLE DÜZENLENMEZ.
// Tanınan ilk kurulum kabul metinleri, yayım sırasıyla; SON satır fabrikanın gösterdiği güncel metindir.
import type { AcceptanceTextEntry } from "./kabul";

export const ACCEPTANCE_TEXTS: readonly AcceptanceTextEntry[] = [
  { kimlik: "KM-2026.1-taslak", ozet: "a50db0c578357bdd4e4e573dbee797208930a890af327fed53209ed717b43726", kutular: ["1", "2", "3", "4"] },
];
