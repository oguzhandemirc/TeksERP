import type { DispatchReport } from "./types";

const num2 = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("tr-TR");
};

/**
 * Saha #2 — Muhasebe sevk fişi (ornek-fis.pdf birebir): 3 bölüm, her biri ayrı
 * sayfa (page-break). printDocumentArea ile basılır (.print-area). Salt görsel —
 * veri backend getDispatchReport'tan gelir.
 */
export function DispatchReceiptDocument({ report }: { report: DispatchReport }) {
  const { header, products, sacks, cekiRows, totals } = report;

  const Head = ({ title }: { title: string }) => (
    <>
      <h1 style={S.h1}>{title}</h1>
      <div style={S.metaRow}>
        <div>
          <div>Sevk Edilen Firma : {header.customerName}</div>
          <div>Sevkiyat Fiş No&nbsp;&nbsp;: {header.shipmentNo}</div>
          {header.procedureCode && <div>Prosedür / İhracat No : {header.procedureCode}</div>}
        </div>
        <div style={S.date}>{fmtDate(header.date)}</div>
      </div>
    </>
  );

  return (
    <div className="print-area" style={S.page}>
      {/* ── 1) ÜRÜN LİSTESİ ── */}
      <section>
        <Head title="ÜRÜN LİSTESİ" />
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.thL}>STOK ADI</th>
              <th style={S.thR}>TOP ADEDİ</th>
              <th style={S.thR}>TOPLAM METRE</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p, i) => (
              <tr key={i}>
                <td style={S.tdL}>{p.name}</td>
                <td style={S.tdR}>{num2(p.rollCount)}</td>
                <td style={S.tdR}>{num2(p.totalMeters)}</td>
              </tr>
            ))}
            <tr>
              <td style={S.tdTotalL}></td>
              <td style={S.tdTotalR}>{num2(totals.totalRolls)}</td>
              <td style={S.tdTotalR}>{num2(totals.totalMeters)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* ── 2) ÇUVAL LİSTESİ ── */}
      <section style={S.break}>
        <Head title="ÇUVAL LİSTESİ" />
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.thL}>AMBALAJ KODU</th>
              <th style={S.thR}>METRE TOPLAMI</th>
              <th style={S.thR}>KG TOPLAMI</th>
              <th style={S.thR}>PAKET SAYISI</th>
            </tr>
          </thead>
          <tbody>
            {sacks.map((s, i) => (
              <tr key={i}>
                <td style={S.tdL}>{s.code}</td>
                <td style={S.tdR}>{num2(s.totalMeters)}</td>
                <td style={S.tdR}>{num2(s.totalKg)}</td>
                <td style={S.tdR}>{num2(s.packageCount)}</td>
              </tr>
            ))}
            <tr>
              <td style={S.tdTotalL}></td>
              <td style={S.tdTotalR}>{num2(totals.totalMeters)}</td>
              <td style={S.tdTotalR}>{num2(totals.totalKg)}</td>
              <td style={S.tdTotalR}>{num2(totals.totalRolls)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* ── 3) ÇEKİ LİSTESİ ── */}
      <section style={S.break}>
        <Head title="ÇEKİ LİSTESİ" />
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.thL}>ÇUVAL NO</th>
              <th style={S.thL}>BARKOD NO</th>
              <th style={S.thL}>DESEN</th>
              <th style={S.thL}>VARYANT</th>
              <th style={S.thR}>METRE</th>
              <th style={S.thR}>KG</th>
            </tr>
          </thead>
          <tbody>
            {cekiRows.map((c, i) => (
              <tr key={i}>
                <td style={S.tdL}>{c.sackCode}</td>
                <td style={S.tdL}>{c.barcode ?? "—"}</td>
                <td style={S.tdL}>{c.desen}</td>
                <td style={S.tdL}>{c.varyant}</td>
                <td style={S.tdR}>{num2(c.meters)}</td>
                <td style={S.tdR}>{c.kg > 0 ? num2(c.kg) : ""}</td>
              </tr>
            ))}
            <tr>
              <td style={S.tdTotalL} colSpan={4}></td>
              <td style={S.tdTotalR}>{num2(totals.totalMeters)}</td>
              <td style={S.tdTotalR}>{num2(totals.totalKg)}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  page: { fontFamily: "Arial, sans-serif", color: "#000", fontSize: "11px", background: "#fff" },
  h1: {
    textAlign: "center",
    fontSize: "20px",
    fontWeight: "bold",
    border: "1px solid #000",
    padding: "10px",
    margin: "0 0 16px",
  },
  metaRow: { display: "flex", justifyContent: "space-between", marginBottom: "12px", lineHeight: 1.5 },
  date: { fontWeight: "bold" },
  table: { width: "100%", borderCollapse: "collapse", border: "1px solid #000" },
  thL: { border: "1px solid #000", padding: "3px 6px", textAlign: "left", background: "#fff" },
  thR: { border: "1px solid #000", padding: "3px 6px", textAlign: "right", background: "#fff" },
  tdL: { border: "1px solid #000", padding: "2px 6px", textAlign: "left" },
  tdR: { border: "1px solid #000", padding: "2px 6px", textAlign: "right" },
  tdTotalL: { borderTop: "1px solid #000", padding: "2px 6px" },
  tdTotalR: { borderTop: "1px solid #000", padding: "2px 6px", textAlign: "right", fontWeight: "bold" },
  break: { breakBefore: "page", pageBreakBefore: "always", marginTop: "24px" },
};
