"""Ortak test düzeni: gerçek uvicorn 127.0.0.1:0'da (iş parçacığında) + stdlib urllib istemcisi (httpx yok)."""
from __future__ import annotations

import json
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

import pytest

OKUMA = Path(__file__).resolve().parent.parent
REPO = OKUMA.parent
sys.path.insert(0, str(OKUMA))

from app.config import Ayarlar, VARSAYILAN_MODEL_DIZINI  # noqa: E402
from app.main import uygulama_kur  # noqa: E402

SENTETIK = OKUMA / "tests" / "fikstur" / "sentetik.png"


def ayarlar(**k) -> Ayarlar:
    temel = dict(host="127.0.0.1", port=0, ic_ad_izni=False, model_dizini=VARSAYILAN_MODEL_DIZINI, max_kenar=2600, zaman_asimi_s=60.0)
    temel.update(k)
    return Ayarlar(**temel)


class Sunucu:
    def __init__(self, app, host: str = "127.0.0.1") -> None:
        import uvicorn

        self.cfg = uvicorn.Config(app, host=host, port=0, log_level="warning", access_log=False, lifespan="on")
        self.srv = uvicorn.Server(self.cfg)
        self.th = threading.Thread(target=self.srv.run, daemon=True)

    def __enter__(self) -> "Sunucu":
        self.th.start()
        bitis = time.time() + 120
        while not self.srv.started:
            if time.time() > bitis or not self.th.is_alive():
                raise RuntimeError("sunucu açılmadı")
            time.sleep(0.05)
        self.port = self.srv.servers[0].sockets[0].getsockname()[1]
        self.url = f"http://127.0.0.1:{self.port}"
        return self

    def __exit__(self, *a) -> None:
        self.srv.should_exit = True
        self.th.join(timeout=30)

    def istek(self, yol: str, govde: bytes | None = None, baslik: dict | None = None) -> tuple[int, dict, dict]:
        req = urllib.request.Request(self.url + yol, data=govde, method="POST" if govde is not None else "GET",
                                     headers={"content-type": "application/json", **(baslik or {})})
        try:
            with urllib.request.urlopen(req, timeout=120) as y:
                return y.status, json.loads(y.read() or b"{}"), dict(y.headers)
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"{}"), dict(e.headers)


def ocr_govdesi(veri: bytes, mime: str = "image/png") -> bytes:
    import base64

    return json.dumps({"imageBase64": base64.b64encode(veri).decode("ascii"), "mimeType": mime}).encode()


@pytest.fixture(scope="session")
def sunucu():
    with Sunucu(uygulama_kur(ayarlar())) as s:
        yield s
