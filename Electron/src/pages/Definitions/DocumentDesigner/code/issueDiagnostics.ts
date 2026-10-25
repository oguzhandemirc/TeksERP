// Sunucunun konumlu hata listesi (`{satir,sutun,mesaj}`, 1 tabanlı) → editör aralığı.
// İstemci Liquid ÇALIŞTIRMAZ; altı çizili hata yalnız `POST /preview` cevabından gelir.

export interface ServerIssue {
  satir: number | null;
  sutun: number | null;
  mesaj: string;
}

export interface IssueRange {
  from: number;
  to: number;
  message: string;
}

/** Satır/sütunu belge ofsetine çevirir; taşan değer kenara kısılır, konumsuz hata ilk satıra düşer. */
export function issueOffset(text: string, satir: number | null, sutun: number | null): number {
  if (satir === null) return 0;
  let offset = 0;
  for (let line = 1; line < satir; line++) {
    const nl = text.indexOf("\n", offset);
    if (nl === -1) return text.length;
    offset = nl + 1;
  }
  const end = text.indexOf("\n", offset);
  const lineEnd = end === -1 ? text.length : end;
  return Math.min(offset + Math.max(0, (sutun ?? 1) - 1), lineEnd);
}

/** Hata aralığı: konumdan kelime/etiket sonuna (en az 1 karakter, satırı aşmaz). */
export function issueRange(text: string, issue: ServerIssue): IssueRange {
  const from = issueOffset(text, issue.satir, issue.sutun);
  const rest = text.slice(from);
  const m = /^(\{[{%][\s\S]*?[}%]\}|[^\s<>"']+)/.exec(rest);
  let len = m ? m[0].length : 1;
  const nl = rest.indexOf("\n");
  if (nl !== -1) len = Math.min(len, Math.max(1, nl));
  const to = Math.min(text.length, from + len);
  return { from: to === from && from > 0 ? from - 1 : from, to, message: issue.mesaj };
}

/** Şeritte gösterim: "Satır 3, sütun 7 — mesaj". */
export function issueLabel(issue: ServerIssue): string {
  if (issue.satir === null) return issue.mesaj;
  return `Satır ${issue.satir}${issue.sutun ? `, sütun ${issue.sutun}` : ""} — ${issue.mesaj}`;
}
