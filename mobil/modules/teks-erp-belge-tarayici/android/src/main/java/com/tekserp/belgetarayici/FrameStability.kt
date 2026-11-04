package com.tekserp.belgetarayici

import java.nio.ByteBuffer
import kotlin.math.abs

/**
 * Kamera sabitliği + netlik — analiz karesinin parlaklık (Y) düzleminden. Sabitlik: GRID×GRID hücre ortalamalarının
 * ardışık kare farkı; netlik: orta yarıda komşu piksel farkı ortalaması. Analiz iş parçacığında, kare başına bir kez.
 */
internal class FrameStability {
  private var previous: DoubleArray? = null
  private var quietFrames = 0

  class Sample(val still: Boolean, val sharpness: Double)

  fun update(y: ByteBuffer, rowStride: Int, pixelStride: Int, width: Int, height: Int): Sample {
    val grid = grid(y, rowStride, pixelStride, width, height)
    val prev = previous
    previous = grid
    if (prev == null) {
      quietFrames = 0
    } else {
      var sum = 0.0
      for (i in grid.indices) sum += abs(grid[i] - prev[i])
      quietFrames = if (sum / grid.size < LiveTuning.STILL_MAX_DIFF) quietFrames + 1 else 0
    }
    return Sample(quietFrames >= LiveTuning.STILL_MIN_FRAMES, sharpness(y, rowStride, pixelStride, width, height))
  }

  fun reset() {
    previous = null
    quietFrames = 0
  }

  private fun lum(y: ByteBuffer, rowStride: Int, pixelStride: Int, x: Int, row: Int): Int =
    y.get(row * rowStride + x * pixelStride).toInt() and 0xff

  private fun grid(y: ByteBuffer, rowStride: Int, pixelStride: Int, width: Int, height: Int): DoubleArray {
    val g = LiveTuning.GRID
    val step = LiveTuning.GRID_SAMPLE_STEP
    val out = DoubleArray(g * g)
    for (gy in 0 until g) {
      val y0 = gy * height / g
      val y1 = (gy + 1) * height / g
      for (gx in 0 until g) {
        val x0 = gx * width / g
        val x1 = (gx + 1) * width / g
        var sum = 0L
        var n = 0
        var row = y0
        while (row < y1) {
          var x = x0
          while (x < x1) {
            sum += lum(y, rowStride, pixelStride, x, row)
            n++
            x += step
          }
          row += step
        }
        out[gy * g + gx] = if (n == 0) 0.0 else sum.toDouble() / n
      }
    }
    return out
  }

  private fun sharpness(y: ByteBuffer, rowStride: Int, pixelStride: Int, width: Int, height: Int): Double {
    val step = LiveTuning.SHARPNESS_STEP
    var sum = 0L
    var n = 0
    var row = height / 4
    while (row < height * 3 / 4 - 1) {
      var x = width / 4
      while (x < width * 3 / 4 - 1) {
        val c = lum(y, rowStride, pixelStride, x, row)
        sum += abs(c - lum(y, rowStride, pixelStride, x + 1, row)) + abs(c - lum(y, rowStride, pixelStride, x, row + 1))
        n += 2
        x += step
      }
      row += step
    }
    return if (n == 0) 0.0 else sum.toDouble() / n
  }
}
