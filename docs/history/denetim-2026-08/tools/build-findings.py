#!/usr/bin/env python3
"""Tüm turların ayakta kalan bulgularını tek audit/findings.json'a toplar (prompt Bölüm 5.2 şeması).
Kullanım: build-findings.py <tur no...>   ör: build-findings.py 1 2 3 4"""
import sys, json, glob, os, re
A = '/Users/oad/Documents/projeler/AdnanSahin/audit'
SEV = {'S0': 0, 'S1': 1, 'S2': 2, 'S3': 3, 'S4': 4}
out, dropped_all = [], []
for t in sys.argv[1:]:
    p = f'{A}/tours/tur{t}.json'
    if not os.path.exists(p):
        print(f'  ! tur{t}.json yok, atlandı', file=sys.stderr); continue
    d = json.load(open(p, encoding='utf-8'))
    for f in d.get('standing', []):
        v = f.get('dogrulama') or {}
        k2 = (v.get('k2') or {}) if isinstance(v, dict) else {}
        k3 = (v.get('k3') or {}) if isinstance(v, dict) else {}
        vi = f.get('veride_ihlal') or {}
        out.append({
            'id': f['id'], 'tur': int(t),
            'baslik': f.get('baslik'), 'siddet': f.get('siddet'), 'siddet_ilk': f.get('siddet_ilk'),
            'kategori': f.get('kategori'), 'oncelik': f.get('oncelik'), 'modul': f.get('modul'),
            'kanit_seviyesi': f.get('kanit_seviyesi'),
            'kanit': f.get('kanit', []),
            'dosya': f.get('dosya'), 'satir': f.get('satir'),
            'cakisma_senaryosu': f.get('cakisma_senaryosu'),
            'failure_mode': f.get('failure_mode'),
            'veride_ihlal': {'dev': vi.get('dev', k2.get('dev')), 'saha': vi.get('saha', k2.get('saha')),
                             'sorgu': vi.get('sorgu') or k2.get('sorgu'), 'not': vi.get('not') or k2.get('not')},
            'repro_script': f.get('repro_script') or k3.get('script'),
            'repro_sonuc': (f"{k3.get('bozulma')}/{k3.get('tekrar')} bozulma" if k3.get('tekrar') else None),
            'etkilenen_degismez': f.get('etkilenen_degismez'),
            'is_etkisi': f.get('is_etkisi'),
            'oneriler': f.get('oneriler', []),
            'kabul_kriteri': f.get('kabul_kriteri'),
            'efor_gun': f.get('efor_gun'),
            'onceki_defter': f.get('onceki_defter'),
            'curutme': {'mercek': len(f.get('verdicts', [])), 'sonuc': f.get('curutme_status'),
                        'kanitli_curutme': sum(1 for x in f.get('verdicts', []) if x.get('refuted')),
                        'notlar': [x.get('evidence') for x in f.get('verdicts', []) if x.get('code') == 'Ç6']},
            'kaynak_dosyalar': f.get('kaynak_dosyalar', []), 'merged_from': f.get('merged_from', []),
            'dogrulama_sonuc': v.get('verdict') if isinstance(v, dict) else None,
        })
    for x in d.get('dropped', []):
        dropped_all.append({'id': x['id'], 'tur': int(t), 'baslik': x.get('baslik'),
                            'siddet_ilk': x.get('siddet_ilk'), 'dosya': x.get('dosya'), 'satir': x.get('satir'),
                            'eleme_gerekcesi': x.get('reason')})
out.sort(key=lambda f: (SEV.get(f['siddet'], 9), -{'K3': 3, 'K2': 2, 'K1': 1, 'K0': 0}.get(f['kanit_seviyesi'] or 'K0', 0), f['id']))
json.dump({'uretildi': '2026-08-29', 'kapsam': 'Teks-Erp backend (tüm)', 'bulgular': out, 'elenenler': dropped_all},
          open(f'{A}/findings.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
sev = {}
for f in out: sev[f['siddet']] = sev.get(f['siddet'], 0) + 1
kan = {}
for f in out: kan[f['kanit_seviyesi']] = kan.get(f['kanit_seviyesi'], 0) + 1
print(f"findings.json: {len(out)} ayakta bulgu, {len(dropped_all)} elenen")
print("  şiddet:", ' '.join(f'{k}={v}' for k, v in sorted(sev.items())))
print("  kanıt :", ' '.join(f'{k}={v}' for k, v in sorted(kan.items(), reverse=True)))
