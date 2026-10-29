"""KABUL (2) — dinleme adresi: yalnız döngü; iç servis adı açık izinle; 0.0.0.0 / :: / LAN IP REDDEDİLİR."""
from __future__ import annotations

import os
import socket
import subprocess
import sys

import pytest
from conftest import OKUMA

from app.config import BaglamaHatasi, baglanti_adresi_izinli, dinleme_adresi_dogrula


@pytest.mark.parametrize("host", ["0.0.0.0", "::", "[::]", "192.168.1.100", "10.0.0.5", "okuma.local", "", " "])
def test_yasak_adresler_reddedilir(host):
    with pytest.raises(BaglamaHatasi):
        dinleme_adresi_dogrula(host, ic_ad_izni=True)


def test_servis_adi_yalniz_acik_izinle():
    with pytest.raises(BaglamaHatasi):
        dinleme_adresi_dogrula("okuma", ic_ad_izni=False)
    assert dinleme_adresi_dogrula("okuma", ic_ad_izni=True) == "okuma"


@pytest.mark.parametrize("host", ["127.0.0.1", "127.0.0.2", "::1", "localhost"])
def test_dongu_serbest(host):
    assert dinleme_adresi_dogrula(host, ic_ad_izni=False)


def test_python_m_app_0000_ile_acilmaz_ve_port_dinlenmez():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    env = {**os.environ, "OKUMA_HOST": "0.0.0.0", "OKUMA_PORT": str(port)}
    p = subprocess.run([sys.executable, "-m", "app"], cwd=OKUMA, env=env, capture_output=True, text=True, timeout=60)
    assert p.returncode == 2, p.stderr
    assert "0.0.0.0" in p.stderr
    with pytest.raises(OSError):
        socket.create_connection(("127.0.0.1", port), timeout=1).close()


def test_ikinci_sed_dongu_disi_yerel_adres_403():
    """Elle `uvicorn --host 0.0.0.0` açılsa da LAN arayüzüne gelen bağlantı reddedilir (ASGI scope["server"])."""
    assert baglanti_adresi_izinli("127.0.0.1", False)
    assert not baglanti_adresi_izinli("192.168.1.100", False)
    assert not baglanti_adresi_izinli("0.0.0.0", True)
    assert baglanti_adresi_izinli("172.18.0.3", True)
    import asyncio

    from conftest import ayarlar

    from app.main import uygulama_kur

    app = uygulama_kur(ayarlar())
    giden: list[dict] = []

    async def al():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def gonder(m):
        giden.append(m)

    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "GET", "scheme": "http", "path": "/health",
             "raw_path": b"/health", "query_string": b"", "headers": [], "client": ("192.168.1.7", 5555), "server": ("192.168.1.100", 8765)}
    asyncio.run(app(scope, al, gonder))
    assert giden[0]["status"] == 403
