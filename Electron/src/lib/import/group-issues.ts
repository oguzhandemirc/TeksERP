// =============================================================================
// HATA GRUPLAMA — "200 satır hata" yerine "3 farklı sorun"
// =============================================================================
// Önizleme satır satır doğru bilgi veriyor ama 500 satırlık bir dosyada 200
// hatalı satır okunmaz bir duvardır: kullanıcı aynı cümleyi 200 kez okuyup
// TEK bir kök nedeni (ör. renk kataloğunda olmayan bir renk) bulmaya çalışır.
// Sektör emsali: Dynamics 365 "execution log" hataları sınıfa göre toplar.
//
// SINIF NEDİR: mesajın DEĞİŞKEN kısmı ayıklanmış hâli. Hata metinleri değeri
// tırnak içinde taşıyor ("'MAVI' ile eşleşen renk bulunamadı") — tırnaklı
// parçayı ve satır numaralarını maskeleyince geriye sınıf kalır.
//
// ⚠️ Gruplama SUNUCUYA HİÇBİR ŞEY SORMAZ: önizleme yanıtı zaten elimizde.

import type { ImportRowIssue, ImportRowResult } from "@/services/importService";

export interface IssueGroup {
  /** Sınıf anahtarı (maskelenmiş mesaj) — React key + eşitlik için. */
  key: string;
  kind: "error" | "warning";
  /** Kullanıcıya gösterilen örnek cümle (ilk gerçek mesaj — değer DAHİL). */
  sample: string;
  /** Sütun etiketi (varsa). */
  column?: string;
  /** Bu sınıfa düşen satır numaraları (dosyadaki), sıralı. */
  rowNos: number[];
  /** Bu sınıfta geçen FARKLI değerler (ör. bulunamayan renk adları). */
  values: string[];
}

/**
 * Mesajı sınıfa indirger: tırnak içindeki değerler ve sayılar maskelenir.
 * `'MAVI' ile eşleşen renk bulunamadı`  → `'…' ile eşleşen renk bulunamadı`
 * `Bu anahtar dosyada 14. satırda da var` → `Bu anahtar dosyada #. satırda da var`
 */
export function issueClass(message: string): string {
  return message
    .replace(/'[^']*'/g, "'…'")
    .replace(/\d+/g, "#")
    .trim();
}

/** Mesajdaki ilk tırnaklı değer — "hangi değerler sorun çıkardı" listesi için. */
export function issueValue(message: string): string | null {
  const m = /'([^']*)'/.exec(message);
  return m?.[1] ?? null;
}

/**
 * Satır sonuçlarını sorun SINIFLARINA toplar; en çok satır etkileyen önce.
 * Hatalar uyarılardan önce gelir — kullanıcı önce yükleme durduran şeyi görsün.
 */
export function groupIssues(rows: ImportRowResult[]): IssueGroup[] {
  const map = new Map<string, IssueGroup>();

  const add = (kind: IssueGroup["kind"], rowNo: number, issue: ImportRowIssue): void => {
    const cls = issueClass(issue.message);
    const key = `${kind}|${issue.column ?? ""}|${cls}`;
    let g = map.get(key);
    if (!g) {
      g = { key, kind, sample: issue.message, column: issue.column, rowNos: [], values: [] };
      map.set(key, g);
    }
    // Aynı satır aynı sınıftan iki mesaj taşıyabilir (ör. iki referans sütunu);
    // satır numarası bir kez sayılır, yoksa "12 satır" gerçekte 7 satır olur.
    if (g.rowNos[g.rowNos.length - 1] !== rowNo) g.rowNos.push(rowNo);
    const v = issueValue(issue.message);
    if (v && !g.values.includes(v)) g.values.push(v);
  };

  for (const r of rows) {
    for (const e of r.errors) add("error", r.rowNo, e);
    for (const w of r.warnings) add("warning", r.rowNo, w);
  }

  return [...map.values()].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "error" ? -1 : 1;
    return b.rowNos.length - a.rowNos.length;
  });
}

/** "4, 7, 9 … (+12)" — satır listesini kısaltarak yazar. */
export function formatRowNos(rowNos: number[], max = 8): string {
  const shown = rowNos.slice(0, max).join(", ");
  const rest = rowNos.length - max;
  return rest > 0 ? `${shown} … (+${rest})` : shown;
}
