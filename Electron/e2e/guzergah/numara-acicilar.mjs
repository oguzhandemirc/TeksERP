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
      let r = await c.bayrakYaz({ financeEnabled: true, productionEnabled: true });
      if (r.status === 403) r = await c.sistemApi("/api/feature-flags", { method: "PATCH", headers: c.sifreBasligi, body: JSON.stringify({ financeEnabled: true, productionEnabled: true }) });
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

  // ── OKUTULAN AİLE (TAM kip; eksen kilidi: ana değişiklik SERBEST eksende — hane 5) ─────────────
  const stokTop = async () => (await sql(`SELECT barcode FROM rolls WHERE status='STOCK' AND barcode IS NOT NULL AND "sackId" IS NULL AND "shipmentId" IS NULL ORDER BY "updatedAt" DESC LIMIT 1`))[0]?.barcode;
  const depoTopu = async () => (await sql(`SELECT id FROM rolls WHERE status='WAREHOUSE' AND "warehouseId" IS NOT NULL AND "sackId" IS NULL AND "shipmentId" IS NULL AND barcode IS NOT NULL ORDER BY "updatedAt" DESC LIMIT 1`))[0]?.id;
  const icIstasyon = async () => (await sql(`SELECT id FROM stations WHERE "isActive" AND type='INTERNAL' ORDER BY "createdAt" LIMIT 1`))[0]?.id;
  /** Fason zinciri: EXTERNAL istasyon + o kategoriyi veren fasoncu → quick-start (ilk adımı fasona SEVK eder). */
  async function fasonSevk() {
    const [f] = await sql(`SELECT st.id istasyon, st."defaultCategoryId" kategori, l."subcontractorId" fasoncu FROM stations st JOIN subcontractor_category_links l ON l."categoryId"=st."defaultCategoryId" JOIN subcontractors s ON s.id=l."subcontractorId" AND s."isActive" WHERE st."isActive" AND st.type='EXTERNAL' AND st."defaultCategoryId" IS NOT NULL LIMIT 1`);
    if (!f) throw new Error("fason zinciri için istasyon/kategori/fasoncu yok");
    const d = zorunlu(await api("/api/work-orders/quick-start", { method: "POST", body: JSON.stringify({ rollBarcodes: [await stokTop()], steps: [{ stationId: f.istasyon, requiredCategoryId: f.kategori, plannedSubcontractorId: f.fasoncu }, { stationId: await icIstasyon() }], dispatchFirstStep: true, clientToken: crypto.randomUUID() }) }), "fason quick-start");
    if (!d.dispatch?.id) throw new Error(`quick-start sevk üretmedi: ${JSON.stringify(d).slice(0, 200)}`);
    return { woId: d.workOrder.id, dispatchId: d.dispatch.id, fasoncu: f.fasoncu };
  }
  async function kartelaSevk(dur) {
    dur.kartelaFasoncu ??= (await sql(`SELECT id FROM subcontractors WHERE "isActive" ORDER BY "createdAt" LIMIT 1`))[0]?.id;
    const d = zorunlu(await api("/api/kartela/dispatch", { method: "POST", body: JSON.stringify({ subcontractorId: dur.kartelaFasoncu, rollIds: [await depoTopu()] }) }), "kartela sevk");
    const id = d.id ?? d.dispatch?.id;
    const [kalem] = await sql(`SELECT "rollId" FROM kartela_dispatch_items WHERE "dispatchId"=$1 LIMIT 1`, [id]);
    return { id, rollId: kalem?.rollId };
  }
  async function kartelaKabul(dur) {
    const ks = await kartelaSevk(dur);
    const d = zorunlu(await api("/api/kartela/receive", { method: "POST", body: JSON.stringify({ subcontractorId: dur.kartelaFasoncu, dispatchId: ks.id, returns: [{ rollId: ks.rollId, count: 1 }] }) }), "kartela kabul");
    const id = d.id ?? d.receipt?.id;
    return { id };
  }
  const HANE5 = { digits: 5 }; // serbest eksen — ön ek (ve iş emrinde ayraç) kilitli
  const okutulan = {
    // Sevkiyat — okutulan, eksen kilidi YOK (E4: eski istemci SVK'yı ayırt etmiyor).
    shipment: {
      tablo: { tablo: "shipments", kolon: "shipmentNo" }, okutulur: true, yeniOnEk: "SVZ",
      hazirla: async (dur) => { dur.svCari ??= zorunlu(await api("/api/customers", { method: "POST", body: JSON.stringify({ name: `TEST-E5S${K()} Cari`, isCustomerRole: true, defaultDestination: "DOMESTIC" }) }), "cari").id; },
      eskiKayit: () => eskiSec("shipments", "shipmentNo"),
      ac: async (dur) => {
        const [top] = await sql(`SELECT barcode FROM rolls WHERE status='WAREHOUSE' AND "sackId" IS NULL AND "shipmentId" IS NULL AND "ownerCustomerId" IS NULL AND barcode IS NOT NULL ORDER BY "updatedAt" DESC LIMIT 1`);
        const c = zorunlu(await api("/api/shipping/sacks", { method: "POST", body: JSON.stringify({ customerId: dur.svCari, clientToken: crypto.randomUUID() }) }), "çuval");
        zorunlu(await api(`/api/shipping/sacks/${c.id}/scan`, { method: "POST", body: JSON.stringify({ barcode: top.barcode }) }), "okutma");
        const sv = zorunlu(await api("/api/shipping/shipments", { method: "POST", body: JSON.stringify({ sackIds: [c.id], customerId: dur.svCari, orderless: true, destination: "DOMESTIC" }) }), "sevk");
        return { id: sv.id, numara: await numaraOku("shipments", "shipmentNo", sv.id) };
      },
      ekran: (dur, k, eski) => listede("Sevkiyatlar", /Sevkiyat no, firma/, [k.numara, eski]),
      belge: (dur, k) => belgeHtml("SHIPMENT_DISPATCH", k.id, k.numara),
    },
    workOrder: {
      tablo: { tablo: "work_orders", kolon: "workOrderNumber" }, okutulur: true, anaDegisim: HANE5, varyantlar: [{ dateSegment: "YYMM" }],
      hazirla: async () => {},
      eskiKayit: () => eskiSec("work_orders", "workOrderNumber"),
      ac: async () => {
        const d = zorunlu(await api("/api/work-orders/quick-start", { method: "POST", body: JSON.stringify({ rollBarcodes: [await stokTop()], steps: [{ stationId: await icIstasyon() }], clientToken: crypto.randomUUID() }) }), "quick-start");
        return { id: d.workOrder.id, numara: await numaraOku("work_orders", "workOrderNumber", d.workOrder.id) };
      },
      ekran: (dur, k, eski) => listede("İş Emirleri", /İş emri, parti/, [k.numara, eski]),
      belge: async (dur, k) => {
        const [kart] = await sql(`SELECT id FROM traveler_cards WHERE "workOrderId"=$1 ORDER BY "createdAt" DESC LIMIT 1`, [k.id]);
        return kart ? belgeHtml(null, kart.id, k.numara, `/api/traveler-cards/${kart.id}/html`) : { hata: "refakat kartı doğmadı" };
      },
    },
    subcontractorDispatch: {
      tablo: { tablo: "subcontractor_dispatches", kolon: "dispatchNo" }, okutulur: true, anaDegisim: HANE5, varyantlar: [{ dateSegment: "NONE" }],
      hazirla: async () => {},
      eskiKayit: () => eskiSec("subcontractor_dispatches", "dispatchNo"),
      ac: async () => { const f = await fasonSevk(); return { id: f.dispatchId, numara: await numaraOku("subcontractor_dispatches", "dispatchNo", f.dispatchId) }; },
      ekran: async () => ({ uygulanmaz: "fason sevkin genel listesi yok (iş emri şeridinde) — belge ve okutma ölçülür" }),
      belge: (dur, k) => belgeHtml("SUBCONTRACTOR_DISPATCH", k.id, k.numara),
    },
    subcontractorReceipt: {
      tablo: { tablo: "subcontractor_receipts", kolon: "receiptNo" }, okutulur: true, anaDegisim: HANE5,
      hazirla: async () => {},
      eskiKayit: () => eskiSec("subcontractor_receipts", "receiptNo"),
      ac: async () => {
        const f = await fasonSevk();
        const [adim] = await sql(`SELECT id FROM work_order_steps WHERE "workOrderId"=$1 ORDER BY "stepSequence" LIMIT 1`, [f.woId]);
        const [kalem] = await sql(`SELECT "rollId" FROM subcontractor_dispatch_items WHERE "dispatchId"=$1 LIMIT 1`, [f.dispatchId]);
        // Boyahane adımı hedef rengi olmayan iş emrinde kabulde uygulanan rengi ister.
        const [renk] = await sql(`SELECT id FROM colors WHERE "isActive" ORDER BY "createdAt" LIMIT 1`);
        const d = zorunlu(await api("/api/subcontractor/receive", { method: "POST", body: JSON.stringify({ workOrderId: f.woId, stepId: adim.id, subcontractorId: f.fasoncu, returns: [{ rollId: kalem.rollId }], newRolls: [{ qty: 10 }], appliedColorId: renk?.id, clientToken: crypto.randomUUID() }) }), "fason kabul");
        const id = d.id ?? d.receipt?.id ?? (await sql(`SELECT id FROM subcontractor_receipts ORDER BY "createdAt" DESC LIMIT 1`))[0].id;
        return { id, numara: await numaraOku("subcontractor_receipts", "receiptNo", id) };
      },
      ekran: async () => ({ uygulanmaz: "fason kabulün genel listesi yok — belge ve okutma ölçülür" }),
      belge: (dur, k) => belgeHtml("SUBCONTRACTOR_RECEIPT", k.id, k.numara),
    },
    directShipment: {
      tablo: { tablo: "direct_shipments", kolon: "shipmentNo" }, okutulur: false, yeniOnEk: "DSKZ",
      hazirla: async (dur) => { dur.dsCari ??= zorunlu(await api("/api/customers", { method: "POST", body: JSON.stringify({ name: `TEST-E5D${K()} Cari`, isCustomerRole: true, defaultDestination: "DOMESTIC" }) }), "cari").id; },
      eskiKayit: () => eskiSec("direct_shipments", "shipmentNo"),
      ac: async (dur) => {
        const f = await fasonSevk();
        const d = zorunlu(await api(`/api/subcontractor/dispatches/${f.dispatchId}/direct-ship`, { method: "POST", body: JSON.stringify({ reason: "E5 kabul turu", customerId: dur.dsCari, orderless: true }) }), "fasondan sevk");
        // Yanıt şekli değişken (sevk + doğrudan sevk birlikte döner) → bu sevkin doğrudan sevki DB'den.
        void d;
        const id = (await sql(`SELECT id FROM direct_shipments ORDER BY "createdAt" DESC LIMIT 1`))[0].id;
        return { id, numara: await numaraOku("direct_shipments", "shipmentNo", id) };
      },
      ekran: (dur, k, eski) => listede("Sevkiyatlar", /Sevkiyat no, firma/, [k.numara, eski]),
      belge: (dur, k) => belgeHtml("SUBCONTRACTOR_DIRECT_SHIP", k.id, k.numara),
    },
    kartelaDispatch: {
      tablo: { tablo: "kartela_dispatches", kolon: "dispatchNo" }, okutulur: true, anaDegisim: HANE5, varyantlar: [{ dateSegment: "NONE" }],
      hazirla: async () => {},
      eskiKayit: () => eskiSec("kartela_dispatches", "dispatchNo"),
      ac: async (dur) => { const ks = await kartelaSevk(dur); return { id: ks.id, numara: await numaraOku("kartela_dispatches", "dispatchNo", ks.id) }; },
      ekran: (dur, k, eski) => listede("Kartela Takibi", /Ara ya da barkod okut/, [k.numara, eski]),
      belge: (dur, k) => belgeHtml("KARTELA_DISPATCH", k.id, k.numara),
    },
    kartelaReceipt: {
      tablo: { tablo: "kartela_receipts", kolon: "receiptNo" }, okutulur: true, anaDegisim: HANE5,
      hazirla: async () => {},
      eskiKayit: () => eskiSec("kartela_receipts", "receiptNo"),
      ac: async (dur) => { const kk = await kartelaKabul(dur); return { id: kk.id, numara: await numaraOku("kartela_receipts", "receiptNo", kk.id) }; },
      ekran: async (dur, k, eski) => {
        await gitSayfa("Kartela Takibi"); await page.waitForTimeout(800);
        await page.getByText("Kabuller", { exact: false }).filter({ visible: true }).first().click({ timeout: 10_000 }).catch(() => undefined);
        await page.waitForTimeout(800);
        const out = {};
        for (const d of [k.numara, eski].filter(Boolean)) {
          const ara = page.getByPlaceholder(/Ara ya da barkod okut/).filter({ visible: true }).first();
          if (await ara.count()) { await ara.fill(d); await page.waitForTimeout(1500); }
          out[d] = (await page.getByText(new RegExp(`(?<![A-Z0-9])${d}(?![0-9])`)).filter({ visible: true }).count()) > 0;
        }
        return out;
      },
      belge: belgeYok("kartela kabulün belge türü yok"),
    },
    swatch: {
      tablo: { tablo: "swatches", kolon: "cardNumber" }, okutulur: true, anaDegisim: HANE5,
      hazirla: async () => {},
      eskiKayit: () => eskiSec("swatches", "cardNumber"),
      ac: async (dur) => {
        const kk = await kartelaKabul(dur);
        const [sw] = await sql(`SELECT id, "cardNumber" v FROM swatches WHERE "parentReceiptId"=$1 ORDER BY "createdAt" DESC LIMIT 1`, [kk.id]);
        return { id: sw.id, numara: sw.v };
      },
      ekran: async () => ({ uygulanmaz: "kartela kartı listede numarasıyla gösterilmez (okutma + etiket ölçülür)" }),
      belge: (dur, k) => belgeHtml(null, k.id, k.numara, `/api/labels/swatches/${k.id}/html`),
    },
  };

  // ── E2 üretim dilimi: sipariş · dokuma işi · levent · doff (TAM kip; hiçbiri okutulmaz) ──
  /** Modül anahtarı (dokuma/devere) yalnız sistem hesabıyla çevrilir (MODULE_FLAG_SUPERADMIN_ONLY); panel bayrağı reload ile görür. */
  async function uretimModulu(dur, anahtarlar) {
    const f = (await api("/api/feature-flags")).govde?.data ?? {};
    const eksik = anahtarlar.filter((k) => !f[k]);
    if (!eksik.length) return;
    dur.bayrakOnce = { ...Object.fromEntries(eksik.map((k) => [k, f[k] ?? false])), ...(dur.bayrakOnce ?? {}) };
    const r = await c.sistemApi("/api/feature-flags", { method: "PATCH", headers: c.sifreBasligi, body: JSON.stringify(Object.fromEntries(eksik.map((k) => [k, true]))) });
    if (r.status >= 300) throw new Error(`modül ${eksik.join(",")}: ${r.status} ${JSON.stringify(r.govde).slice(0, 200)}`);
    await page.reload(); await page.waitForTimeout(3500);
  }
  /** Denyeli aktif iplik → çözgü kartı (kod ELLE; otomatik kod yok). */
  async function cozguKarti(dur) {
    if (dur.cozgu) return dur.cozgu;
    let [iplik] = await sql(`SELECT id FROM items WHERE "isActive" AND "itemType"='YARN' AND "linearDensityDen" IS NOT NULL ORDER BY "createdAt" DESC LIMIT 1`);
    if (!iplik) iplik = zorunlu(await api("/api/items", { method: "POST", body: JSON.stringify({ name: `TEST-E5 İplik ${K()}`, itemType: "YARN", unit: "KG", linearDensityDen: 150 }) }), "iplik");
    const k = K();
    dur.cozgu = zorunlu(await api("/api/warp-specs", { method: "POST", body: JSON.stringify({ code: `TE5${k}`, name: `TEST-E5 Çözgü ${k}`, yarnItemId: iplik.id, endsCount: 4000 }) }), "çözgü kartı").id;
    return dur.cozgu;
  }
  const VAR2 = [{ dateSegment: "NONE" }, { separator: "-", separator2: "/" }];
  const uretimSerileri = {
    order: {
      tablo: { tablo: "orders", kolon: "orderNumber" }, okutulur: false, yeniOnEk: "SIPZ", varyantlar: VAR2,
      hazirla: async (dur) => { dur.sipCari ??= zorunlu(await api("/api/customers", { method: "POST", body: JSON.stringify({ name: `TEST-E5O${K()} Cari`, isCustomerRole: true, defaultDestination: "DOMESTIC" }) }), "cari").id; },
      eskiKayit: () => eskiSec("orders", "orderNumber"),
      ac: async (dur) => {
        const d = zorunlu(await api("/api/orders", { method: "POST", body: JSON.stringify({ customerId: dur.sipCari, lines: [{ itemId: await kumas(), quantity: 10 }], clientToken: crypto.randomUUID() }) }), "sipariş");
        return { id: d.id, numara: await numaraOku("orders", "orderNumber", d.id) };
      },
      ekran: (dur, k, eski) => listede("Siparişler", /Sipariş no, iş emri no/, [k.numara, eski]),
      belge: belgeYok("siparişin kendi belge türü yok"),
    },
    weavingOrder: {
      tablo: { tablo: "weaving_orders", kolon: "weavingOrderNumber" }, okutulur: false, yeniOnEk: "DKZ", varyantlar: VAR2,
      hazirla: (dur) => uretimModulu(dur, ["productionEnabled", "dokumaEnabled"]),
      eskiKayit: () => eskiSec("weaving_orders", "weavingOrderNumber"),
      ac: async () => {
        const d = zorunlu(await api("/api/weaving-orders", { method: "POST", body: JSON.stringify({ itemId: await kumas(), executionKind: "IN_HOUSE", clientToken: crypto.randomUUID() }) }), "dokuma işi");
        return { id: d.id, numara: await numaraOku("weaving_orders", "weavingOrderNumber", d.id) };
      },
      ekran: (dur, k, eski) => listede("Dokuma İşleri", /Dokuma no, kumaş/, [k.numara, eski]),
      belge: belgeYok("dokuma işinin belge türü yok"),
    },
    warpBeam: {
      tablo: { tablo: "warp_beams", kolon: "beamNo" }, okutulur: false, yeniOnEk: "LVZ", varyantlar: VAR2,
      hazirla: async (dur) => { await uretimModulu(dur, ["devereEnabled"]); await cozguKarti(dur); },
      eskiKayit: () => eskiSec("warp_beams", "beamNo"),
      ac: async (dur) => {
        const d = zorunlu(await api("/api/warp-beams", { method: "POST", body: JSON.stringify({ warpSpecId: dur.cozgu, plannedLengthM: 100, originKind: "IN_HOUSE", clientToken: crypto.randomUUID() }) }), "levent");
        return { id: d.id, numara: await numaraOku("warp_beams", "beamNo", d.id) };
      },
      ekran: (dur, k, eski) => listede("Leventler", /Levent no, gövde no/, [k.numara, eski]),
      belge: belgeYok("leventin belge/etiket türü yok"),
    },
    doffEvent: {
      tablo: { tablo: "doff_events", kolon: "code" }, okutulur: false, yeniOnEk: "DFZ", varyantlar: VAR2,
      hazirla: async (dur) => {
        await uretimModulu(dur, ["productionEnabled", "dokumaEnabled"]);
        // Koşumsuz doff 400 değil `warnings`; hat no varsayılan 1.
        dur.doffMakine ??= (await sql(`SELECT id FROM machines WHERE "isActive" ORDER BY "createdAt" LIMIT 1`))[0]?.id;
        if (!dur.doffMakine) throw new Error("aktif makine yok");
      },
      eskiKayit: () => eskiSec("doff_events", "code"),
      ac: async (dur) => {
        const d = zorunlu(await api("/api/machine-doffs", { method: "POST", body: JSON.stringify({ machineId: dur.doffMakine, pieceCount: 1, counterSource: "OPERATOR", clientToken: crypto.randomUUID() }) }), "doff");
        return { id: d.id, numara: await numaraOku("doff_events", "code", d.id) };
      },
      // Panelde doff listesi yok (yalnız tablet Tezgah + KK1 seçici) → ekran yerine API listesi ölçülür.
      ekran: async (dur, k) => {
        const r = await api(`/api/machine-doffs?machineId=${dur.doffMakine}`);
        return { uygulanmaz: "doff kodu panelde gösterilmiyor (tablet Tezgah + KK1)", apiListede: JSON.stringify(r.govde ?? {}).includes(k.numara) };
      },
      belge: belgeYok("doff'un belge türü yok"),
    },
  };

  return {
    ...uretimSerileri,
    ...okutulan,
    ...depoTicaret,
    invoiceSales: { ...fatura("SALES", "Faturalar"), yeniOnEk: "SFZ" },
    invoicePurchase: { ...fatura("PURCHASE", "Faturalar"), yeniOnEk: "AFZ" },
    invoiceSalesReturn: { ...fatura("SALES_RETURN", "Faturalar"), yeniOnEk: "SIZ" },
    invoicePurchaseReturn: { ...fatura("PURCHASE_RETURN", "Faturalar"), yeniOnEk: "AIZ" },
    paymentIn: { ...odeme("IN"), yeniOnEk: "THZ" },
    paymentOut: { ...odeme("OUT"), yeniOnEk: "ODZ" },
    cashTransaction: {
      yeniOnEk: "KHZ",
      tablo: { tablo: "cash_transactions", kolon: "docNo" }, okutulur: false,
      hazirla: kasa,
      eskiKayit: () => eskiSec("cash_transactions", "docNo"),
      ac: async (dur) => { const d = zorunlu(await api("/api/finance/cash-transactions", { method: "POST", body: JSON.stringify({ kind: "INCOME", cashBoxId: dur.kasa.id, amount: "3", clientToken: crypto.randomUUID() }) }), "kasa fişi"); return { id: d.id, numara: d.docNo }; },
      ekran: (dur, k, eski) => listede("Kasa Hareketleri", /Belge no \/ kategori/, [k.numara, eski]),
      belge: null, // PrintedDocType'ta kasa fişi yok
    },
    chequeReceived: { ...cek("RECEIVED", "CHEQUE"), yeniOnEk: "CKAZ" },
    chequeIssued: { ...cek("ISSUED", "CHEQUE"), yeniOnEk: "CKVZ" },
    noteReceived: { ...cek("RECEIVED", "PROMISSORY_NOTE"), yeniOnEk: "SNAZ" },
    noteIssued: { ...cek("ISSUED", "PROMISSORY_NOTE"), yeniOnEk: "SNVZ" },
    chequeDeliveryNote: {
      yeniOnEk: "BRDZ",
      tablo: { tablo: "cheque_delivery_notes", kolon: "docNo" }, okutulur: false,
      hazirla: finansCari,
      eskiKayit: () => eskiSec("cheque_delivery_notes", "docNo"),
      ac: async (dur) => {
        const ck = zorunlu(await api("/api/finance/cheques", { method: "POST", body: JSON.stringify({ kind: "RECEIVED", docType: "CHEQUE", customerId: dur.finCari.customerId, amount: "9", dueDate: ileri(40), clientToken: crypto.randomUUID() }) }), "bordro çeki");
        const d = zorunlu(await api("/api/finance/cheque-delivery-notes", { method: "POST", body: JSON.stringify({ chequeIds: [ck.id] }) }), "bordro");
        return { id: d.id, numara: d.docNo };
      },
      // Liste yalnız "Çek / Senet → Bordrolar" diyaloğunda — belge ucu birincil ölçüm.
      ekran: async () => ({ uygulanmaz: "liste yalnız diyalogda (Çek / Senet → Bordrolar) — belge ucu ölçülür" }),
      belge: (dur, k) => belgeHtml("CHEQUE_DELIVERY_NOTE", k.id, k.numara),
    },
    reconciliationLetter: {
      yeniOnEk: "MBTZ",
      tablo: { tablo: "reconciliation_letters", kolon: "docNo" }, okutulur: false,
      hazirla: finansCari,
      eskiKayit: () => eskiSec("reconciliation_letters", "docNo"),
      ac: async (dur) => { const d = zorunlu(await api("/api/finance/reconciliation-letters", { method: "POST", body: JSON.stringify({ cariId: dur.finCari.cariId }) }), "mektup"); return { id: d.id, numara: d.docNo }; },
      ekran: async () => ({ uygulanmaz: "liste yalnız diyalogda (Çek / Senet → Bordrolar) — belge ucu ölçülür" }), // Cari Hesaplar → Ekstre → Mektuplar
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
