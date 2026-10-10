# T1 Linux dumanının yerel CDN'i: yalnız 127.0.0.1, verilen kökten GET + `Range: bytes=<n>-` (güncelleyici yarım
# indirmeyi `.part`tan sürdürür). Kökte `.yavas` dosyası varsa gövde ~8 MB/sn akar (indirme sürerken disk doldurulsun
# diye). Her istek `istek.log`a yazılır (yol + Range + durum). Kullanım: python3 -I cdn.py <kök> <port>
import http.server
import os
import sys
import time

KOK = os.path.realpath(sys.argv[1])
PORT = int(sys.argv[2])
PARCA = 256 * 1024


class Isleyici(http.server.BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        with open(os.path.join(KOK, "istek.log"), "a", encoding="utf-8") as f:
            f.write("%s %s\n" % (self.address_string(), fmt % args))

    def do_GET(self):
        yol = os.path.realpath(os.path.join(KOK, self.path.split("?", 1)[0].lstrip("/")))
        if not yol.startswith(KOK + os.sep) or not os.path.isfile(yol):
            self.send_error(404)
            return
        boy = os.path.getsize(yol)
        bas = 0
        aralik = self.headers.get("Range", "")
        if aralik.startswith("bytes=") and aralik.endswith("-") and aralik[6:-1].isdigit():
            bas = int(aralik[6:-1])
            if bas >= boy:
                self.send_response(416)
                self.send_header("Content-Range", "bytes */%d" % boy)
                self.end_headers()
                return
            self.send_response(206)
            self.send_header("Content-Range", "bytes %d-%d/%d" % (bas, boy - 1, boy))
        else:
            self.send_response(200)
        self.send_header("Content-Length", str(boy - bas))
        self.send_header("Accept-Ranges", "bytes")
        self.end_headers()
        yavas = os.path.exists(os.path.join(KOK, ".yavas"))
        with open(yol, "rb") as f:
            f.seek(bas)
            while True:
                b = f.read(PARCA)
                if not b:
                    break
                try:
                    self.wfile.write(b)
                except (BrokenPipeError, ConnectionResetError):
                    return
                if yavas:
                    time.sleep(PARCA / (8 * 1024 * 1024))


http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Isleyici).serve_forever()
