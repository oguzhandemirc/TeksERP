#!/usr/bin/env python3
"""findings.json'dan rapor tablolarını üretir (mekanik, ajansız).
Çıktı: audit/_rapor-tablolari.md"""
import json, re, collections
A = '/Users/oad/Documents/projeler/AdnanSahin/audit'
d = json.load(open(f'{A}/findings.json', encoding='utf-8'))
F, DROP = d['bulgular'], d['elenenler']

DOMAIN = [
    ('Sevkiyat / sipariş defteri', r'shipping|allocation|sack|order|shipment|sevk|sipari|çuval|iade|return'),
    ('Üretim / tambur / metraj',   r'tambur|inventory|roll|kursun|kk1|kesim|metraj|finalize|batch|parti'),
    ('Fason / kartela',            r'subcontractor|fason|kartela|swatch'),
    ('İş emri / rota',             r'workorder|work-order|is-emri|iş emri|route|rota'),
    ('Yetki / kimlik / oturum',    r'auth|permission|rbac|login|jwt|session|device|yetki|izin|kimlik'),
    ('Belge / etiket / kart',      r'label|document|traveler|printed|refakat|etiket|belge|kart'),
    ('Ana veri',                   r'master-data|merge|item|customer|color|ana.?veri|nameFold|duplicate'),
    ('Ops / yedek / migration',    r'backup|restore|db-copy|migration|kur\.ps1|deploy|archive|arşiv|offsite|yedek|ops'),
    ('Test / bekçi',               r'scripts/test|bekçi|test_|run-all-tests'),
    ('API / hata yolu / gözlem',   r'app\.ts|routes|controller|middleware|error|latency|health|audit\.service|log'),
]
def domain(f):
    hay = f'{f.get("modul") or ""} {f.get("dosya") or ""} {f.get("baslik") or ""}'.lower()
    for name, pat in DOMAIN:
        if re.search(pat, hay, re.I): return name
    return 'Diğer'

for f in F: f['alan'] = domain(f)
SEV_ORDER = ['S0', 'S1', 'S2', 'S3', 'S4']
out = []
w = out.append

w('## 4. BULGU ÖZET TABLOSU\n')
w(f"**Toplam {len(F)} ayakta bulgu** · " + ' · '.join(
    f"{s}: {sum(1 for f in F if f['siddet']==s)}" for s in SEV_ORDER if any(f['siddet']==s for f in F)) +
  f" · elenen {len(DROP)}\n")
w('| Kanıt | Adet | Anlamı |')
w('|---|---:|---|')
for k, aciklama in [('K3','dev DB\'de eşzamanlı repro ile tetiklendi'),('K2','gerçek veride ihlal ölçüldü'),('K1','kod+şema+konfig ile doğrulandı, koruma yok'),('K0','yalnız kod okuması')]:
    n = sum(1 for f in F if f['kanit_seviyesi'] == k)
    if n: w(f'| {k} | {n} | {aciklama} |')
w('')
w('| Alan | S1 | S2 | S3 | S4 | Toplam |')
w('|---|---:|---:|---:|---:|---:|')
by = collections.Counter((f['alan'], f['siddet']) for f in F)
alanlar = sorted({f['alan'] for f in F}, key=lambda a: -sum(by[(a, s)] for s in SEV_ORDER))
for a in alanlar:
    row = [by[(a, s)] for s in ['S1','S2','S3','S4']]
    w(f'| {a} | ' + ' | '.join(str(x or "") for x in row) + f' | {sum(row)} |')
w(f'| **Toplam** | **{sum(1 for f in F if f["siddet"]=="S1")}** | **{sum(1 for f in F if f["siddet"]=="S2")}** | **{sum(1 for f in F if f["siddet"]=="S3")}** | **{sum(1 for f in F if f["siddet"]=="S4")}** | **{len(F)}** |')
w('')
w('### 4.1 Bulgu listesi (şiddet sırasına göre)\n')
w('| ID | Başlık | Alan | Şiddet | Kanıt | Veride ihlal | Dosya |')
w('|---|---|---|---|---|---|---|')
for f in F:
    vi = f.get('veride_ihlal') or {}
    ih = []
    if vi.get('saha'): ih.append(f"saha {vi['saha']}")
    if vi.get('dev'): ih.append(f"dev {vi['dev']}")
    dosya = (f.get('dosya') or '').replace('Teks-Erp/src/', '')
    dosya = (dosya[:52] + '…') if len(dosya) > 53 else dosya
    bas = (f['baslik'] or '').replace('|', '/')
    bas = (bas[:150] + '…') if len(bas) > 151 else bas
    w(f"| {f['id']} | {bas} | {f['alan']} | {f['siddet']} | {f['kanit_seviyesi']} | {', '.join(ih) or '—'} | `{dosya}` |")
w('')
w('## 8. ÇÜRÜTME KAYDI\n')
w(f'### 8.1 Ayakta kalan bulgular: {len(F)}\n')
n3 = sum(1 for f in F if (f.get('curutme') or {}).get('mercek', 0) >= 3)
w(f'- {n3} bulgu üç bağımsız mercekten (kod · veritabanı/veri · topoloji/etki) geçti; kalan düşük şiddetli bulgular yalnız kod merceğinden geçirildi (bütçe kararı).')
w(f'- Kanıtlı çürütme sunulan ama tek kaldığı için düşmeyen bulgu: {sum(1 for f in F if (f.get("curutme") or {}).get("kanitli_curutme", 0) == 1)}.')
ind = [f for f in F if f.get('siddet_ilk') and f['siddet_ilk'] != f['siddet']]
w(f'\n### 8.3 Şiddeti düşürülenler: {len(ind)}\n')
if ind:
    w('| ID | Önce | Sonra | Gerekçe (çürütücünün etki düzeltmesi) |')
    w('|---|---|---|---|')
    for f in ind:
        g = ' '.join((f.get('curutme') or {}).get('notlar') or [])[:220].replace('|', '/').replace('\n', ' ')
        w(f"| {f['id']} | {f['siddet_ilk']} | {f['siddet']} | {g or '—'} |")
w(f'\n### 8.2 Değerlendirilip elenen bulgular: {len(DROP)}\n')
w('| ID | Tur | İlk şiddet | Başlık | Eleme gerekçesi |')
w('|---|---|---|---|---|')
for x in DROP:
    bas = (x.get('baslik') or '').replace('|', '/')[:110]
    ger = (x.get('eleme_gerekcesi') or '').replace('|', '/').replace('\n', ' ')[:260]
    w(f"| {x['id']} | T{x['tur']} | {x.get('siddet_ilk','')} | {bas} | {ger} |")
w('')
w('## 7. VERİ SAĞLIK RAPORU — ölçülen ihlaller\n')
w('Aşağıdaki satırların hepsi üretimin 2026-08-25 kopyasında (`tekserp_saha_0825`) ya da geliştirme veritabanında **çalıştırılarak** ölçülmüştür. Sorgular `audit/data/*.sql`, sonuçlar `audit/data/*.txt` altındadır.\n')
w('| ID | Ölçülen ihlal | Saha | Dev |')
w('|---|---|---:|---:|')
meas = [f for f in F if (f.get('veride_ihlal') or {}).get('saha') or (f.get('veride_ihlal') or {}).get('dev')]
meas.sort(key=lambda f: -(int((f['veride_ihlal'].get('saha') or 0)) if str(f['veride_ihlal'].get('saha') or 0).isdigit() else 0))
for f in meas:
    vi = f['veride_ihlal']
    bas = (f['baslik'] or '').replace('|', '/')[:130]
    w(f"| {f['id']} | {bas} | {vi.get('saha') or '—'} | {vi.get('dev') or '—'} |")
w('')
open(f'{A}/_rapor-tablolari.md', 'w', encoding='utf-8').write('\n'.join(out))
print(f"_rapor-tablolari.md yazıldı: {len(out)} satır, {len(F)} bulgu, {len(DROP)} elenen, {len(meas)} ölçülmüş ihlal")
print('alan dağılımı:', ', '.join(f'{a}={sum(by[(a,s)] for s in SEV_ORDER)}' for a in alanlar))
