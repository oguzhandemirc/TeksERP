// test_gelen_belge_cok_parti §14 (ekran denetimi 2026-11-06): onayda doğan parti kaydı (özet satırı) belgenin top sayısına
// karışmaz — detay satırı `summary` bayrağı taşır, liste `docLineCount` özet hariç sayar (`_count.lines` bugünkü gibi hepsi).
// Negatif sonda: `docLineCounts` özet çıkarmayı atlayınca (summaries döngüsü yok) liste kontrolü kırmızı.
type Check = (label: string, ok: boolean, extra?: string) => void;
type Resp = { status: number; data?: Record<string, unknown> };

export async function cokPartiSayim(c: { check: Check; noteId: string; get: (path: string) => Promise<Resp> }): Promise<void> {
  console.log("§14 parti kaydı top sayısına karışmaz");
  const d = await c.get(`/api/gelen-belge/irsaliyeler/${c.noteId}`);
  const lines = (d.data?.lines ?? []) as Array<{ summary?: boolean; lineKind: string }>;
  const summaries = lines.filter((l) => l.summary === true);
  c.check("§14 ⭐ detay: 2 parti kaydı summary=true (ARABA), 5 belge satırı summary=false", d.status === 200 && lines.length === 7 && summaries.length === 2 && summaries.every((l) => l.lineKind === "ARABA") && lines.filter((l) => l.summary === false).length === 5,
    JSON.stringify(lines.map((l) => [l.lineKind, l.summary])));
  const noteNo = d.data?.noteNo as string;
  const l = await c.get(`/api/gelen-belge/irsaliyeler?q=${encodeURIComponent(noteNo)}`);
  const item = ((l.data?.items ?? []) as Array<{ id: string; docLineCount?: number; _count: { lines: number } }>).find((x) => x.id === c.noteId);
  c.check("§14 ⭐ liste: docLineCount 5 (özet hariç), _count.lines 7 (eski istemci)", item?.docLineCount === 5 && item._count.lines === 7, JSON.stringify(item ? { d: item.docLineCount, c: item._count } : l));
}
