package com.tekserp.belgetarayici

/**
 * Sayfa iyileştirme (saf, Android'siz) — ML Kit tarayıcısının "İyileştir" filtresinin karşılığı: gölge/ışık düzleştirme
 * (her pikseli yerel KÂĞIT rengine böler; renk kayması da düzelir) + seviye germe. Kenar kırpma / perspektif YOK:
 * okuma motoru alanları basılı etikete göre bulur (`motor/suggest.ts` anchor), sayfa koordinatına göre değil.
 * Pikseller ARGB_8888 `Int`; yerinde işlenir, ek bellek yalnız küçük ızgara kadar.
 */
object PageEnhance {
  /** Arka plan ızgarasının uzun kenardaki hücre sayısı: 2600 px'te ≈ 54 px hücre (harften büyük, gölge geçişinden küçük). */
  const val GRID_CELLS = 48
  /** Hücrede "kâğıt" sayılan en parlak pay. */
  const val PAPER_SHARE = 0.10
  /** Bölmede alt sınır: kâğıt dışı karanlık zemin (masa) patlayıp beyaza dönmesin. */
  const val MIN_BG = 48
  /**
   * Düzleştirmeden sonra bu parlaklık ve üstü tam beyaz. 235 gri/raster baskının açık kenarını siliyordu (harf inceldi,
   * ML Kit okuması düştü; ölçüm 2026-11-04 arşiv notu): 250 yalnız kâğıt kalıntısını beyazlatır.
   */
  const val WHITE_POINT = 250
  /** Siyah noktası en koyu %2'den alınır, ama bundan yukarı çıkmaz (soluk baskı griye boğulmasın). */
  const val BLACK_SHARE = 0.02
  const val MAX_BLACK_POINT = 60
  /** Ara tonları koyulaştırır (çıkış = girişᵞ): gri baskı ve ince harf kalınlaşır, beyaz kâğıt beyaz kalır. */
  const val MID_GAMMA = 1.8

  class Grid(val cols: Int, val rows: Int, val r: IntArray, val g: IntArray, val b: IntArray)

  fun luma(p: Int): Int = (((p shr 16) and 0xff) * 77 + ((p shr 8) and 0xff) * 150 + (p and 0xff) * 29) shr 8

  private fun argb(r: Int, g: Int, b: Int): Int = (0xff shl 24) or (r shl 16) or (g shl 8) or b

  /** Izgara boyu: uzun kenar `GRID_CELLS`, kısa kenar orantılı (en az 1). */
  fun gridSize(width: Int, height: Int): Pair<Int, Int> {
    val long = maxOf(width, height, 1)
    val cols = maxOf(1, Math.round(GRID_CELLS.toDouble() * width / long).toInt())
    val rows = maxOf(1, Math.round(GRID_CELLS.toDouble() * height / long).toInt())
    return cols to rows
  }

  /** Hücre başına kâğıt rengi = hücredeki en parlak `PAPER_SHARE` pikselin ortalaması (`step` alt örnekleme). */
  fun paperGrid(pixels: IntArray, width: Int, height: Int, step: Int = 2): Grid {
    val (cols, rows) = gridSize(width, height)
    val n = cols * rows
    val gr = IntArray(n)
    val gg = IntArray(n)
    val gb = IntArray(n)
    val hist = IntArray(256)
    for (cy in 0 until rows) {
      val y0 = cy * height / rows
      val y1 = maxOf(y0 + 1, (cy + 1) * height / rows)
      for (cx in 0 until cols) {
        val x0 = cx * width / cols
        val x1 = maxOf(x0 + 1, (cx + 1) * width / cols)
        hist.fill(0)
        var count = 0
        var y = y0
        while (y < y1) {
          var x = x0
          while (x < x1) {
            hist[luma(pixels[y * width + x])]++
            count++
            x += step
          }
          y += step
        }
        val want = maxOf(1, (count * PAPER_SHARE).toInt())
        var acc = 0
        var cut = 255
        while (cut > 0 && acc + hist[cut] < want) acc += hist[cut--]
        var sr = 0L
        var sg = 0L
        var sb = 0L
        var k = 0
        y = y0
        while (y < y1) {
          var x = x0
          while (x < x1) {
            val p = pixels[y * width + x]
            if (luma(p) >= cut) {
              sr += (p shr 16) and 0xff
              sg += (p shr 8) and 0xff
              sb += p and 0xff
              k++
            }
            x += step
          }
          y += step
        }
        val i = cy * cols + cx
        if (k > 0) {
          gr[i] = (sr / k).toInt(); gg[i] = (sg / k).toInt(); gb[i] = (sb / k).toInt()
        }
      }
    }
    return smooth(Grid(cols, rows, gr, gg, gb))
  }

  /** Komşusunun bu payından koyu hücre baskı sayılır (gölge geçişi hücreden hücreye bu kadar sert düşmez). */
  const val PRINT_DROP = 0.6
  /** Baskı dolgusu tur sayısı: her tur bir hücre içeri ilerler (≈ 4 × 54 px dolu blok — logo, kalın başlık). */
  const val FILL_PASSES = 4

  /**
   * Baskı dolu hücreler (en parlak payı bile mürekkep) komşu kâğıt rengini alır — düz `max` genişletmesinin aksine gerçek
   * gölge geçişi korunur; sonra 3×3 ortalama (hücre sınırı görünmesin).
   */
  fun smooth(grid: Grid): Grid {
    val n = grid.cols * grid.rows
    val r = grid.r.copyOf()
    val g = grid.g.copyOf()
    val b = grid.b.copyOf()
    fun lum(i: Int) = (r[i] * 77 + g[i] * 150 + b[i] * 29) shr 8
    repeat(FILL_PASSES) {
      val src = IntArray(n) { lum(it) }
      val pick = IntArray(n) { -1 }
      for (y in 0 until grid.rows) for (x in 0 until grid.cols) {
        val i = y * grid.cols + x
        var best = -1
        for (dy in -1..1) for (dx in -1..1) {
          val yy = y + dy
          val xx = x + dx
          if ((dx == 0 && dy == 0) || yy < 0 || xx < 0 || yy >= grid.rows || xx >= grid.cols) continue
          val j = yy * grid.cols + xx
          if (best < 0 || src[j] > src[best]) best = j
        }
        if (best >= 0 && src[i] < src[best] * PRINT_DROP) pick[i] = best
      }
      if (pick.all { it < 0 }) return@repeat
      val nr = r.copyOf()
      val ng = g.copyOf()
      val nb = b.copyOf()
      for (i in 0 until n) if (pick[i] >= 0) { nr[i] = r[pick[i]]; ng[i] = g[pick[i]]; nb[i] = b[pick[i]] }
      nr.copyInto(r); ng.copyInto(g); nb.copyInto(b)
    }
    fun blur(src: IntArray): IntArray {
      val out = IntArray(n)
      for (y in 0 until grid.rows) for (x in 0 until grid.cols) {
        var sum = 0
        var k = 0
        for (dy in -1..1) for (dx in -1..1) {
          val yy = y + dy
          val xx = x + dx
          if (yy < 0 || xx < 0 || yy >= grid.rows || xx >= grid.cols) continue
          sum += src[yy * grid.cols + xx]; k++
        }
        out[y * grid.cols + x] = sum / k
      }
      return out
    }
    return Grid(grid.cols, grid.rows, blur(r), blur(g), blur(b))
  }

  /** Hücre merkezleri arasında doğrusal ara değer için eksen tablosu: piksel → (alt hücre, üst hücre, ağırlık 0..1024). */
  private fun axis(size: Int, cells: Int): Triple<IntArray, IntArray, IntArray> {
    val lo = IntArray(size)
    val hi = IntArray(size)
    val w = IntArray(size)
    for (i in 0 until size) {
      val f = ((i + 0.5) * cells / size - 0.5).coerceIn(0.0, (cells - 1).toDouble())
      val a = f.toInt()
      lo[i] = a
      hi[i] = minOf(cells - 1, a + 1)
      w[i] = ((f - a) * 1024).toInt()
    }
    return Triple(lo, hi, w)
  }

  /** Düzleştirme: her kanal yerel kâğıt rengine bölünür (kâğıt → 255). Yerinde. */
  fun flatten(pixels: IntArray, width: Int, height: Int, grid: Grid) {
    val (xl, xh, xw) = axis(width, grid.cols)
    val (yl, yh, yw) = axis(height, grid.rows)
    val rowR = IntArray(grid.cols)
    val rowG = IntArray(grid.cols)
    val rowB = IntArray(grid.cols)
    for (y in 0 until height) {
      val a = yl[y] * grid.cols
      val b = yh[y] * grid.cols
      val wy = yw[y]
      for (c in 0 until grid.cols) {
        rowR[c] = (grid.r[a + c] * (1024 - wy) + grid.r[b + c] * wy) shr 10
        rowG[c] = (grid.g[a + c] * (1024 - wy) + grid.g[b + c] * wy) shr 10
        rowB[c] = (grid.b[a + c] * (1024 - wy) + grid.b[b + c] * wy) shr 10
      }
      val base = y * width
      for (x in 0 until width) {
        val l = xl[x]
        val h = xh[x]
        val wx = xw[x]
        val br = maxOf(MIN_BG, (rowR[l] * (1024 - wx) + rowR[h] * wx) shr 10)
        val bg = maxOf(MIN_BG, (rowG[l] * (1024 - wx) + rowG[h] * wx) shr 10)
        val bb = maxOf(MIN_BG, (rowB[l] * (1024 - wx) + rowB[h] * wx) shr 10)
        val p = pixels[base + x]
        pixels[base + x] = argb(
          minOf(255, ((p shr 16) and 0xff) * 255 / br),
          minOf(255, ((p shr 8) and 0xff) * 255 / bg),
          minOf(255, (p and 0xff) * 255 / bb),
        )
      }
    }
  }

  /** Siyah noktası: en koyu `BLACK_SHARE` payın sınırı (en çok `MAX_BLACK_POINT`). */
  fun blackPoint(pixels: IntArray, step: Int = 7): Int {
    val hist = IntArray(256)
    var count = 0
    var i = 0
    while (i < pixels.size) {
      hist[luma(pixels[i])]++
      count++
      i += step
    }
    val want = maxOf(1, (count * BLACK_SHARE).toInt())
    var acc = 0
    var v = 0
    while (v < 255 && acc + hist[v] < want) acc += hist[v++]
    return minOf(v, MAX_BLACK_POINT)
  }

  /** Seviye tablosu: `black` → 0, `white` → 255, arası `gamma` eğrisiyle. */
  fun levelsLut(black: Int, white: Int = WHITE_POINT, gamma: Double = MID_GAMMA): IntArray {
    val span = maxOf(1, white - black).toDouble()
    return IntArray(256) { v -> Math.round(255 * Math.pow(((v - black) / span).coerceIn(0.0, 1.0), gamma)).toInt() }
  }

  /**
   * Okuma öncesi yumuşatma (yalnız OCR girdisi, gönderilen sayfa değişmez): gri + [1,2,1]/4 ayrık bulanıklık (σ ≈ 0,7).
   * ML Kit tarayıcısının sayfasında raster baskının renkli kumlanmasını siler; harf kenarı korunur. Yerinde.
   */
  fun softenForOcr(pixels: IntArray, width: Int, height: Int) {
    if (width <= 0 || height <= 0 || pixels.size < width * height) return
    val g = IntArray(width * height) { luma(pixels[it]) }
    val tmp = IntArray(width * height)
    for (y in 0 until height) {
      val row = y * width
      for (x in 0 until width) {
        val l = g[row + maxOf(0, x - 1)]
        val r = g[row + minOf(width - 1, x + 1)]
        tmp[row + x] = l + 2 * g[row + x] + r
      }
    }
    for (y in 0 until height) {
      val up = maxOf(0, y - 1) * width
      val dn = minOf(height - 1, y + 1) * width
      val row = y * width
      for (x in 0 until width) {
        val v = (tmp[up + x] + 2 * tmp[row + x] + tmp[dn + x] + 8) shr 4
        pixels[row + x] = argb(v, v, v)
      }
    }
  }

  /** Bütün iyileştirme: düzleştir → seviye ger. Yerinde. */
  fun enhance(pixels: IntArray, width: Int, height: Int) {
    if (width <= 0 || height <= 0 || pixels.size < width * height) return
    flatten(pixels, width, height, paperGrid(pixels, width, height))
    val lut = levelsLut(blackPoint(pixels))
    for (i in 0 until width * height) {
      val p = pixels[i]
      pixels[i] = argb(lut[(p shr 16) and 0xff], lut[(p shr 8) and 0xff], lut[p and 0xff])
    }
  }
}
