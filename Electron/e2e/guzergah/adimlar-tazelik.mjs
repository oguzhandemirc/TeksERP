// =============================================================================
// GÜZERGÂH · TZ — başka istemcinin kaydı, sayfaya DÖNÜLÜNCE görünür (K21 tazelik sondası)
// =============================================================================
// Kasa & Banka · Depo Transferi · Serbest Belgeler: sayfa açılır → başka sayfaya geçilir →
// "başka istemci" (API) kayıt açar → tazelik süresi (30 sn) aşılır → sayfaya dönülür → kayıt
// listede. 2026-09-23 ölçümü: genel staleTime 5 dk iken üç sayfa da yeni kaydı göstermedi
// (Kasa & Banka'da bakiye de eski); sayfada Yenile düğmesi yok.
// =============================================================================
const BEKLE_MS = 35_000; // global staleTime (30 sn) + pay
const K = () => Date.now().toString(36).slice(-5).toUpperCase();
const olc = {};
const kalip = (d) => new RegExp(`(?<![A-Z0-9])${d.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}(?![0-9])`);

/** Sayfa → başka sayfa → API kayıt → bekle → sayfaya dön → numara görünüyor mu. */
async function tazelikSondasi(ctx, sayfa, olustur) {
  const { git, page } = ctx;
  await git(sayfa);
  await page().waitForTimeout(1500);
  await git("Anasayfa");
  const numara = await olustur(ctx);
  await page().waitForTimeout(BEKLE_MS);
  await git(sayfa);
  await page().waitForTimeout(2500);
  const gorundu = (await page().getByText(kalip(numara)).filter({ visible: true }).count()) > 0;
  return { numara, gorundu };
}
const numaraOku = async (sql, tablo, kolon, id) => (await sql(`SELECT "${kolon}" v FROM "${tablo}" WHERE id=$1`, [id]))[0]?.v;

export const TAZELIK_ADIMLARI = [
  {
    id: "TZ1", rol: "P",
    yol: "Muhasebe → Kasa & Banka → Anasayfa → (başka istemci API'den kasa açar, 35 sn) → Kasa & Banka → yeni kasa listede", rota: "finance/accounts",
    async yap(ctx) {
      olc.tz1 = await tazelikSondasi(ctx, "Kasa & Banka", async ({ api }) => (await api("/api/finance/cash-boxes", { method: "POST", body: JSON.stringify({ name: `TEST-TZ Kasa ${K()}` }) })).govde.data.code);
    },
    dogrula: [{ ad: "yeni kasa sayfaya dönünce görünüyor", sql: `SELECT 1`, oku: () => JSON.stringify(olc.tz1), beklenen: () => olc.tz1?.gorundu === true }],
  },
  {
    id: "TZ2", rol: "P",
    yol: "Operasyon → Depo Transferi → Anasayfa → (başka istemci API'den transfer yapar, 35 sn) → Depo Transferi → yeni transfer listede", rota: "operations/warehouse-transfers",
    async yap(ctx) {
      olc.tz2 = await tazelikSondasi(ctx, "Depo Transferi", async ({ api, sql }) => {
        const hedef = (await api("/api/warehouses", { method: "POST", body: JSON.stringify({ name: `TEST-TZ Depo ${K()}` }) })).govde.data.id;
        const [top] = await sql(`SELECT id, "warehouseId" w FROM rolls WHERE status='WAREHOUSE' AND "warehouseId" IS NOT NULL AND "sackId" IS NULL AND "shipmentId" IS NULL ORDER BY "updatedAt" DESC LIMIT 1`);
        const r = await api("/api/warehouse-transfers", { method: "POST", body: JSON.stringify({ fromWarehouseId: top.w, toWarehouseId: hedef, rollIds: [top.id], clientToken: crypto.randomUUID() }) });
        return numaraOku(sql, "warehouse_transfers", "transferNo", r.govde.data.id);
      });
    },
    dogrula: [{ ad: "yeni transfer sayfaya dönünce görünüyor", sql: `SELECT 1`, oku: () => JSON.stringify(olc.tz2), beklenen: () => olc.tz2?.gorundu === true }],
  },
  {
    id: "TZ3", rol: "P",
    yol: "Tanımlar → Serbest Belgeler → Anasayfa → (başka istemci API'den belge açar, 35 sn) → Serbest Belgeler → yeni belge listede", rota: "definitions/free-documents",
    async yap(ctx) {
      olc.tz3 = await tazelikSondasi(ctx, "Serbest Belgeler", async ({ api, sql }) => {
        const r = await api("/api/free-documents", { method: "POST", body: JSON.stringify({ title: `TEST-TZ Serbest ${K()}` }) });
        return numaraOku(sql, "free_documents", "documentNo", r.govde.data.id);
      });
    },
    dogrula: [{ ad: "yeni belge sayfaya dönünce görünüyor", sql: `SELECT 1`, oku: () => JSON.stringify(olc.tz3), beklenen: () => olc.tz3?.gorundu === true }],
  },
];
