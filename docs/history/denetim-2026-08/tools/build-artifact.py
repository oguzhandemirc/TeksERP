#!/usr/bin/env python3
import json, re, html, os
A='/Users/oad/Documents/projeler/AdnanSahin/audit'
d=json.load(open(f'{A}/findings.json',encoding='utf-8'))
F=d['bulgular']
DOMAIN=[('Sevkiyat',r'shipping|allocation|sack|order|shipment|sevk|sipari|çuval|iade|return'),
 ('Üretim',r'tambur|inventory|roll|kursun|kk1|kesim|metraj|finalize|batch|parti'),
 ('Fason',r'subcontractor|fason|kartela|swatch'),('İş emri',r'workorder|work-order|route|rota|iş emri'),
 ('Yetki',r'auth|permission|rbac|login|jwt|session|device|yetki|izin|kimlik'),
 ('Belge',r'label|document|traveler|printed|refakat|etiket|belge|kart'),
 ('Ana veri',r'master-data|merge|item|customer|color|nameFold|duplicate|ana.?veri'),
 ('Ops',r'backup|restore|db-copy|migration|kur\.ps1|deploy|archive|arşiv|offsite|yedek|ops'),
 ('Bekçi',r'scripts/test|bekçi|test_|run-all-tests'),
 ('API',r'app\.ts|routes|controller|middleware|error|latency|health|audit\.service|log')]
def dom(f):
    hay=f'{f.get("modul") or ""} {f.get("dosya") or ""} {f.get("baslik") or ""}'.lower()
    for n,p in DOMAIN:
        if re.search(p,hay,re.I): return n
    return 'Diğer'
rows=[]
for f in F:
    vi=f.get('veride_ihlal') or {}
    rows.append({'id':f['id'],'s':f['siddet'],'k':f['kanit_seviyesi'],'a':dom(f),'t':f['baslik'],
      'f':(f.get('dosya') or '').replace('Teks-Erp/','').replace('src/services/','services/'),'l':str(f.get('satir') or ''),
      'sa':vi.get('saha'),'dv':vi.get('dev'),'tur':f['tur'],'r':bool(f.get('repro_script'))})
data=json.dumps(rows,ensure_ascii=False,separators=(',',':'))

KRITIK=[
 ("Müşteriye giden mal siparişten düşülmüyor","BULGU-T2-001 · T3-002 · T3-003",
  "Çuval içeriğinin rengi/eni sipariş kaleminde yazandan farklıysa sistem uyarı vermeden malı sevk eder ama sipariş defterine tek satır yazmaz. Tabletten kurulan sevkiyatta sipariş seçme adımı hiç yok — tabletten çıkan her sevkiyat defter dışıdır.",
  "23 sevkiyatta 7.200,6 m açık · 5 sevkiyat (81 top, 3.040,2 m, 3 müşteri) tamamen defter dışı · 7 kalem hâlâ “0 sevk”","5,5 gün + geçmiş verinin onaylı düzeltilmesi"),
 ("Gece yedeğinin durduğunu kimse görmüyor","BULGU-T1-024 · T1-020",
  "Yedek alınamazsa hiçbir ekran, e-posta veya uyarı doğmuyor. Üstelik her kurulum sunucudaki yedek ayarlarını paketin boş değerleriyle eziyor — güncelleme yaptığınız gece yedek alınmamış olabilir.",
  "40 günlük defterde 1 gece yedeği kaydı · 7 yedek “dış kopya ayarlanmadı” uyarısıyla yazılmış","3,5 gün (çoğu sunucu işi)"),
 ("Stok metrajı sessizce bozulabiliyor","BULGU-T1-001 · T1-002 · T1-044",
  "Bir operatör Tambur'da topu keserken başkası aynı topu “Düzelt” ekranından güncellerse ikinci yazım birincisini eziyor. Ters yönde de olabilir; o zaman satılabilir mal sistemden kaybolur.",
  "Laboratuvarda 100 m'lik top 140,5 m oldu (10/10 tekrar) · 2 top bugün canlı olarak giriş metrajından fazla görünüyor","3,5 gün + veritabanı kuralı"),
 ("İptal edilmiş top geri alınarak olmayan mal yaratılıyor","BULGU-T1-011",
  "Tambur geri almasıyla iptal edilen kesim parçası “İptali Geri Al” ile diriltilebiliyor; metrajı ebeveyne zaten iade edilmişti, ikinci kez canlanıyor.",
  "Kopyada 50 top / 1.834,8 m bu şekilde diriltilebilir durumda","3,0 gün"),
 ("Tüm ERP 6 haneli bir sayıya bağlı, yöneticiler dahil","BULGU-T1-014 · T2-012",
  "Şifre yerine geçen 6 haneli PIN tek başına kimlik; tek savunma tek IP'ye bakan bellek içi kilit, alt ağdan aşılabiliyor.",
  "8 aktif kullanıcının 8'inde PIN var, 3'ü yönetici · fiili saldırı izi arandı, bulunmadı","4,5 gün + yönetim kararı")]

KN=[("KN-1","Kapı ile yazım arasında bir pencere var: karar transaction dışında okunuyor",37,3,10,5,"Yazma yolu iskeleti: kilit → tekrar oku → pinli claim → 409"),
 ("KN-2","Sipariş defteri sevk yolunun yan etkisi; kendi kapısı, kilidi ve bekçisi yok",15,3,5,8,"Tahsis yazımını sevkten ayrı, fail-closed bir kapıya almak"),
 ("KN-3","İdempotency ortak katman değil, uç başına yeniden icat edilen refleks",12,2,6,3,"Tek withIdempotency(key, bodyHash) sarmalayıcısı"),
 ("KN-4","Ölçüm ve iz ikinci sınıf iş: yazan var, okuyan yok",46,1,6,22,"Her sinyale bir tüketici ve bir hüküm bağlamak"),
 ("KN-5","Değişmez yalnız uygulama katmanında; merkezî durum makinesi ve DB seddi yok",16,1,3,13,"Merkezî statü geçiş tablosu + eksik DB kısıt paketi"),
 ("KN-6","Aynı iş büyüklüğünün ikinci tanımı: rapor yüzeyi operasyondan ayrı hesaplıyor",22,0,1,13,"Rapor tabanı sözlüğü — her büyüklük tek fonksiyondan"),
 ("KN-7","Bekçi kusurla aynı yerde kör ve sahaya çıkan dalda hiç koşmuyor",21,0,6,5,"CI'yı sahaya çıkan dala bağlamak + kapsam matrisi"),
 ("KN-8","İşletme katmanı kural olarak yazılı, mekanizma olarak yok",20,1,5,6,"Kurulum ayarı ezmesin; yedek yaşı bir hükme bağlansın"),
 ("KN-9","Yetki kataloğu koda taşındı, atama ve sınır insana kaldı",21,1,4,10,"Politika tek doğrulanmış ayar setinden okunsun"),
 ("KN-10","Sözleşme uç başına yazılıyor: aynı alanın dört sınırı",33,1,7,6,"Alan sözlüğü (tek Zod kaynağı) + “başarı = sunucunun 2xx'i”")]

VADE=[("ACİL","0–2 hafta",12,35,"36,0","Stok metrajını sessizce bozan tüm tetiklenmiş yollar · sipariş defterine yazılmayan sevkiyat · fasondaki malın ham stoğa düşmesi · gece yedeğinin sessiz kaybı · yönetici PIN'i · CI kırmızısı"),
 ("KISA","1–2 ay",11,64,"65,75","Sessiz başarısızlık sınıfının tamamı (mutabakat + alarm) · giriş metrajı sözleşmesi · ana veri seddi · oturum sertleştirme · fason kısmi kabulün kapanmayan yolları"),
 ("ORTA","3–6 ay",9,86,"55,65","Kilit sırası (ABBA) ailesi · hata yolu ve 503 sınıflandırması · zaman/sınır disiplini · denetim izi kapsaması · performans ve indeks"),
 ("UZUN","6 ay+",5,58,"33,25","Statü makinesinin merkezileşmesi · HTTP seviyeli bekçi katmanı · altyapı sertleştirme · teknik borç ve ürün kararları")]

TEMIZ=[("281/278 kalemde 0 sapma","Siparişe yazılan sevk rakamlarının kendi içinde tutarlılığı"),
 ("39/39 belge doğru","İrsaliye rakamlarının brüt kuralına uygunluğu"),
 ("38 sayaçta 0 mükerrer, 0 boşluk","Top barkodu, sipariş, iş emri ve çuval numaraları"),
 ("2.431 topun tamamı tutarlı","Topun kökeni: nereden geldi, kimin çocuğu"),
 ("17 tabloda 0 sapma","Ad/kod eşleştirmesi (müşteri, kumaş, fason)"),
 ("10.485 kayıtta 0","Denetim kayıtlarında şifre/sır sızıntısı")]

def esc(s): return html.escape(str(s))
kritik_html='\n'.join(f'''<article class="crit">
<header><span class="crit-no">{i+1}</span><h3>{esc(b)}</h3><p class="ids">{esc(ids)}</p></header>
<p class="crit-body">{esc(txt)}</p>
<dl class="crit-meta"><dt>Ölçüm</dt><dd>{esc(olcum)}</dd><dt>Düzeltme</dt><dd>{esc(fix)}</dd></dl>
</article>''' for i,(b,ids,txt,olcum,fix) in enumerate(KRITIK))

kn_max=max(k[2] for k in KN)
kn_html='\n'.join(f'''<tr><th scope="row"><span class="kn-id">{k[0]}</span><span class="kn-ad">{esc(k[1])}</span></th>
<td class="num"><div class="bar"><span style="width:{round(k[2]/kn_max*100)}%"></span></div><b>{k[2]}</b></td>
<td class="num sev-s1">{k[3] or ""}</td><td class="num sev-s2">{k[4] or ""}</td><td class="num">{k[5] or ""}</td>
<td class="mudahale">{esc(k[6])}</td></tr>''' for k in KN)

vade_html='\n'.join(f'''<article class="vade v-{i}">
<header><h3>{esc(v[0])}</h3><span class="vade-sure">{esc(v[1])}</span></header>
<p class="vade-sayi"><b>{v[4]}</b> gün-adam · {v[2]} kalem · {v[3]} bulgu</p>
<p class="vade-risk">{esc(v[5])}</p></article>''' for i,v in enumerate(VADE))

temiz_html='\n'.join(f'<li><b>{esc(a)}</b><span>{esc(b)}</span></li>' for a,b in TEMIZ)
TUR=[("Tur 1","kod merkezli",145,8),("Tur 2","veri merkezli",40,1),("Tur 3","senaryo merkezli",32,4),("Tur 4","sınır durum",26,0)]
tur_html='\n'.join(f'''<li><span class="tur-ad">{esc(t[0])}</span><span class="tur-tip">{esc(t[1])}</span>
<div class="tur-bar"><span style="width:{round(t[2]/145*100)}%"></span></div>
<span class="tur-n">{t[2]}</span><span class="tur-s1{' sifir' if t[3]==0 else ''}">{t[3]} ağır</span></li>''' for t in TUR)

HTML=f'''<title>TeksERP Denetim Bulguları</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
:root{{
  --ground:#EDF0F5; --surface:#FFFFFF; --surface-2:#F6F8FB; --line:#D3D9E4; --line-soft:#E3E8F0;
  --ink:#161A23; --ink-2:#3D4658; --muted:#6B7488; --accent:#2E3F8F; --accent-soft:#E7EAF7;
  --s1:#A32E2E; --s1-bg:#F7E9E8; --s2:#9C6516; --s2-bg:#F7EFE2; --s3:#4E6076; --s3-bg:#EDF0F4; --s4:#7C8698; --s4-bg:#F1F3F6;
  --k3:#2E3F8F; --k2:#4A5C9E; --shadow:0 1px 2px rgba(22,26,35,.06),0 8px 24px -16px rgba(22,26,35,.25);
}}
@media (prefers-color-scheme:dark){{:root:not([data-theme="light"]){{
  --ground:#101219; --surface:#181B24; --surface-2:#1E222C; --line:#2E3441; --line-soft:#252A35;
  --ink:#E7EAF1; --ink-2:#B9C0CE; --muted:#8B94A6; --accent:#93A4F0; --accent-soft:#232941;
  --s1:#E4817A; --s1-bg:#3A1F1F; --s2:#D9A254; --s2-bg:#332616; --s3:#93A6BE; --s3-bg:#232A34; --s4:#7E8798; --s4-bg:#20242E;
  --k3:#93A4F0; --k2:#7887C9; --shadow:0 1px 2px rgba(0,0,0,.4),0 10px 30px -18px rgba(0,0,0,.8);
}}}}
:root[data-theme="dark"]{{
  --ground:#101219; --surface:#181B24; --surface-2:#1E222C; --line:#2E3441; --line-soft:#252A35;
  --ink:#E7EAF1; --ink-2:#B9C0CE; --muted:#8B94A6; --accent:#93A4F0; --accent-soft:#232941;
  --s1:#E4817A; --s1-bg:#3A1F1F; --s2:#D9A254; --s2-bg:#332616; --s3:#93A6BE; --s3-bg:#232A34; --s4:#7E8798; --s4-bg:#20242E;
  --k3:#93A4F0; --k2:#7887C9; --shadow:0 1px 2px rgba(0,0,0,.4),0 10px 30px -18px rgba(0,0,0,.8);
}}
*{{box-sizing:border-box}}
body{{margin:0;background:var(--ground);color:var(--ink);
  font-family:"Source Serif 4",Georgia,"Times New Roman",serif;font-size:17px;line-height:1.62;
  -webkit-font-smoothing:antialiased}}
.wrap{{max-width:1180px;margin:0 auto;padding:0 24px 96px}}
h1,h2,h3,.ui{{font-family:Archivo,"Helvetica Neue",Arial,sans-serif}}
h2{{font-size:1.42rem;font-weight:700;letter-spacing:-.01em;margin:0 0 6px;text-wrap:balance}}
h3{{font-size:1.06rem;font-weight:600;margin:0;text-wrap:balance}}
p{{margin:0 0 14px;max-width:68ch}}
a{{color:var(--accent)}}
.eyebrow{{font-family:Archivo,sans-serif;font-size:.72rem;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin:0 0 10px}}
section{{margin:56px 0 0}}
.sec-head{{border-top:2px solid var(--ink);padding-top:14px;margin-bottom:24px}}
.sec-head p{{color:var(--ink-2);margin:8px 0 0}}
/* masthead */
header.mast{{position:relative;overflow:hidden;background:var(--surface);border-bottom:1px solid var(--line);
  margin-bottom:0;padding:52px 0 40px}}
header.mast::before{{content:"";position:absolute;inset:0;opacity:.055;pointer-events:none;
  background:repeating-linear-gradient(90deg,var(--accent) 0 1px,transparent 1px 7px),
             repeating-linear-gradient(0deg,var(--accent) 0 1px,transparent 1px 7px)}}
.mast .wrap{{position:relative;padding-bottom:0}}
.mast h1{{font-size:clamp(2.1rem,5.2vw,3.35rem);line-height:1.04;font-weight:700;letter-spacing:-.025em;margin:0 0 18px;max-width:19ch}}
.mast .kunye{{font-family:"IBM Plex Mono",monospace;font-size:.78rem;color:var(--muted);letter-spacing:.01em;
  display:flex;flex-wrap:wrap;gap:6px 20px;margin:0 0 26px}}
.hukum{{border-left:3px solid var(--accent);background:var(--accent-soft);padding:18px 22px;margin:0;
  font-size:1.12rem;line-height:1.5;max-width:74ch;border-radius:0 6px 6px 0}}
.hukum b{{font-weight:600}}
/* stats */
.stats{{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:1px;background:var(--line-soft);
  border:1px solid var(--line-soft);border-radius:8px;overflow:hidden;margin:34px 0 0}}
.stat{{background:var(--surface);padding:16px 18px}}
.stat b{{font-family:Archivo,sans-serif;font-size:1.9rem;font-weight:700;letter-spacing:-.02em;display:block;
  font-variant-numeric:tabular-nums;line-height:1.1}}
.stat span{{font-family:Archivo,sans-serif;font-size:.74rem;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}}
.stat.s1 b{{color:var(--s1)}}
/* doygunluk */
.turlar{{list-style:none;padding:0;margin:0;display:grid;gap:10px}}
.turlar li{{display:grid;grid-template-columns:64px 116px 1fr 46px 74px;align-items:center;gap:12px;
  font-family:Archivo,sans-serif;font-size:.82rem}}
.tur-ad{{font-weight:600}} .tur-tip{{color:var(--muted)}}
.tur-bar{{height:9px;background:var(--surface-2);border-radius:5px;overflow:hidden}}
.tur-bar span{{display:block;height:100%;background:var(--accent);opacity:.8}}
.tur-n{{text-align:right;font-variant-numeric:tabular-nums;font-weight:600}}
.tur-s1{{font-size:.74rem;color:var(--s1);text-align:right;font-variant-numeric:tabular-nums}}
.tur-s1.sifir{{color:var(--muted)}}
/* kritik kartlar */
.critler{{display:grid;gap:16px}}
.crit{{background:var(--surface);border:1px solid var(--line);border-left:4px solid var(--s1);border-radius:8px;
  padding:20px 22px;box-shadow:var(--shadow)}}
.crit header{{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;align-items:baseline;margin-bottom:10px}}
.crit-no{{font-family:Archivo,sans-serif;font-weight:700;font-size:.82rem;color:var(--s1);
  border:1.5px solid var(--s1);border-radius:50%;width:24px;height:24px;display:grid;place-items:center}}
.crit .ids{{grid-column:2;font-family:"IBM Plex Mono",monospace;font-size:.72rem;color:var(--muted);margin:0}}
.crit-body{{margin:0 0 14px;color:var(--ink-2)}}
.crit-meta{{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;margin:0;font-size:.9rem;
  border-top:1px solid var(--line-soft);padding-top:12px}}
.crit-meta dt{{font-family:Archivo,sans-serif;font-size:.7rem;letter-spacing:.08em;text-transform:uppercase;
  color:var(--muted);padding-top:3px}}
.crit-meta dd{{margin:0}}
/* tablolar */
.tablo-kutu{{overflow-x:auto;border:1px solid var(--line);border-radius:8px;background:var(--surface)}}
table{{border-collapse:collapse;width:100%;font-size:.86rem}}
th,td{{text-align:left;padding:11px 14px;border-bottom:1px solid var(--line-soft);vertical-align:top}}
thead th{{font-family:Archivo,sans-serif;font-size:.7rem;letter-spacing:.08em;text-transform:uppercase;
  color:var(--muted);font-weight:600;background:var(--surface-2);position:sticky;top:0;z-index:1;white-space:nowrap}}
tbody tr:last-child td,tbody tr:last-child th{{border-bottom:0}}
.num{{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}}
.kn-id{{font-family:"IBM Plex Mono",monospace;font-size:.74rem;color:var(--accent);display:block}}
.kn-ad{{font-family:"Source Serif 4",serif;font-weight:400;font-size:.92rem}}
.mudahale{{color:var(--ink-2);font-size:.85rem}}
.bar{{height:7px;background:var(--surface-2);border-radius:4px;overflow:hidden;min-width:70px;margin-bottom:4px}}
.bar span{{display:block;height:100%;background:var(--accent);opacity:.75}}
.sev-s1{{color:var(--s1);font-weight:600}} .sev-s2{{color:var(--s2);font-weight:600}}
/* vadeler */
.vadeler{{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px}}
.vade{{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:18px}}
.vade header{{display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:8px}}
.vade h3{{letter-spacing:.04em}}
.v-0 h3{{color:var(--s1)}} .v-1 h3{{color:var(--s2)}} .v-2 h3{{color:var(--s3)}} .v-3 h3{{color:var(--muted)}}
.vade-sure{{font-family:"IBM Plex Mono",monospace;font-size:.74rem;color:var(--muted)}}
.vade-sayi{{font-family:Archivo,sans-serif;font-size:.88rem;margin:0 0 8px;font-variant-numeric:tabular-nums}}
.vade-sayi b{{font-size:1.24rem}}
.vade-risk{{font-size:.86rem;color:var(--ink-2);margin:0}}
/* temiz */
.temiz{{list-style:none;padding:0;margin:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:1px;
  background:var(--line-soft);border:1px solid var(--line-soft);border-radius:8px;overflow:hidden}}
.temiz li{{background:var(--surface);padding:14px 16px}}
.temiz b{{font-family:Archivo,sans-serif;display:block;font-size:.95rem;font-variant-numeric:tabular-nums}}
.temiz span{{font-size:.85rem;color:var(--muted)}}
/* gezgin */
.filtre{{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:14px}}
.filtre input{{font:inherit;font-size:.9rem;font-family:Archivo,sans-serif;padding:8px 12px;border:1px solid var(--line);
  border-radius:6px;background:var(--surface);color:var(--ink);min-width:220px;flex:1}}
.filtre input:focus-visible,.chip:focus-visible{{outline:2px solid var(--accent);outline-offset:2px}}
.chip{{font-family:Archivo,sans-serif;font-size:.78rem;font-weight:600;padding:7px 12px;border-radius:999px;
  border:1px solid var(--line);background:var(--surface);color:var(--ink-2);cursor:pointer}}
.chip[aria-pressed="true"]{{background:var(--ink);color:var(--surface);border-color:var(--ink)}}
.chip.c-S1[aria-pressed="true"]{{background:var(--s1);border-color:var(--s1);color:#fff}}
.chip.c-S2[aria-pressed="true"]{{background:var(--s2);border-color:var(--s2);color:#fff}}
.sayac{{font-family:"IBM Plex Mono",monospace;font-size:.76rem;color:var(--muted);margin-left:auto}}
#tablo tbody tr:hover{{background:var(--surface-2)}}
.sev{{font-family:Archivo,sans-serif;font-size:.7rem;font-weight:700;padding:2px 7px;border-radius:4px;white-space:nowrap}}
.sev.S1{{background:var(--s1-bg);color:var(--s1)}} .sev.S2{{background:var(--s2-bg);color:var(--s2)}}
.sev.S3{{background:var(--s3-bg);color:var(--s3)}} .sev.S4{{background:var(--s4-bg);color:var(--s4)}}
.kan{{font-family:"IBM Plex Mono",monospace;font-size:.72rem;color:var(--muted)}}
.kan.K3{{color:var(--k3);font-weight:500}} .kan.K2{{color:var(--k2)}}
.yol{{font-family:"IBM Plex Mono",monospace;font-size:.72rem;color:var(--muted);word-break:break-all}}
.bid{{font-family:"IBM Plex Mono",monospace;font-size:.72rem;white-space:nowrap;color:var(--ink-2)}}
.olc{{font-variant-numeric:tabular-nums;font-family:Archivo,sans-serif;font-size:.8rem;white-space:nowrap}}
/* sınırlar */
.sinir{{background:var(--surface-2);border:1px dashed var(--line);border-radius:8px;padding:20px 22px}}
.sinir ol{{margin:0;padding-left:20px}} .sinir li{{margin-bottom:8px;color:var(--ink-2)}}
footer{{margin-top:64px;padding-top:20px;border-top:1px solid var(--line);color:var(--muted);font-size:.84rem}}
footer code{{font-family:"IBM Plex Mono",monospace;font-size:.78rem;color:var(--ink-2)}}
@media (max-width:640px){{
  body{{font-size:16px}}
  .turlar li{{grid-template-columns:56px 1fr 40px;row-gap:2px}}
  .tur-tip,.tur-s1{{display:none}}
  .crit header{{grid-template-columns:1fr}} .crit .ids{{grid-column:1}}
}}
@media (prefers-reduced-motion:reduce){{*{{animation:none!important;transition:none!important}}}}
</style>

<header class="mast"><div class="wrap">
<p class="eyebrow">Salt-okunur denetim · 2026-08-29</p>
<h1>TeksERP backend denetimi</h1>
<p class="kunye"><span>Kapsam: Teks-Erp/ (tümü)</span><span>Dal: adnansahin @ ce8681d1</span><span>4 tur · 353 ham gözlem</span><span>Veri: üretim kopyası 2026-08-25</span></p>
<blockquote class="hukum"><b>Hüküm:</b> Sistem çekirdeğinden çürük değil; iyi kurulmuş ve ölçülerek geliştirilmiş bir yazılım — ama kendi koyduğu doğru kuralları her yerde uygulamıyor ve bir şey ters gittiğinde bunu kimseye söylemiyor. Bugünkü en büyük risk hata yapması değil, <b>hatasını sessizce yapması</b>.</blockquote>
<div class="stats">
<div class="stat"><b>243</b><span>ayakta bulgu</span></div>
<div class="stat s1"><b>13</b><span>çok ciddi (S1)</span></div>
<div class="stat"><b>91</b><span>veride ölçülen ihlal</span></div>
<div class="stat"><b>26</b><span>repro ile tetiklenen</span></div>
<div class="stat"><b>24</b><span>çürütmede elenen</span></div>
<div class="stat"><b>190,65</b><span>gün-adam iş</span></div>
</div>
</div></header>

<div class="wrap">

<section>
<div class="sec-head"><h2>Tarama nerede durdu</h2>
<p>Dört tur birbirinin bulgularını görerek koştu; her tur bir öncekinin kapattığı yeri tekrar taramadı. Ağır bulgu akışı dördüncü turda sıfıra indiği için tarama bu ölçütle durduruldu — yani “daha çok bakarsak daha çok çıkar” noktası geçildi.</p></div>
<ul class="turlar">{tur_html}</ul>
</section>

<section>
<div class="sec-head"><h2>En kritik beş bulgu</h2>
<p>Fabrikadaki karşılığıyla, ölçülen sayılarla ve düzeltme süresiyle. Her biri bağımsız çürütmeden geçti; sayılar üretimin 25 Ağustos kopyasından.</p></div>
<div class="critler">{kritik_html}</div>
</section>

<section>
<div class="sec-head"><h2>243 bulgu değil, 10 kök neden</h2>
<p>Her bulgu tek bir kök nedene atandı (çift sayım yok). Aynı kümedeki bulguların düzeltmesi de tektir — bu yüzden yol haritası bulgu bulgu değil küme küme ilerliyor.</p></div>
<div class="tablo-kutu"><table>
<thead><tr><th>Kök neden</th><th class="num">Bulgu</th><th class="num">S1</th><th class="num">S2</th><th class="num">Veride</th><th>Kümeyi kapatan tek müdahale</th></tr></thead>
<tbody>{kn_html}</tbody></table></div>
</section>

<section>
<div class="sec-head"><h2>Yol haritası</h2>
<p>Sıra şiddet × kanıt × efor × yan etki riskinin çarpımı. 13 çok ciddi bulgunun 12'si ilk vadede; kalan biri bilerek ikinci vadede, çünkü kod tarafı ilk vadede zaten kapanıyor ve geriye kalan iş geçmiş verinin onaylı düzeltilmesi.</p></div>
<div class="vadeler">{vade_html}</div>
</section>

<section>
<div class="sec-head"><h2>Sağlam çıkanlar</h2>
<p>Denetim yalnız kusur aramaz; hangi kuralın tuttuğunu da ölçer. Aşağıdakiler arandı ve <b>tek ihlal bulunmadı</b> — bu kalıplar düzeltme turunda korunmalı.</p></div>
<ul class="temiz">{temiz_html}</ul>
</section>

<section>
<div class="sec-head"><h2>Bulgu gezgini</h2>
<p>243 bulgunun tamamı. Şiddet ve kanıt seviyesine göre süzün ya da dosya adı, bulgu numarası, başlık içinde arayın. <b>Kanıt seviyesi:</b> K3 = laboratuvarda tetiklendi · K2 = gerçek veride ölçüldü · K1 = kod ve şemada doğrulandı.</p></div>
<div class="filtre">
<input id="ara" type="search" placeholder="Ara: dosya, bulgu no, başlık…" aria-label="Bulgularda ara">
<button class="chip c-S1" data-f="sev" data-v="S1" aria-pressed="false">S1</button>
<button class="chip c-S2" data-f="sev" data-v="S2" aria-pressed="false">S2</button>
<button class="chip" data-f="sev" data-v="S3" aria-pressed="false">S3</button>
<button class="chip" data-f="sev" data-v="S4" aria-pressed="false">S4</button>
<button class="chip" data-f="kan" data-v="K3" aria-pressed="false">K3</button>
<button class="chip" data-f="kan" data-v="K2" aria-pressed="false">K2</button>
<button class="chip" data-f="olc" data-v="1" aria-pressed="false">Veride ölçülen</button>
<span class="sayac" id="sayac"></span>
</div>
<div class="tablo-kutu"><table id="tablo">
<thead><tr><th>Bulgu</th><th>Şiddet</th><th>Kanıt</th><th>Alan</th><th>Başlık</th><th class="num">Veride</th><th>Konum</th></tr></thead>
<tbody id="govde"></tbody></table></div>
</section>

<section>
<div class="sec-head"><h2>Bu denetimin göremedikleri</h2>
<p>Raporun gücü ölçülmüş olanda; ölçülemeyeni de aynı açıklıkla yazmak zorundayız.</p></div>
<div class="sinir"><ol>
<li><b>Canlı sunucuya erişilmedi.</b> Bütün saha sayıları 25 Ağustos kopyasından; son günlerin verisi görülmedi.</li>
<li><b>Kopya, yazılımın son beş güncellemesini taşımıyor</b> — sipariş/kalem iptali yalnız geliştirme ortamında ölçülebildi.</li>
<li><b>Sunucudaki gerçek yedek ayarları ve kurulum dosyası okunamadı</b>; yedekle ilgili her cümle dolaylı kanıta dayanıyor.</li>
<li><b>Yazılımın kendi 366 kontrol scripti çalıştırılmadı</b> — denetim salt-okunurdu.</li>
<li><b>Beş iş akışı sahada hiç kullanılmamış</b> (şube bazlı sevk, doğrudan fason sevki, kartela, 2. kalite stoğu, yarı mamul); o alanların canlı davranışı görülmedi.</li>
<li><b>Kilit sırası (deadlock) bulguları tetiklenmedi</b>, koddan çıkarsandı.</li>
</ol></div>
</section>

<footer>
<p>Tam rapor: <code>audit/RAPOR-2026-08-29.md</code> (14 bölüm, 66 bulgu tam kanıtıyla) · makine okunur bulgular: <code>audit/findings.json</code> · ölçüm sorguları: <code>audit/data/</code> · laboratuvar scriptleri: <code>Teks-Erp/scripts/audit_repro_*.ts</code> (41 adet) · haritalar: <code>audit/00-map/</code></p>
</footer>
</div>

<script>
const V={data};
const govde=document.getElementById('govde'),ara=document.getElementById('ara'),sayac=document.getElementById('sayac');
const f={{sev:new Set(),kan:new Set(),olc:new Set()}};
const esc=s=>String(s).replace(/[&<>"]/g,c=>({{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}})[c]);
function ciz(){{
  const q=ara.value.trim().toLocaleLowerCase('tr');
  const list=V.filter(r=>
    (!f.sev.size||f.sev.has(r.s))&&(!f.kan.size||f.kan.has(r.k))&&
    (!f.olc.size||(r.sa||r.dv))&&
    (!q||(r.id+' '+r.t+' '+r.f+' '+r.a).toLocaleLowerCase('tr').includes(q)));
  govde.innerHTML=list.map(r=>{{
    const o=[];if(r.sa)o.push('saha '+r.sa);if(r.dv)o.push('dev '+r.dv);
    return '<tr><td class="bid">'+esc(r.id.replace('BULGU-',''))+'</td>'+
    '<td><span class="sev '+r.s+'">'+r.s+'</span></td>'+
    '<td><span class="kan '+r.k+'">'+r.k+(r.r?' ·repro':'')+'</span></td>'+
    '<td>'+esc(r.a)+'</td><td>'+esc(r.t)+'</td>'+
    '<td class="num olc">'+(o.join(' / ')||'—')+'</td>'+
    '<td class="yol">'+esc(r.f)+(r.l?':'+esc(r.l.slice(0,24)):'')+'</td></tr>';
  }}).join('');
  sayac.textContent=list.length+' / '+V.length+' bulgu';
}}
document.querySelectorAll('.chip').forEach(b=>b.addEventListener('click',()=>{{
  const k=b.dataset.f,v=b.dataset.v,on=b.getAttribute('aria-pressed')==='true';
  b.setAttribute('aria-pressed',String(!on));on?f[k].delete(v):f[k].add(v);ciz();}}));
ara.addEventListener('input',ciz);ciz();
</script>
'''
open(f'{A}/rapor-sayfa.html','w',encoding='utf-8').write(HTML)
print('rapor-sayfa.html:',len(HTML),'bayt · gömülü bulgu:',len(rows))
