"""KABUL (1) — sözleşme: D3b Zod şeması (okuma-istemcisi.ts) ↔ pydantic modeller ↔ gerçek yanıt BİREBİR."""
from __future__ import annotations

import json
import re

from conftest import REPO, SENTETIK, ocr_govdesi

from app.contract import OcrBlock, OcrElement, OcrLine, OcrPoint, OcrRect, OcrResult

ISTEMCI = REPO / "Teks-Erp" / "src" / "lib" / "gelen-belge" / "okuma-istemcisi.ts"
FIKSTUR = REPO / "Teks-Erp" / "src" / "lib" / "gelen-belge" / "motor" / "__tests__" / "fikstur" / "gercek"
ESLEME = {"Rect": OcrRect, "Point": OcrPoint, "Element": OcrElement, "Line": OcrLine, "Block": OcrBlock, "OcrResultSchema": OcrResult}


def zod_semalari() -> dict[str, dict[str, bool]]:
    """{şema adı: {alan: zorunlu mu}} — `.optional()` / `.default(` taşımayan alan zorunludur."""
    kaynak = ISTEMCI.read_text("utf-8")
    out: dict[str, dict[str, bool]] = {}
    for ad, govde in re.findall(r"const (\w+) = z\.object\(\{(.*?)\}\)", kaynak, flags=re.S):
        alanlar: dict[str, bool] = {}
        for parca in re.split(r",\s*(?=\w+:\s)", govde.strip()):
            m = re.match(r"\s*(\w+):\s*(.*)", parca, flags=re.S)
            if m:
                alanlar[m.group(1)] = ".optional()" not in m.group(2) and ".default(" not in m.group(2)
        out[ad] = alanlar
    return out


def test_zod_alanlari_pydantic_ile_birebir():
    zod = zod_semalari()
    assert set(ESLEME) <= set(zod), f"Zod şemaları bulunamadı: {set(ESLEME) - set(zod)}"
    for ad, model in ESLEME.items():
        assert set(zod[ad]) == set(model.model_fields), f"{ad}: Zod {sorted(zod[ad])} ≠ pydantic {sorted(model.model_fields)}"
        for alan, zorunlu in zod[ad].items():
            if zorunlu:
                assert model.model_fields[alan].is_required(), f"{ad}.{alan} Zod'da zorunlu, serviste isteğe bağlı"


def test_anonim_fikstur_gidis_donus_bayt_esit():
    """Anonim fikstür (Paddle yanıtı) modele girer, `exclude_none` ile AYNI JSON çıkar — alan kaybı/ekleme yok."""
    for yol in sorted(FIKSTUR.glob("*.json")):
        ham = json.loads(yol.read_text("utf-8"))
        ham.pop("_not", None)
        assert OcrResult.model_validate(ham).model_dump(exclude_none=True) == ham, yol.name


def _anahtarlar(d: dict, seviye: str, acc: dict[str, set]) -> None:
    acc.setdefault(seviye, set()).update(d.keys())
    for alt, ad in (("blocks", "Block"), ("lines", "Line"), ("elements", "Element")):
        for x in d.get(alt, []):
            _anahtarlar(x, ad, acc)


def test_gercek_yanit_zod_sozlesmesine_uyar(sunucu):
    durum, govde, baslik = sunucu.istek("/ocr", ocr_govdesi(SENTETIK.read_bytes()))
    assert durum == 200, govde
    assert baslik.get("x-okuma-version")
    zod = zod_semalari()
    acc: dict[str, set] = {}
    _anahtarlar(govde, "OcrResultSchema", acc)
    for seviye, gorulen in acc.items():
        assert gorulen <= set(zod[seviye]), f"{seviye}: fazla alan {gorulen - set(zod[seviye])}"
        zorunlu = {k for k, v in zod[seviye].items() if v}
        assert zorunlu <= gorulen, f"{seviye}: eksik zorunlu {zorunlu - gorulen}"
    assert isinstance(govde["imageWidth"], int) and govde["imageWidth"] > 0
    assert "null" not in json.dumps([b.get("corners") for b in govde["blocks"]]), "corners null olamaz (Zod optional)"
    assert govde["engine"] == "rapidocr-onnx"
    # Fikstürle aynı katman yapısı: blok → satır → kelime.
    ornek = json.loads(next(FIKSTUR.glob("0245*.json")).read_text("utf-8"))
    acc_f: dict[str, set] = {}
    _anahtarlar(ornek, "OcrResultSchema", acc_f)
    assert set(acc) == set(acc_f)
    assert "4711-2026" in govde["text"]


def test_saglik_alanlari_istemciyle_ayni(sunucu):
    durum, govde, _ = sunucu.istek("/health")
    assert durum == 200
    assert set(govde) == set(zod_semalari()["HealthSchema"]) and govde["status"] == "ok"
