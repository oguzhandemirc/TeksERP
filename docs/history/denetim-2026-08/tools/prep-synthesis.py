#!/usr/bin/env python3
"""Sentez girdisi: tüm bulguları kök-neden kümelemesi için kompakt tek listeye indirger.
Kullanım: prep-synthesis.py > audit/03-verify/_sentez-girdi.json"""
import json, sys
A = '/Users/oad/Documents/projeler/AdnanSahin/audit'
d = json.load(open(f'{A}/findings.json', encoding='utf-8'))
def short(s, n): return (s or '')[:n]
rows = [{
    'id': f['id'], 'sev': f['siddet'], 'kanit': f['kanit_seviyesi'], 'modul': f['modul'],
    'dosya': f['dosya'], 'satir': short(str(f['satir']), 40),
    'baslik': short(f['baslik'], 200),
    'fm': short(f['failure_mode'], 260),
    'ihlal': {k: v for k, v in (f['veride_ihlal'] or {}).items() if k in ('dev', 'saha') and v not in (None, 0)},
    'repro': bool(f.get('repro_script')),
} for f in d['bulgular']]
json.dump({'n': len(rows), 'bulgular': rows}, sys.stdout, ensure_ascii=False)
