// =============================================================================
// GÜZERGÂH · SO — sipariş yönü DOĞUŞTA donar; sipariş raporu donmuş yönü okur (2026-09-23)
// =============================================================================
//   SO1 hazırlık (API): yurtdışı cari + sipariş → DB'de siparişin yönü EXPORT
//   SO2 Raporlar → Sipariş Karnesi: yön seçicisinin adı "Sipariş yönü (açılışta)"; İhracat seçilince
//       panelin gönderdiği istek destination=EXPORT, cevapta cari VAR
//   SO3 cari kartı başka istemciden YURTİÇİ'ne çevrilir → rapor yeniden açılır: İhracat'ta cari HÂLÂ
//       var, Yurtiçi'nde YOK; DB'de sipariş EXPORT, kart DOMESTIC
// Müşteri kırılımı tablosu fabrika kopyasında uzun olabilir → cari, panelin rapor isteğinin
// CEVABININ müşteri kırılımında (`data.byCustomer`) aranır (ekranın gönderdiği süzgeç + sunucunun cevabı).
// =============================================================================
const ONEK = process.env.E2E_ONEK ?? "TEST";
const K = Date.now().toString(36).slice(-4).toUpperCase();
const SO = { cari: `${ONEK}-SO${K} İhracat Cari` };
const olc = { cariId: null, siparisId: null, etiketVar: null, ihracat1: null, ihracat2: null, yurtici2: null };

/** Sipariş Karnesi → yön seçicisi → seçenek; panelin gönderdiği rapor isteğinin cevabı. */
async function yonSec({ git, page }, secenek, beklenenDeger) {
  await git("Sipariş Karnesi");
  await page().waitForTimeout(1500);
  const kutu = page().getByRole("combobox", { name: "Sipariş yönü (açılışta)" }).filter({ visible: true }).first();
  await kutu.waitFor({ timeout: 15_000 });
  const yanit = page().waitForResponse((r) => r.request().method() === "GET" && /\/api\/reports\/sales\/order-intake\?/.test(r.url()) && r.url().includes(`destination=${beklenenDeger}`), { timeout: 20_000 });
  await kutu.click();
  await page().getByRole("option", { name: secenek, exact: true }).click({ timeout: 10_000 });
  // Yalnız rapor gövdesinin müşteri kırılımı sayılır — `meta.secenekler` süzgeç seçenekleridir (bütün
  // cariler), orada görünmek "raporda var" demek değildir.
  const g = await (await yanit).json();
  return (g?.data?.byCustomer ?? []).map((c) => c.key);
}

export const SIPARIS_YONU_ADIMLARI = [
  {
    id: "SO1", rol: "P",
    yol: "HAZIRLIK (API) — yurtdışı cari + sipariş: yön sipariş açılırken donar", rota: "orders",
    async yap({ api, sql }) {
      const c = await api("/api/customers", { method: "POST", body: JSON.stringify({ name: SO.cari, isCustomerRole: true, defaultDestination: "EXPORT" }) });
      if (c.status >= 300) throw new Error(`cari: ${c.status} ${JSON.stringify(c.govde).slice(0, 160)}`);
      olc.cariId = c.govde.data.id;
      const [kumas] = await sql(`SELECT id FROM items WHERE "isActive" AND "itemType"='FABRIC' ORDER BY "createdAt" DESC LIMIT 1`);
      const o = await api("/api/orders", { method: "POST", body: JSON.stringify({ customerId: olc.cariId, lines: [{ itemId: kumas.id, quantity: 25 }], clientToken: crypto.randomUUID() }) });
      if (o.status >= 300) throw new Error(`sipariş: ${o.status} ${JSON.stringify(o.govde).slice(0, 160)}`);
      olc.siparisId = o.govde.data.id;
    },
    dogrula: [{ ad: "siparişin yönü doğuşta EXPORT", sql: `SELECT destination::text d FROM orders WHERE id=$1`, params: () => [olc.siparisId], oku: (r) => r[0]?.d, beklenen: "EXPORT" }],
  },
  {
    id: "SO2", rol: "P", gerektirir: ["SO1"],
    yol: "Raporlar → Sipariş Karnesi → yön seçicisi 'Sipariş yönü (açılışta)' → İhracat (sipariş yönü) → cari listede", rota: "reports/sales/order-intake",
    async yap(ctx) {
      olc.ihracat1 = await yonSec(ctx, "İhracat (sipariş yönü)", "EXPORT");
      olc.etiketVar = (await ctx.page().getByText("Sipariş yönü (açılışta)").filter({ visible: true }).count()) > 0;
    },
    dogrula: [
      { ad: "yön ekseninin adı 'Sipariş yönü (açılışta)'", sql: `SELECT 1`, oku: () => olc.etiketVar, beklenen: true },
      { ad: "İhracat süzgecinin cevabında cari VAR", sql: `SELECT 1`, oku: () => olc.ihracat1?.includes(olc.cariId) ?? false, beklenen: true },
    ],
  },
  {
    id: "SO3", rol: "P", gerektirir: ["SO2"],
    yol: "(başka istemci) cari kartı YURTİÇİ'ne çevrilir → Sipariş Karnesi: İhracat'ta cari HÂLÂ var, Yurtiçi'nde yok", rota: "reports/sales/order-intake",
    async yap(ctx) {
      const r = await ctx.api(`/api/customers/${olc.cariId}`, { method: "PATCH", body: JSON.stringify({ defaultDestination: "DOMESTIC" }) });
      if (r.status >= 300) throw new Error(`kart: ${r.status} ${JSON.stringify(r.govde).slice(0, 160)}`);
      await ctx.page().reload(); await ctx.page().waitForTimeout(3000);
      olc.ihracat2 = await yonSec(ctx, "İhracat (sipariş yönü)", "EXPORT");
      olc.yurtici2 = await yonSec(ctx, "Yurtiçi (sipariş yönü)", "DOMESTIC");
    },
    dogrula: [
      { ad: "cari kartı DOMESTIC", sql: `SELECT "defaultDestination"::text d FROM customers WHERE id=$1`, params: () => [olc.cariId], oku: (r) => r[0]?.d, beklenen: "DOMESTIC" },
      { ad: "⭐ sipariş DB'de hâlâ EXPORT", sql: `SELECT destination::text d FROM orders WHERE id=$1`, params: () => [olc.siparisId], oku: (r) => r[0]?.d, beklenen: "EXPORT" },
      { ad: "⭐ rapor: İhracat'ta cari HÂLÂ var", sql: `SELECT 1`, oku: () => olc.ihracat2?.includes(olc.cariId) ?? false, beklenen: true },
      { ad: "⭐ rapor: Yurtiçi'nde cari YOK", sql: `SELECT 1`, oku: () => olc.yurtici2?.includes(olc.cariId) ?? true, beklenen: false },
    ],
  },
];
