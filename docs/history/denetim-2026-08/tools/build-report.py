#!/usr/bin/env python3
"""Nihai raporu birleştirir: iskelet + mekanik tablolar + sentez bölümleri + ayrıntılı bulgular."""
import json, os, re
A = '/Users/oad/Documents/projeler/AdnanSahin/audit'
d = json.load(open(f'{A}/findings.json', encoding='utf-8'))
F = d['bulgular']
def rd(p):
    try: return open(p, encoding='utf-8').read().strip()
    except FileNotFoundError: return f'*(bölüm bulunamadı: {os.path.basename(p)})*'

# ── Bölüm 5: ayrıntılı bulgular (S1+S2 tam, S3/S4 kısa) ──────────────────────
def detail(f):
    o = []
    o.append(f"### [{f['id']}] {f['baslik']}\n")
    o.append('| Alan | Değer |')
    o.append('|---|---|')
    o.append(f"| Şiddet | **{f['siddet']}**" + (f" (ilk değerlendirme {f['siddet_ilk']}, çürütmede düşürüldü)" if f.get('siddet_ilk') and f['siddet_ilk'] != f['siddet'] else '') + ' |')
    o.append(f"| Kanıt seviyesi | {f['kanit_seviyesi']} |")
    o.append(f"| Kategori / öncelik | {f.get('kategori') or '—'} / {f.get('oncelik') or '—'} |")
    o.append(f"| Modül | {f.get('modul') or '—'} |")
    o.append(f"| Konum | `{f.get('dosya')}:{f.get('satir')}` |")
    c = f.get('curutme') or {}
    o.append(f"| Çürütme | {c.get('mercek', 0)} bağımsız mercek, kanıtlı çürütme {c.get('kanitli_curutme', 0)} → **{c.get('sonuc', 'ayakta')}** |")
    if f.get('efor_gun'): o.append(f"| Efor | {f['efor_gun']} gün |")
    if f.get('onceki_defter'): o.append(f"| İlgili önceki bulgu | {f['onceki_defter']} |")
    o.append('')
    if f.get('failure_mode'):
        o.append(f"**Ne oluyor:** {f['failure_mode']}\n")
    if f.get('cakisma_senaryosu'):
        o.append(f"**Çakışma senaryosu**\n\n```\n{f['cakisma_senaryosu']}\n```\n")
    kan = f.get('kanit') or []
    if kan:
        o.append('**Kanıt**\n')
        for k in kan[:8]:
            yol = k.get('yol', ''); sat = k.get('satir'); not_ = (k.get('not') or '').strip()
            o.append(f"- `{yol}{':' + str(sat) if sat else ''}` — {not_}")
        o.append('')
    vi = f.get('veride_ihlal') or {}
    if vi.get('saha') or vi.get('dev'):
        parts = []
        if vi.get('saha') is not None: parts.append(f"üretim kopyası: **{vi['saha']}** kayıt")
        if vi.get('dev') is not None: parts.append(f"geliştirme: {vi['dev']} kayıt")
        o.append(f"**Veride fiili ihlal (K2):** {' · '.join(parts)}" + (f" — {vi['not']}" if vi.get('not') else '') + '\n')
        if vi.get('sorgu'):
            q = vi['sorgu'].strip()
            if len(q) < 1200: o.append(f"```sql\n{q}\n```\n")
    if f.get('repro_script'):
        o.append(f"**Repro (K3):** `{f['repro_script']}`" + (f" — {f['repro_sonuc']}" if f.get('repro_sonuc') else '') + '\n')
    if f.get('etkilenen_degismez'):
        o.append(f"**Bozulan kural:** {f['etkilenen_degismez']}\n")
    if f.get('is_etkisi'):
        o.append(f"**Fabrikadaki etkisi:** {f['is_etkisi']}\n")
    on = f.get('oneriler') or []
    if on:
        o.append('**Öneri (düzeltme turu için)**\n')
        for x in on: o.append(f"- **{x.get('vade', '—')}:** {x.get('aciklama', '')}")
        o.append('')
    if f.get('kabul_kriteri'):
        o.append(f"**Kabul kriteri:** {f['kabul_kriteri']}\n")
    notlar = (c.get('notlar') or [])
    if notlar:
        o.append(f"**Çürütücü notu (etki düzeltmesi):** {notlar[0][:400]}\n")
    o.append('---\n')
    return '\n'.join(o)

sec5 = ['## 5. AYRINTILI BULGULAR\n',
        'Bulgular şiddet sırasına göredir. **S1 ve S2 bulguları tam kanıtıyla** verilmiştir; S3/S4 bulguları '
        'Bölüm 4 tablosunda listelidir ve tam metinleri `audit/findings.json` ile `audit/01-find/` altındaki '
        'denetçi dosyalarındadır (her bulgunun kanıtı, çakışma senaryosu ve önerisi orada eksiksiz durur).\n']
for sev, baslik in [('S0', 'S0 — Kritik'), ('S1', 'S1 — Yüksek'), ('S2', 'S2 — Orta')]:
    grup = [f for f in F if f['siddet'] == sev]
    if not grup: continue
    sec5.append(f'\n### {baslik} ({len(grup)} bulgu)\n')
    for f in grup: sec5.append(detail(f))
lo = [f for f in F if f['siddet'] in ('S3', 'S4')]
sec5.append(f'\n### S3 / S4 — Düşük ve bilgi düzeyi ({len(lo)} bulgu)\n')
sec5.append('Tam liste Bölüm 4.1 tablosundadır. Aşağıda yalnız veride ihlali ölçülmüş olanlar tekrarlanır:\n')
sec5.append('| ID | Başlık | Konum | Saha | Dev |')
sec5.append('|---|---|---|---:|---:|')
for f in lo:
    vi = f.get('veride_ihlal') or {}
    if vi.get('saha') or vi.get('dev'):
        sec5.append(f"| {f['id']} | {(f['baslik'] or '').replace('|','/')[:120]} | `{(f.get('dosya') or '')[-55:]}` | {vi.get('saha') or '—'} | {vi.get('dev') or '—'} |")
sec5.append('')

tab = rd(f'{A}/_rapor-tablolari.md')
def kes(metin, bas, son=None):
    i = metin.find(bas)
    if i < 0: return ''
    j = metin.find(son, i) if son else -1
    return metin[i:j if j > 0 else len(metin)].strip()

parcalar = [
    rd(f'{A}/RAPOR-2026-08-29.md').split('## 12. ÖNERİLEN KALICI KONTROLLER')[0].replace(
        '> ⚠️ TASLAK — Tur 3 (senaryo) ve Tur 4 (sınır durum) tamamlandığında bölüm 1, 4-11 güncellenecektir.\n', '').strip(),
    rd(f'{A}/RAPOR-bolum-1-yonetici-ozeti.md'),
    '',  # 2-3 iskelette
    kes(tab, '## 4. BULGU ÖZET TABLOSU', '## 8. ÇÜRÜTME KAYDI'),
    '\n'.join(sec5),
    rd(f'{A}/RAPOR-bolum-6-kritik-yazma-yolu.md') if os.path.exists(f'{A}/RAPOR-bolum-6-kritik-yazma-yolu.md') else '',
    rd(f'{A}/RAPOR-bolum-7-veri-saglik.md'),
    kes(tab, '## 8. ÇÜRÜTME KAYDI', '## 7. VERİ SAĞLIK RAPORU'),
    rd(f'{A}/RAPOR-bolum-9-kok-neden.md'),
    rd(f'{A}/RAPOR-bolum-10-11-12-yol-haritasi.md'),
    rd(f'{A}/RAPOR-bolum-13-dogru-yapilanlar.md'),
]
print('parça boyutları:', [len(p) for p in parcalar])
