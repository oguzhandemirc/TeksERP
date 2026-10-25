/**
 * İskelet örneği — veri uçları (T1B) ve Liquid önizlemesi (T4) gelene dek
 * editörün dolu hâlini göstermek için sabit HTML. `{{ … }}` yer tutucuları
 * yalnız metindir; burada çözülmez.
 */
export const SAMPLE_DOCUMENT_HTML = `
<header class="doc-head">
  <div class="doc-company">Örnek Tekstil A.Ş.<br><span class="doc-muted">Organize Sanayi Bölgesi 3. Cadde No: 12</span></div>
  <div class="doc-title">SEVK İRSALİYESİ<br><span class="doc-muted">No: {{ belge.no }}</span></div>
</header>
<section class="doc-party">
  <div><b>Sayın:</b> {{ karsi_taraf.ad }}</div>
  <div><b>Sevk tarihi:</b> {{ belge.tarih | tarih }}</div>
</section>
<table class="doc-table">
  <thead><tr><th>#</th><th>Ürün</th><th>Renk</th><th class="num">Metre</th><th class="num">Kg</th></tr></thead>
  <tbody>
    <tr><td>1</td><td>Penye kumaş 30/1</td><td>Lacivert</td><td class="num">1.250,00</td><td class="num">312,40</td></tr>
    <tr><td>2</td><td>Ribana 2x2</td><td>Ekru</td><td class="num">840,50</td><td class="num">198,75</td></tr>
    <tr><td>3</td><td>Süprem</td><td>Siyah</td><td class="num">2.010,00</td><td class="num">455,10</td></tr>
  </tbody>
</table>
<div class="doc-total">Toplam: {{ toplamlar.metre | metre }}</div>
<footer class="doc-sign">
  <div class="doc-sign-box">Teslim eden</div>
  <div class="doc-sign-box">Teslim alan</div>
</footer>`;

export const SAMPLE_DOCUMENT_CSS = `
.doc-head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:0.4mm solid #222;padding-bottom:3mm;margin-bottom:4mm;font-family:Arial, Helvetica, sans-serif;}
.doc-company{font-size:11pt;font-weight:700;}
.doc-title{font-size:15pt;font-weight:700;text-align:right;}
.doc-muted{font-size:8.5pt;font-weight:400;color:#555;}
.doc-party{display:flex;justify-content:space-between;font-size:10pt;margin-bottom:4mm;font-family:Arial, Helvetica, sans-serif;}
.doc-table{width:100%;border-collapse:collapse;font-size:9.5pt;font-family:Arial, Helvetica, sans-serif;}
.doc-table th,.doc-table td{border:0.25mm solid #444;padding:1.5mm 2mm;text-align:left;}
.doc-table th{background-color:#eeeeee;}
.doc-table .num{text-align:right;}
.doc-total{text-align:right;font-weight:700;font-size:10.5pt;margin-top:3mm;font-family:Arial, Helvetica, sans-serif;}
.doc-sign{display:flex;justify-content:space-between;gap:10mm;margin-top:18mm;}
.doc-sign-box{flex:1;border-top:0.3mm solid #222;padding-top:2mm;text-align:center;font-size:9pt;font-family:Arial, Helvetica, sans-serif;}`;
