"""Sentetik test görüntüsünü üretir (gerçek belge DEĞİL; anonim, yalnız ASCII metin). `python tests/fikstur/uret.py`."""
from pathlib import Path

import cv2
import numpy as np

SATIRLAR = ["SEVK IRSALIYESI", "BELGE NO 4711-2026", "TOP 26209936 118,60", "GIZLI 987654"]


def uret() -> bytes:
    img = np.full((520, 1200, 3), 255, dtype=np.uint8)
    for i, s in enumerate(SATIRLAR):
        cv2.putText(img, s, (40, 100 + i * 120), cv2.FONT_HERSHEY_SIMPLEX, 2.0, (0, 0, 0), 4, cv2.LINE_AA)
    ok, buf = cv2.imencode(".png", img, [cv2.IMWRITE_PNG_COMPRESSION, 9])
    assert ok
    return buf.tobytes()


if __name__ == "__main__":
    (Path(__file__).parent / "sentetik.png").write_bytes(uret())
