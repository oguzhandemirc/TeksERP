// =============================================================================
// deneme-veri — KURU KOŞU sarmalayıcısı (`doldur.mjs --kuru`): GET gerçek sunucuya gider (seçimler canlı veriden),
// POST/PATCH/PUT/DELETE ağa ÇIKMAZ — sayılır ve sahte kimlikli (`kuru-N`) yanıtla döner. Sahte kimliğe yapılan GET
// sunucuya gitmez (kayıt bellekten / boş liste). Zincirin sahte kimlikte durduğu yerler (top durumu, sayım satırı)
// çıktıda "zincir" notuyla anılır; sayım alt sınırdır. Giriş/çıkış (oturum) dışında hiçbir yazım isteği gitmez.
// =============================================================================
const KURU_ID = /kuru-\d+/;
const KIMLIK = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|kuru-\d+/g;

/** Satırlı belgenin KDV dahil toplamı (kuru fatura → tahsilat tutarı). */
const toplam = (b) => (Array.isArray(b?.lines) ? b.lines.reduce((t, l) => t + Number(l.qty ?? 0) * Number(l.unitPrice ?? 0) * (1 + Number(l.vatRate ?? 0) / 100), 0) : 0);

export function kuruSarmala(api) {
  const kayit = new Map();
  const yazim = [];
  let n = 0;
  async function kuruApi(method, path, body, o) {
    if (method === "GET") {
      const m = path.match(KURU_ID);
      if (!m) return api(method, path, body, o);
      const r = kayit.get(m[0]);
      return path.split("?")[0].endsWith(m[0]) && r ? { data: r } : { data: [] };
    }
    yazim.push(`${method} ${path.split("?")[0].replace(KIMLIK, ":id")}`);
    const onay = path.match(/\/(kuru-\d+)\/confirm$/);
    if (onay && kayit.get(onay[1])) kayit.get(onay[1]).status = "CONFIRMED";
    const id = `kuru-${++n}`;
    const rec = { ...(body ?? {}), id, barcode: id, docNo: id, status: path.includes("/cheques") ? "PORTFOLIO" : "DRAFT", paidTotal: 0, grandTotal: toplam(body) };
    kayit.set(id, rec);
    return { data: rec };
  }
  return { api: kuruApi, yazim };
}

/** Yazım listesini "METHOD yol → adet" özetine indir. */
export function yazimOzeti(liste) {
  const m = new Map();
  for (const y of liste) m.set(y, (m.get(y) ?? 0) + 1);
  return [...m].sort((a, b) => a[0].localeCompare(b[0]));
}
