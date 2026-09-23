// =============================================================================
// NUMARA KABUL TURU — KAYIT AÇICILAR (kilitli seriler; E2 öncesi TEMEL ölçüm)
// =============================================================================
// Her satır: kaydı açma yolu (panel ya da API) · numaranın görüneceği ekran (sayfa + arama) ·
// belge (varsa) · eski kayıt. Kaynak: panel/servis haritası 2026-09-23 (d3, iki tarama).
// Yol olmayan seri `olculmedi: "<gerekçe>"` taşır — sürücü "ÖLÇÜLMEDİ" basar, susmaz.
// Aynı tabloyu paylaşan seriler (fatura ×4 · ödeme ×2 · çek/senet ×4) eski kaydı KENDİ türüyle seçer.
// =============================================================================

/** @param {{ api: Function, sql: Function, page: any, gitSayfa: Function, ortam: any, tokenAl: () => string, bayrakYaz: Function }} c */
export function acicilarKur(c) {
  const { api, sql, page, gitSayfa } = c;

  const ileri = (gun) => new Date(Date.now() + gun * 86_400_000).toISOString().slice(0, 10);
  const K = () => Date.now().toString(36).slice(-5).toUpperCase();
  const zorunlu = (r, ne) => { if (r.status >= 300) throw new Error(`${ne}: ${r.status} ${JSON.stringify(r.govde).slice(0, 220)}`); return r.govde?.data; };

  /** Panel listesi: sayfa → (varsa) arama kutusu → değer satırda/ekranda görünüyor mu. */
  async function listede(sayfa, aramaPh, degerler, tekrar = true) {
    await gitSayfa(sayfa);
    await page.waitForTimeout(800);
    const out = {};
    for (const d of degerler.filter(Boolean)) {
      if (aramaPh) {
        const ara = page.getByPlaceholder(aramaPh).filter({ visible: true }).first();
        if (await ara.count()) { await ara.fill(d); await page.waitForTimeout(1500); }
      }
      // Hücre numaranın altında başka satır taşıyabilir ("ASZ…" + "TRY") → tam metin değil, SINIRLI eşleşme:
      // numara başka bir harf/rakam/ayraçla BİTİŞİK olmamalı (ASZ…0001 ≠ ASZ…00012).
      const kalip = new RegExp(`(?<![A-Z0-9])${d.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}(?![0-9])`);
      out[d] = (await page.getByText(kalip).filter({ visible: true }).count()) > 0;
    }
    // Sekmeye 30 sn'lik tazelik penceresi İÇİNDE dönüldüyse liste bilerek önbellekten gelir (K21 tasarımı):
    // pencere aşılıp sayfaya yeniden dönülür; ilk görünmeme `tazelikBekledi` olarak raporda kalır.
    if (tekrar && Object.values(out).some((v) => !v)) {
      await gitSayfa("Anasayfa"); await page.waitForTimeout(31_000);
      return { ...(await listede(sayfa, aramaPh, degerler, false)), tazelikBekledi: true };
    }
    return out;
  }
  async function belgeHtml(tip, id, numara, yol = null) {
    const h = await fetch(`${c.ortam.apiUrl}${yol ?? `/api/printed-documents/${tip}/${id}/html`}`, { headers: { authorization: `Bearer ${c.tokenAl()}` } });
    const html = await h.text();
    return { belgeDurum: h.status, belgedeVar: h.status < 300 && html.includes(numara) };
  }
  const eskiSec = async (tablo, kolon, kosul = "TRUE", p = []) =>
    (await sql(`SELECT "${kolon}" v FROM "${tablo}" WHERE "${kolon}" IS NOT NULL AND ${kosul} ORDER BY "createdAt" DESC LIMIT 1`, p))[0]?.v ?? null;

  // ── ortak hazırlık: finans + üretim modülü, cari, kasa ─────────────────────
  async function modulAc(dur) {
    if (dur.modulHazir) return;
    const f = (await api("/api/feature-flags")).govde?.data ?? {};
    dur.bayrakOnce = { ...(dur.bayrakOnce ?? {}), financeEnabled: f.financeEnabled, productionEnabled: f.productionEnabled };
    if (!f.financeEnabled || !f.productionEnabled) {
      const r = await c.bayrakYaz({ financeEnabled: true, productionEnabled: true });
      if (r.status >= 300) throw new Error(`modül: ${r.status} ${JSON.stringify(r.govde).slice(0, 200)}`);
    }
    dur.modulHazir = true;
  }
  async function finansCari(dur) {
    await modulAc(dur);
    if (dur.finCari) return dur.finCari;
    const d = zorunlu(await api("/api/customers", { method: "POST", body: JSON.stringify({ name: `TEST-E5F${K()} Finans Cari`, isCustomerRole: true, defaultDestination: "DOMESTIC" }) }), "cari");
    const cariId = d.cariAccountId ?? (await api(`/api/finance/cari/by-customer/${d.id}`)).govde?.data?.id;
    dur.finCari = { customerId: d.id, cariId, kod: d.code };
    return dur.finCari;
  }
  async function kasa(dur) {
    await modulAc(dur);
    if (dur.kasa) return dur.kasa;
    const d = zorunlu(await api("/api/finance/cash-boxes", { method: "POST", body: JSON.stringify({ name: `TEST-E5 Kasa ${K()}` }) }), "kasa");
    dur.kasa = { id: d.id, kod: d.code };
    return dur.kasa;
  }

  // ── faturalar (Invoice.docNo · tür ile ayrılır) ────────────────────────────
  const fatura = (tip, liste) => ({
    tablo: { tablo: "invoices", kolon: "docNo" }, okutulur: false,
    hazirla: finansCari,
    eskiKayit: () => eskiSec("invoices", "docNo", `type=$1`, [tip]),
    ac: async (dur) => {
      const cr = await finansCari(dur);
      const d = zorunlu(await api("/api/finance/invoices", { method: "POST", body: JSON.stringify({ type: tip, customerId: cr.customerId, lines: [{ description: "E5 kabul", qty: "1", unit: "ADET", unitPrice: "10" }], clientToken: crypto.randomUUID() }) }), "fatura");
      // Belge ONAYDA donar — onaylanmadan belge ucu 409 (taslak).
      const o = await api(`/api/finance/invoices/${d.id}/confirm`, { method: "POST", body: "{}" });
      return { id: d.id, numara: d.docNo, onay: o.status };
    },
    ekran: (dur, k, eski) => listede(liste, /Belge no \/ cari ara/, [k.numara, eski]),
    belge: (dur, k) => belgeHtml("INVOICE_INTERNAL", k.id, k.numara),
  });

  // ── tahsilat / ödeme (Payment.docNo · yön ile ayrılır) ─────────────────────
  const odeme = (yon) => ({
    tablo: { tablo: "payments", kolon: "docNo" }, okutulur: false,
    hazirla: async (dur) => { await finansCari(dur); await kasa(dur); },
    eskiKayit: () => eskiSec("payments", "docNo", `direction=$1`, [yon]),
    ac: async (dur) => {
      const d = zorunlu(await api("/api/finance/payments", { method: "POST", body: JSON.stringify({ direction: yon, method: "CASH", customerId: dur.finCari.customerId, amount: "5", cashBoxId: dur.kasa.id, clientToken: crypto.randomUUID() }) }), "ödeme");
      return { id: d.id, numara: d.docNo };
    },
    ekran: (dur, k, eski) => listede("Tahsilat / Ödeme", /Belge no \/ referans ara/, [k.numara, eski]),
    belge: (dur, k) => belgeHtml("PAYMENT_RECEIPT", k.id, k.numara),
  });

  // ── çek / senet (Cheque.docNo · kind + docType ile ayrılır) ────────────────
  const cek = (kind, docType) => ({
    tablo: { tablo: "cheques", kolon: "docNo" }, okutulur: false,
    hazirla: finansCari,
    eskiKayit: () => eskiSec("cheques", "docNo", `kind=$1 AND "docType"=$2`, [kind, docType]),
    ac: async (dur) => {
      const d = zorunlu(await api("/api/finance/cheques", { method: "POST", body: JSON.stringify({ kind, docType, customerId: dur.finCari.customerId, amount: "7", dueDate: ileri(30), clientToken: crypto.randomUUID() }) }), "çek");
      return { id: d.id, numara: d.docNo };
    },
    ekran: (dur, k, eski) => listede("Çek / Senet", /Belge no \/ seri no/, [k.numara, eski]),
    belge: null, // kendi belgesi yok; numara bordro belgesinde basılır (chequeDeliveryNote satırı ölçer)
  });

  /**
   * PANELDEN yeni kayıt: sayfa → "Yeni" (ya da özel düğme) → ad → (ek alanlar) → Kaydet; kodu POST yanıtından
   * okur. Panel kod GÖNDERMEZ — sunucu üretir (K20).
   */
  async function panelYeni({ sayfa, dugme = "Yeni", uc, ad, doldur }) {
    await gitSayfa(sayfa);
    await page.waitForTimeout(600);
    await page.getByRole("button", { name: dugme, exact: true }).filter({ visible: true }).first().click({ timeout: 15_000 });
    const d = page.getByRole("dialog").last();
    await d.waitFor({ timeout: 10_000 });
    await d.locator("#name").fill(ad);
    if (doldur) await doldur(d);
    const yanit = page.waitForResponse((r) => r.request().method() === "POST" && new RegExp(`${uc}(\\?|$)`).test(r.url()), { timeout: 20_000 });
    await d.locator('button[type="submit"]').last().click({ timeout: 10_000 });
    const r = await yanit;
    const g = await r.json().catch(() => ({}));
    if (r.status() >= 300) throw new Error(`panel ${sayfa}: ${r.status()} ${JSON.stringify(g).slice(0, 200)}`);
    await page.waitForTimeout(800);
    return g.data;
  }

  /** Master veri kodu: panel (varsa) ya da API ile açılır → `code`; sayfa listesi aranır. */
  const kod = ({ tablo, uc, govde, sayfa, arama, hazirla, belge, yeniOnEk, panel }) => ({
    tablo: { tablo, kolon: "code" }, okutulur: false, yeniOnEk,
    hazirla: hazirla ?? (async () => {}),
    eskiKayit: () => eskiSec(tablo, "code"),
    ac: async (dur) => {
      if (panel) { const d = await panelYeni({ uc, ad: `TEST-E5P ${K()}`, ...panel }); return { id: d.id, numara: d.code, acilisYolu: "panel" }; }
      const d = zorunlu(await api(uc, { method: "POST", body: JSON.stringify(typeof govde === "function" ? await govde(dur) : govde) }), uc);
      return { id: d.id, numara: d.code };
    },
    ekran: (dur, k, eski) => listede(sayfa, arama, [k.numara, eski]),
    belge: belge ?? null,
  });

  /** Numara yanıt şekline güvenilmez: kaydın id'siyle DB'den okunur. */
  const numaraOku = async (tablo, kolon, id) => (await sql(`SELECT "${kolon}" v FROM "${tablo}" WHERE id=$1`, [id]))[0]?.v ?? null;
  const depo = async () => (await sql(`SELECT id FROM warehouses WHERE "isActive" ORDER BY (code='DP-MERKEZ') DESC, "createdAt" LIMIT 1`))[0]?.id;
  const kumas = async () => (await sql(`SELECT id FROM items WHERE "isActive" AND "itemType"='FABRIC' ORDER BY "createdAt" DESC LIMIT 1`))[0]?.id;
  const yeniDepo = async () => zorunlu(await api("/api/warehouses", { method: "POST", body: JSON.stringify({ name: `TEST-E5 Depo ${K()}` }) }), "depo").id;
  const belgeYok = (neden) => async () => ({ uygulanmaz: neden });

  // ── E2 depo-ticaret dilimi (TAM kip): biçim · varyantlar · yürürlük ─────────
  const depoTicaret = {
    // ÇEKİ LİSTESİ — numara yalnız API'de doğar; panelde ve tablette çağıran yok, belge türü yok (K23).
    manifest: {
      tablo: { tablo: "manifests", kolon: "manifestNo" }, okutulur: false,
      yeniOnEk: "CLZ", varyantlar: [{ dateSegment: "NONE" }, { separator: "-", separator2: "/" }], yururluk: "CLY",
      hazirla: async (dur) => { dur.cekiIsEmri ??= (await sql(`SELECT id FROM work_orders ORDER BY "createdAt" DESC LIMIT 1`))[0]?.id; if (!dur.cekiIsEmri) throw new Error("iş emri yok"); },
      eskiKayit: () => eskiSec("manifests", "manifestNo"),
      ac: async (dur) => { const d = zorunlu(await api(`/api/work-orders/${dur.cekiIsEmri}/manifest`, { method: "POST", body: "{}" }), "çeki listesi"); return { id: d.id, numara: await numaraOku("manifests", "manifestNo", d.id) }; },
      ekran: async () => ({ uygulanmaz: "CL numarası bugün hiçbir panel/tablet yüzeyinde yok — numara DB'den ölçüldü (K23)" }),
      belge: belgeYok("CL için belge türü yok (snapshot JSON)"),
    },
    goodsReceipt: {
      tablo: { tablo: "goods_receipts", kolon: "receiptNo" }, okutulur: false,
      yeniOnEk: "MKZ", varyantlar: [{ dateSegment: "NONE" }, { separator: "-", separator2: "/" }],
      hazirla: async () => {},
      eskiKayit: () => eskiSec("goods_receipts", "receiptNo"),
      ac: async () => { const d = zorunlu(await api("/api/goods-receipts", { method: "POST", body: JSON.stringify({ warehouseId: await depo(), lines: [{ itemId: await kumas(), initialQty: 10 }], clientToken: crypto.randomUUID() }) }), "mal kabul"); return { id: d.id, numara: await numaraOku("goods_receipts", "receiptNo", d.id) }; },
      ekran: (dur, k, eski) => listede("Mal Kabul", /Fiş no veya tedarikçi/, [k.numara, eski]),
      belge: (dur, k) => belgeHtml("GOODS_RECEIPT", k.id, k.numara),
    },
    purchaseOrder: {
      tablo: { tablo: "purchase_orders", kolon: "orderNo" }, okutulur: false,
      yeniOnEk: "ASZ", varyantlar: [{ dateSegment: "NONE" }],
      hazirla: async (dur) => { dur.tedarikci ??= zorunlu(await api("/api/customers", { method: "POST", body: JSON.stringify({ name: `TEST-E5T${K()} Tedarikçi`, isSupplierRole: true }) }), "tedarikçi").id; },
      eskiKayit: () => eskiSec("purchase_orders", "orderNo"),
      ac: async (dur) => { const d = zorunlu(await api("/api/purchase-orders", { method: "POST", body: JSON.stringify({ supplierId: dur.tedarikci, lines: [{ itemId: await kumas(), qty: 5 }], clientToken: crypto.randomUUID() }) }), "alış siparişi"); return { id: d.id, numara: await numaraOku("purchase_orders", "orderNo", d.id) }; },
      ekran: (dur, k, eski) => listede("Alış Siparişleri", /Sipariş no \/ tedarikçi/, [k.numara, eski]),
      belge: belgeYok("alış siparişinin belge türü yok"),
    },
    warehouseTransfer: {
      tablo: { tablo: "warehouse_transfers", kolon: "transferNo" }, okutulur: false,
      yeniOnEk: "DTZ", varyantlar: [{ separator: "-", separator2: "/" }],
      hazirla: async (dur) => { dur.hedefDepo ??= await yeniDepo(); },
      eskiKayit: () => eskiSec("warehouse_transfers", "transferNo"),
      ac: async (dur) => {
        const [top] = await sql(`SELECT id, "warehouseId" w FROM rolls WHERE status='WAREHOUSE' AND "warehouseId" IS NOT NULL AND "warehouseId"<>$1 AND "sackId" IS NULL AND "shipmentId" IS NULL ORDER BY "updatedAt" DESC LIMIT 1`, [dur.hedefDepo]);
        if (!top) throw new Error("transfer edilecek depo topu yok");
        const d = zorunlu(await api("/api/warehouse-transfers", { method: "POST", body: JSON.stringify({ fromWarehouseId: top.w, toWarehouseId: dur.hedefDepo, rollIds: [top.id], clientToken: crypto.randomUUID() }) }), "transfer");
        return { id: d.id, numara: await numaraOku("warehouse_transfers", "transferNo", d.id) };
      },
      ekran: (dur, k, eski) => listede("Depo Transferi", null, [k.numara, eski]),
      belge: (dur, k) => belgeHtml("TRANSFER_DISPATCH", k.id, k.numara),
    },
    stockCount: {
      tablo: { tablo: "stock_counts", kolon: "countNo" }, okutulur: false,
      yeniOnEk: "SAYZ", varyantlar: [{ dateSegment: "NONE" }],
      hazirla: async () => {},
      eskiKayit: () => eskiSec("stock_counts", "countNo"),
      // Depo başına tek açık sayım → her kayıt için yeni depo.
      ac: async () => { const d = zorunlu(await api("/api/stock-counts", { method: "POST", body: JSON.stringify({ warehouseId: await yeniDepo() }) }), "sayım"); return { id: d.id, numara: await numaraOku("stock_counts", "countNo", d.id) }; },
      ekran: (dur, k, eski) => listede("Stok Sayımı", /Sayım no ara/, [k.numara, eski]),
      belge: (dur, k) => belgeHtml("STOCK_COUNT", k.id, k.numara, `/api/printed-documents/STOCK_COUNT/${k.id}/html?draft=1`),
    },
    freeDocument: {
      tablo: { tablo: "free_documents", kolon: "documentNo" }, okutulur: false,
      yeniOnEk: "SBZ", varyantlar: [{ dateSegment: "YYMM" }],
      hazirla: async () => {},
      eskiKayit: () => eskiSec("free_documents", "documentNo"),
      ac: async () => { const d = zorunlu(await api("/api/free-documents", { method: "POST", body: JSON.stringify({ title: `TEST-E5 Serbest ${K()}` }) }), "serbest belge"); return { id: d.id, numara: await numaraOku("free_documents", "documentNo", d.id) }; },
      ekran: (dur, k, eski) => listede("Serbest Belgeler", null, [k.numara, eski]),
      belge: (dur, k) => belgeHtml(null, k.id, k.numara, `/api/free-documents/${k.id}/html`),
    },
  };

  return {
    ...depoTicaret,
    invoiceSales: fatura("SALES", "Faturalar"),
    invoicePurchase: fatura("PURCHASE", "Faturalar"),
    invoiceSalesReturn: fatura("SALES_RETURN", "Faturalar"),
    invoicePurchaseReturn: fatura("PURCHASE_RETURN", "Faturalar"),
    paymentIn: odeme("IN"),
    paymentOut: odeme("OUT"),
    cashTransaction: {
      tablo: { tablo: "cash_transactions", kolon: "docNo" }, okutulur: false,
      hazirla: kasa,
      eskiKayit: () => eskiSec("cash_transactions", "docNo"),
      ac: async (dur) => { const d = zorunlu(await api("/api/finance/cash-transactions", { method: "POST", body: JSON.stringify({ kind: "INCOME", cashBoxId: dur.kasa.id, amount: "3", clientToken: crypto.randomUUID() }) }), "kasa fişi"); return { id: d.id, numara: d.docNo }; },
      ekran: (dur, k, eski) => listede("Kasa Hareketleri", /Belge no \/ kategori/, [k.numara, eski]),
      belge: null, // PrintedDocType'ta kasa fişi yok
    },
    chequeReceived: cek("RECEIVED", "CHEQUE"),
    chequeIssued: cek("ISSUED", "CHEQUE"),
    noteReceived: cek("RECEIVED", "PROMISSORY_NOTE"),
    noteIssued: cek("ISSUED", "PROMISSORY_NOTE"),
    chequeDeliveryNote: {
      tablo: { tablo: "cheque_delivery_notes", kolon: "docNo" }, okutulur: false,
      hazirla: finansCari,
      eskiKayit: () => eskiSec("cheque_delivery_notes", "docNo"),
      ac: async (dur) => {
        const ck = zorunlu(await api("/api/finance/cheques", { method: "POST", body: JSON.stringify({ kind: "RECEIVED", docType: "CHEQUE", customerId: dur.finCari.customerId, amount: "9", dueDate: ileri(40), clientToken: crypto.randomUUID() }) }), "bordro çeki");
        const d = zorunlu(await api("/api/finance/cheque-delivery-notes", { method: "POST", body: JSON.stringify({ chequeIds: [ck.id] }) }), "bordro");
        return { id: d.id, numara: d.docNo };
      },
      // Liste yalnız "Çek / Senet → Bordrolar" diyaloğunda — belge ucu birincil ölçüm.
      ekran: async () => ({ ekranListesiDiyalogda: true }),
      belge: (dur, k) => belgeHtml("CHEQUE_DELIVERY_NOTE", k.id, k.numara),
    },
    reconciliationLetter: {
      tablo: { tablo: "reconciliation_letters", kolon: "docNo" }, okutulur: false,
      hazirla: finansCari,
      eskiKayit: () => eskiSec("reconciliation_letters", "docNo"),
      ac: async (dur) => { const d = zorunlu(await api("/api/finance/reconciliation-letters", { method: "POST", body: JSON.stringify({ cariId: dur.finCari.cariId }) }), "mektup"); return { id: d.id, numara: d.docNo }; },
      ekran: async () => ({ ekranListesiDiyalogda: true }), // Cari Hesaplar → Ekstre → Mektuplar
      belge: (dur, k) => belgeHtml("RECONCILIATION_LETTER", k.id, k.numara),
    },

    // ── master veri kodları ──────────────────────────────────────────────────
    customer: {
      ...kod({ tablo: "customers", uc: "/api/customers", sayfa: "Cariler", arama: /Ad \/ kod \/ vergi no ara/, hazirla: modulAc, yeniOnEk: "MUSZ",
        // Finans AÇIK yolu: Cariler → "Yeni Cari" → ad → Müşteri rolü → Kaydet.
        panel: { sayfa: "Cariler", dugme: "Yeni Cari", doldur: async (d) => { const k = d.locator('input[type="checkbox"][name="isCustomerRole"]'); if (!(await k.isChecked())) await k.check(); } } }),
      // Finans KAPALI yolu: Müşteriler (CrudPage) → Yeni → ad → Kaydet. Modül anahtarı yalnız sistem hesabıyla çevrilir.
      ikinciYol: async () => {
        const once = (await c.sistemApi("/api/feature-flags")).govde?.data?.financeEnabled;
        const kapat = await c.sistemApi("/api/feature-flags", { method: "PATCH", headers: c.sifreBasligi, body: JSON.stringify({ financeEnabled: false }) });
        if (kapat.status >= 300) throw new Error(`finans kapatılamadı: ${kapat.status}`);
        try {
          await page.reload(); await page.waitForTimeout(3500);
          const d = await panelYeni({ sayfa: "Müşteriler", uc: "/api/customers", ad: `TEST-E5K ${K()}` });
          const ekran = await listede("Müşteriler", /Kod, ad veya vergi no ara/, [d.code]);
          return { yol: "finans kapalı → Müşteriler", numara: d.code, ekran };
        } finally {
          await c.sistemApi("/api/feature-flags", { method: "PATCH", headers: c.sifreBasligi, body: JSON.stringify({ financeEnabled: once ?? true }) });
          await page.reload(); await page.waitForTimeout(3500);
        }
      },
    },
    // K20 adayı: zod `code` zorunlu, panel kod göndermiyor → otomatik FSN yolu HTTP'den ölçülür (400 beklenir).
    // Fason firma kartı finans AÇIKKEN ayrı ekranda yok (Cariler → Fason iş yapar); kayıt API'den açılır.
    subcontractor: {
      ...kod({ tablo: "subcontractors", uc: "/api/subcontractors", govde: () => ({ name: `TEST-E5 Fason ${K()}` }), sayfa: "Fason Firmalar", arama: /Ad veya kod ara/, yeniOnEk: "FSNZ" }),
      // "Fason Firmalar" ekranı yalnız finans KAPALIYKEN var; finans açıkken FSN kodu hiçbir listede görünmez
      // (fason = cari kartının rolü, kodu MUS). Ekran bu yüzden finans kapalı rejimde ölçülür.
      ekran: async (dur, k, eski) => {
        const once = (await c.sistemApi("/api/feature-flags")).govde?.data?.financeEnabled;
        await c.sistemApi("/api/feature-flags", { method: "PATCH", headers: c.sifreBasligi, body: JSON.stringify({ financeEnabled: false }) });
        try {
          await page.reload(); await page.waitForTimeout(3500);
          return await listede("Fason Firmalar", /Ad veya kod ara/, [k.numara, eski]);
        } finally {
          await c.sistemApi("/api/feature-flags", { method: "PATCH", headers: c.sifreBasligi, body: JSON.stringify({ financeEnabled: once ?? true }) });
          await page.reload(); await page.waitForTimeout(3500);
        }
      },
    },
    subcontractorCategory: kod({ tablo: "subcontractor_categories", uc: "/api/subcontractor-categories", sayfa: "Fason Kategorileri", arama: /Ad ara/, yeniOnEk: "KATZ", panel: { sayfa: "Fason Kategorileri" } }),
    fabricProperty: kod({
      tablo: "fabric_properties", uc: "/api/fabric-properties", sayfa: "Kumaş Özellikleri", arama: null, yeniOnEk: "OZLZ",
      govde: async (dur) => {
        if (!dur.ozellikIstasyonu) dur.ozellikIstasyonu = zorunlu(await api("/api/stations", { method: "POST", body: JSON.stringify({ name: `TEST-E5 Özellik İst ${K()}`, type: "INTERNAL", appliesProperty: true }) }), "istasyon").id;
        return { name: `TEST-E5 Özellik ${K()}`, stationIds: [dur.ozellikIstasyonu] };
      },
    }),
    item: kod({ tablo: "items", uc: "/api/items", sayfa: "Ürünler", arama: /Kod veya ad ara/, yeniOnEk: "STKZ", panel: { sayfa: "Ürünler" } }),
    color: kod({ tablo: "colors", uc: "/api/colors", sayfa: "Renkler", arama: /Kod veya ad ara/, yeniOnEk: "RNKZ", panel: { sayfa: "Renkler" } }),
    station: kod({ tablo: "stations", uc: "/api/stations", govde: () => ({ name: `TEST-E5 İstasyon ${K()}`, type: "INTERNAL" }), sayfa: "Üretim İstasyonları", arama: /İstasyon \/ makine ara/, yeniOnEk: "ISTZ" }),
    machine: kod({
      tablo: "machines", uc: "/api/machines", sayfa: "Makineler", arama: /Kod veya ad ara/, yeniOnEk: "MAKZ",
      govde: async (dur) => {
        if (!dur.makineIstasyonu) dur.makineIstasyonu = zorunlu(await api("/api/stations", { method: "POST", body: JSON.stringify({ name: `TEST-E5 Makine İst ${K()}`, type: "INTERNAL" }) }), "istasyon").id;
        return { stationId: dur.makineIstasyonu, name: `TEST-E5 Makine ${K()}` };
      },
    }),
    cashAccount: kod({ tablo: "cash_boxes", uc: "/api/finance/cash-boxes", govde: () => ({ name: `TEST-E5 Kasa ${K()}` }), sayfa: "Kasa & Banka", arama: null, hazirla: modulAc, yeniOnEk: "KSZ" }),
    bankAccount: kod({ tablo: "bank_accounts", uc: "/api/finance/bank-accounts", govde: () => ({ name: `TEST-E5 Banka ${K()}` }), sayfa: "Kasa & Banka", arama: null, hazirla: modulAc, yeniOnEk: "BNZ" }),
    returnReason: kod({ tablo: "return_reasons", uc: "/api/return-reasons", sayfa: "İade Nedenleri", arama: /Kod veya ad ara/, yeniOnEk: "IANZ", panel: { sayfa: "İade Nedenleri" } }),
    productRecipe: kod({
      tablo: "product_recipes", uc: "/api/product-recipes", sayfa: "İş Emri Şablonları", arama: /Şablon adı veya kodu ara/, hazirla: modulAc, yeniOnEk: "RECZ",
      govde: async () => { const [i] = await sql(`SELECT id FROM items WHERE "isActive" AND "itemType"='FABRIC' ORDER BY "createdAt" DESC LIMIT 1`); return { name: `TEST-E5 Şablon ${K()}`, itemId: i?.id }; },
    }),
    defectType: kod({ tablo: "defect_types", uc: "/api/defect-types", sayfa: "Hata Tipleri", arama: /Kod veya ad ara/, yeniOnEk: "HATZ", panel: { sayfa: "Hata Tipleri" } }),
    warehouse: kod({ tablo: "warehouses", uc: "/api/warehouses", sayfa: "Depolar", arama: /Kod veya depo adı ara/, yeniOnEk: "DPZ", panel: { sayfa: "Depolar" } }),
    // Rota listesi arka uçta YALNIZ ad arar (kodla aranamaz) → arama kutusuna ADI yaz, kodu ekranda ara.
    routeTemplate: {
      tablo: { tablo: "routes", kolon: "code" }, okutulur: false, hazirla: modulAc, yeniOnEk: "ROTZ",
      eskiKayit: () => eskiSec("routes", "code"),
      ac: async () => { const ad = `TEST-E5 Rota ${K()}`; const d = zorunlu(await api("/api/routes", { method: "POST", body: JSON.stringify({ name: ad }) }), "rota"); return { id: d.id, numara: d.code, ad }; },
      ekran: async (dur, k) => {
        await gitSayfa("Üretim Rotaları"); await page.waitForTimeout(800);
        const ara = page.getByPlaceholder(/Rota adı ara/).filter({ visible: true }).first();
        if (await ara.count()) { await ara.fill(k.ad); await page.waitForTimeout(1500); }
        return { [k.numara]: (await page.getByText(k.numara, { exact: true }).filter({ visible: true }).count()) > 0 };
      },
      belge: null,
    },
  };
}
