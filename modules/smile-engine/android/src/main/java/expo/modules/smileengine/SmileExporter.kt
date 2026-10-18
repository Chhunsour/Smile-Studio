package expo.modules.smileengine

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Matrix
import android.graphics.LinearGradient
import android.graphics.Shader
import android.media.MediaMetadataRetriever
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.net.Uri
import android.opengl.GLES20
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import androidx.media3.common.C
import androidx.media3.common.Effect
import androidx.media3.common.GlObjectsProvider
import androidx.media3.common.GlTextureInfo
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.OverlaySettings
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.BaseAudioProcessor
import androidx.media3.common.audio.ChannelMixingAudioProcessor
import androidx.media3.common.audio.ChannelMixingMatrix
import androidx.media3.common.audio.SpeedProvider
import androidx.media3.common.util.GlProgram
import androidx.media3.common.util.GlUtil
import androidx.media3.common.util.Size
import androidx.media3.effect.BaseGlShaderProgram
import androidx.media3.effect.BitmapOverlay
import androidx.media3.effect.Crop
import androidx.media3.effect.GlEffect
import androidx.media3.effect.GlShaderProgram
import androidx.media3.effect.PassthroughShaderProgram
import androidx.media3.effect.MatrixTransformation
import androidx.media3.effect.OverlayEffect
import androidx.media3.effect.RgbMatrix
import androidx.media3.effect.StaticOverlaySettings
import androidx.media3.transformer.Composition
import androidx.media3.transformer.DefaultEncoderFactory
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.EditedMediaItemSequence
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.ProgressHolder
import androidx.media3.transformer.Transformer
import androidx.media3.transformer.VideoEncoderSettings
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.File
import java.nio.ByteBuffer
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.roundToLong
import kotlin.math.sin
import kotlin.math.sqrt

// Spec, mirrors ExportSpec in src/core/export.ts.

class ExportCrop : Record {
  @Field val x: Double = 0.0
  @Field val y: Double = 0.0
  @Field val w: Double = 1.0
  @Field val h: Double = 1.0
}

class ExportTransform : Record {
  @Field val x: Double = 0.0
  @Field val y: Double = 0.0
  @Field val scale: Double = 1.0
  @Field val rotation: Double = 0.0
  @Field val flip: Boolean = false
}

class ExportEffectPrimitive : Record {
  @Field val x: Double = 0.0
  @Field val y: Double = 0.0
  @Field val w: Double = 0.0
  @Field val h: Double = 0.0
  @Field val color: String = "#000000"
  @Field val a0: Double = 0.0
  @Field val a1: Double = 0.0
  @Field val axis: String = "solid"
}

class ExportClip : Record {
  @Field val uri: String = ""
  @Field val still: Boolean = false
  @Field val start: Double = 0.0
  @Field val duration: Double = 0.0
  @Field val sourceIn: Double = 0.0
  @Field val sourceOut: Double = 0.0
  @Field val speed: Double = 1.0
  @Field val volume: Double = 1.0
  @Field val frameWidth: Double = 0.0
  @Field val frameHeight: Double = 0.0
  @Field val crop: ExportCrop = ExportCrop()
  @Field val transform: ExportTransform = ExportTransform()
  @Field val matrix: List<Double>? = null
  @Field val envelope: List<Double> = emptyList()
  @Field val transition: Double = 0.0
  @Field val kenBurns: Double = 0.0
  @Field val effects: List<ExportEffectPrimitive> = emptyList()
}

class ExportText : Record {
  @Field val text: String = ""
  @Field val font: String = "sans"
  @Field val color: String = "#FFFFFF"
  @Field val opacity: Double = 1.0
  @Field val box: Boolean = false
  @Field val x: Double = 0.0
  @Field val y: Double = 0.0
  @Field val fontSize: Double = 0.0
  @Field val rotation: Double = 0.0
  @Field val start: Double = 0.0
  @Field val end: Double = 0.0
  @Field val animIn: String = "none"
  @Field val animOut: String = "none"
  @Field val animDuration: Double = 0.0
  @Field val caption: Boolean = false
}

class ExportAudio : Record {
  @Field val uri: String = ""
  @Field val start: Double = 0.0
  @Field val sourceIn: Double = 0.0
  @Field val sourceOut: Double = 0.0
  @Field val volume: Double = 1.0
  @Field val envelope: List<Double> = emptyList()
}

class ExportSpec : Record {
  @Field val output: String = ""
  @Field val width: Int = 0
  @Field val height: Int = 0
  @Field val fps: Int = 30
  @Field val bitrate: Int = 0
  @Field val background: String = "#000000"
  @Field val duration: Double = 0.0
  @Field val clips: List<ExportClip> = emptyList()
  @Field val texts: List<ExportText> = emptyList()
  @Field val audio: List<ExportAudio> = emptyList()
}

/**
 * Renders a project to an H.264/AAC MP4 with Media3 Transformer. Must be used on the main thread.
 *
 * Main track: one sequence of clips (trim, speed, volume, crop, placement, color matrix). Music: one audio-only
 * sequence per clip, starting with a gap. Text: one composition-level overlay effect, so it sees timeline time.
 */
class SmileExporter(
  private val context: Context,
  private val spec: ExportSpec,
  private val onProgress: (Double) -> Unit,
  private val onDone: (Result<String>) -> Unit,
) {
  private val handler = Handler(Looper.getMainLooper())
  private var transformer: Transformer? = null
  private var finished = false
  private val bitmaps = CopyOnWriteArrayList<Bitmap>()
  private val frameGrid by lazy { FrameGrid(spec.fps) }

  fun start() {
    val out = Uri.parse(spec.output).path ?: return finish(Result.failure(Exception("Bad output path")))
    if (spec.clips.isEmpty() || spec.width <= 0 || spec.height <= 0) return finish(Result.failure(Exception("Nothing to export")))
    File(out).run {
      parentFile?.mkdirs()
      delete()
    }

    val main = EditedMediaItemSequence.Builder(setOf(C.TRACK_TYPE_AUDIO, C.TRACK_TYPE_VIDEO))
      .addItems(spec.clips.map(::clipItem))
      .build()
    val music = spec.audio.filter { it.sourceOut > it.sourceIn }.map { a ->
      EditedMediaItemSequence.Builder(setOf(C.TRACK_TYPE_AUDIO))
        .apply { if (a.start > 0) addGap(us(a.start)) }
        .addItem(
          EditedMediaItem.Builder(clipped(a.uri, a.sourceIn, a.sourceOut))
            .setEffects(Effects(volume(a.volume, a.envelope, a.start), emptyList()))
            .build(),
        )
        .build()
    }
    // Crossfades first so texts stay on top.
    val overlays = spec.clips.indices.flatMap(::crossfadeOverlays) + spec.texts.mapNotNull(::textOverlay)
    val composition = Composition.Builder(listOf(main) + music)
      // Preview colors and bitmap effects are SDR; tone-map HDR camera footage before those effects run.
      .setHdrMode(Composition.HDR_MODE_TONE_MAP_HDR_TO_SDR_USING_OPEN_GL)
      // Media3 allows 15 overlay textures per shader; separate passes preserve order on longer edits.
      .setEffects(Effects(emptyList(), overlays.chunked(15).map { OverlayEffect(it) }))
      .build()

    val transformer = Transformer.Builder(context)
      .setVideoMimeType(MimeTypes.VIDEO_H264)
      .setAudioMimeType(MimeTypes.AUDIO_AAC)
      .setEncoderFactory(
        DefaultEncoderFactory.Builder(context)
          .setRequestedVideoEncoderSettings(VideoEncoderSettings.Builder().setBitrate(spec.bitrate).build())
          .setEnableFallback(true)
          .build(),
      )
      .addListener(object : Transformer.Listener {
        override fun onCompleted(composition: Composition, exportResult: ExportResult) {
          finish(Result.success(Uri.fromFile(File(out)).toString()))
        }

        override fun onError(composition: Composition, exportResult: ExportResult, exportException: ExportException) {
          File(out).delete()
          finish(Result.failure(Exception(exportException.message ?: "Export failed", exportException)))
        }
      })
      .build()
    this.transformer = transformer
    transformer.start(composition, out)
    pollProgress()
  }

  fun cancel() {
    if (finished) return
    transformer?.cancel()
    Uri.parse(spec.output).path?.let { File(it).delete() }
    finish(Result.failure(Exception("Export cancelled")))
  }

  private fun finish(result: Result<String>) {
    if (finished) return
    finished = true
    handler.removeCallbacksAndMessages(null)
    transformer = null
    bitmaps.forEach { if (!it.isRecycled) it.recycle() }
    bitmaps.clear()
    onDone(result)
  }

  private fun pollProgress() {
    val holder = ProgressHolder()
    handler.postDelayed(object : Runnable {
      override fun run() {
        val t = transformer ?: return
        if (t.getProgress(holder) == Transformer.PROGRESS_STATE_AVAILABLE) onProgress(holder.progress / 100.0)
        handler.postDelayed(this, 200)
      }
    }, 200)
  }

  private fun clipItem(clip: ExportClip): EditedMediaItem {
    val effects = mutableListOf<Effect>(FrameRateEffect(frameGrid, clip.start, clip.speed))
    val c = clip.crop
    if (c.x > 0 || c.y > 0 || c.w < 1 || c.h < 1) {
      // Normalized, y-down crop rectangle to NDC (y-up).
      effects += Crop(
        (c.x * 2 - 1).toFloat(),
        ((c.x + c.w) * 2 - 1).toFloat(),
        (1 - (c.y + c.h) * 2).toFloat(),
        (1 - c.y * 2).toFloat(),
      )
    }
    val look = clip.matrix?.takeIf { it.size == 20 }?.let(::ColorMatrixEffect)
    if (spec.background.equals("#000000", ignoreCase = true)) {
      effects += Placement(clip, spec.width, spec.height)
      look?.let { effects += it }
    } else {
      // Grade first so a blurred background matches the clip and a solid one keeps its color.
      look?.let { effects += it }
      effects += Backdrop(clip, spec.width, spec.height, spec.background)
    }
    sceneEffectsOverlay(clip)?.let { effects += OverlayEffect(listOf(it)) }
    if (clip.envelope.size >= 4) effects += FadeEffect(clip.envelope.toDoubleArray())

    if (clip.still) {
      // A photo becomes `duration` of video at the export frame rate; the sequence adds silence for its audio.
      val image = MediaItem.Builder().setUri(clip.uri).setImageDurationMs((clip.duration * 1000).roundToLong()).build()
      return EditedMediaItem.Builder(image)
        .setDurationUs(us(clip.duration))
        .setFrameRate(spec.fps)
        .setEffects(Effects(emptyList(), effects))
        .build()
    }
    return EditedMediaItem.Builder(clipped(clip.uri, clip.sourceIn, clip.sourceOut))
      .setEffects(Effects(volume(clip.volume, clip.envelope, clip.start), effects))
      .apply { if (clip.speed != 1.0) setSpeed(ConstantSpeed(clip.speed.toFloat())) }
      .build()
  }

  /**
   * A sequence can't overlap two items, so a crossfade into clip `i` is drawn as overlays of pre-rendered frames:
   * before the cut clip i's first frame fades in over clip i-1, after it clip i-1's last frame fades out over clip i.
   * Each held frame includes its scene background, effects and fade, so both halves blend complete opaque scenes.
   * Frames are rendered on first use, on the GL thread, and dropped when their half is over.
   */
  private fun crossfadeOverlays(i: Int): List<BitmapOverlay> {
    val clip = spec.clips[i]
    if (i == 0 || clip.transition <= 0) return emptyList()
    val prev = spec.clips[i - 1]
    val cut = clip.start
    val half = clip.transition / 2
    fun weight(timeUs: Long) = (timeUs / 1e6 - (cut - half)) / clip.transition
    return listOf(
      // Before the cut: incoming first frame at the incoming weight.
      edgeOverlay(clip, clip.sourceIn, cut, us(cut - half), us(cut)) { weight(it) },
      // After the cut: outgoing last frame at the outgoing weight.
      edgeOverlay(prev, max(prev.sourceIn, prev.sourceOut - 0.03), cut, us(cut), us(cut + half)) { 1 - weight(it) },
    )
  }

  private fun edgeOverlay(
    clip: ExportClip,
    sourceTime: Double,
    at: Double,
    fromUs: Long,
    toUs: Long,
    alpha: (Long) -> Double,
  ): BitmapOverlay {
    val empty = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888).also { bitmaps += it }
    var frame: Bitmap? = null
    val hidden = StaticOverlaySettings.Builder().setAlphaScale(0f).build()
    return object : BitmapOverlay() {
      override fun getBitmap(presentationTimeUs: Long): Bitmap {
        if (presentationTimeUs !in fromUs until toUs) {
          frame?.let { if (!it.isRecycled) it.recycle() }
          frame = null
          return empty
        }
        return frame ?: renderFrame(clip, sourceTime, at)?.also { frame = it } ?: empty
      }

      override fun getOverlaySettings(presentationTimeUs: Long): OverlaySettings =
        if (presentationTimeUs !in fromUs until toUs) hidden
        else StaticOverlaySettings.Builder().setAlphaScale(alpha(presentationTimeUs).toFloat().coerceIn(0f, 1f)).build()

      override fun release() {
        super.release()
        frame?.let { if (!it.isRecycled) it.recycle() }
        frame = null
        bitmaps.remove(empty)
        if (!empty.isRecycled) empty.recycle()
      }
    }
  }

  /** One frame of `clip` drawn on a canvas-sized bitmap exactly like Placement + color + fade at timeline time `t`. */
  private fun renderFrame(clip: ExportClip, sourceTime: Double, t: Double): Bitmap? {
    val path = Uri.parse(clip.uri).path ?: return null
    val source = if (clip.still) BitmapFactory.decodeFile(path) else MediaMetadataRetriever().run {
      try {
        setDataSource(path)
        val rotation = extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
        val raw = getFrameAtTime(us(sourceTime), MediaMetadataRetriever.OPTION_CLOSEST) ?: return null
        // Some devices return the coded frame; rotate it upright if its shape doesn't match the display shape.
        val displayLandscape = clip.frameWidth / clip.crop.w >= clip.frameHeight / clip.crop.h
        if (rotation % 180 != 0 && (raw.width >= raw.height) != displayLandscape) {
          Bitmap.createBitmap(raw, 0, 0, raw.width, raw.height, Matrix().apply { postRotate(rotation.toFloat()) }, true)
        } else raw
      } finally {
        release()
      }
    } ?: return null

    val out = Bitmap.createBitmap(spec.width, spec.height, Bitmap.Config.ARGB_8888)
    val c = clip.crop
    val crop = RectF(
      (c.x * source.width).toFloat(), (c.y * source.height).toFloat(),
      ((c.x + c.w) * source.width).toFloat(), ((c.y + c.h) * source.height).toFloat(),
    )
    val tr = clip.transform
    val progress = if (clip.duration > 0) ((t - clip.start) / clip.duration).coerceIn(0.0, 1.0) else 0.0
    val s = (tr.scale * (1 + clip.kenBurns * progress)).toFloat()
    val m = Matrix().apply {
      postTranslate(-crop.centerX(), -crop.centerY())
      postScale((clip.frameWidth / crop.width()).toFloat() * s * (if (tr.flip) -1f else 1f), (clip.frameHeight / crop.height()).toFloat() * s)
      postRotate(tr.rotation.toFloat()) // clockwise in y-down pixels, like the preview
      postTranslate((spec.width / 2.0 + tr.x * spec.width).toFloat(), (spec.height / 2.0 + tr.y * spec.height).toFloat())
    }
    val color = ColorMatrix()
    clip.matrix?.takeIf { it.size == 20 }?.let { mm ->
      color.set(FloatArray(20) { i -> if (i % 5 == 4) (mm[i] * 255).toFloat() else mm[i].toFloat() })
    }
    Canvas(out).apply {
      drawColor(if (spec.background == "blur") Color.BLACK else parseColor(spec.background))
      if (spec.background == "blur") drawBlurredSceneBackground(this, source, crop, color, spec.width, spec.height)
      save()
      concat(m)
      clipRect(crop)
      drawBitmap(source, 0f, 0f, Paint(Paint.FILTER_BITMAP_FLAG).apply { colorFilter = ColorMatrixColorFilter(color) })
      restore()
      drawSceneEffects(this, clip.effects, spec.width, spec.height)
    }
    source.recycle()
    val gain = envelopeGain(clip.envelope.toDoubleArray(), t).toFloat()
    if (gain >= 1) return out
    // Fade the complete opaque scene to black, before a transition blends the two scenes.
    Canvas(out).drawColor(Color.argb(((1 - gain.coerceIn(0f, 1f)) * 255).roundToInt(), 0, 0, 0))
    return out
  }

  /** Scene texture is created on first use on the GL thread, not eagerly for every clip in a long project. */
  private fun sceneEffectsOverlay(clip: ExportClip): BitmapOverlay? {
    if (clip.effects.isEmpty()) return null
    var bitmap: Bitmap? = null
    return object : BitmapOverlay() {
      override fun getBitmap(presentationTimeUs: Long): Bitmap = bitmap ?: Bitmap.createBitmap(spec.width, spec.height, Bitmap.Config.ARGB_8888).also {
        drawSceneEffects(Canvas(it), clip.effects, spec.width, spec.height)
        bitmaps += it
        bitmap = it
      }
      override fun release() {
        super.release()
        bitmap?.let { bitmaps.remove(it); if (!it.isRecycled) it.recycle() }
        bitmap = null
      }
    }
  }

  private fun clipped(uri: String, from: Double, to: Double) = MediaItem.Builder()
    .setUri(uri)
    .setClippingConfiguration(
      MediaItem.ClippingConfiguration.Builder()
        .setStartPositionMs((from * 1000).toLong())
        .setEndPositionMs((to * 1000).toLong())
        .build(),
    )
    .build()

  /** Volume, and stereo out for every input: Media3 mixes to the first item's channel count (mono clips would make
   * the music mono too). */
  private fun volume(v: Double, envelope: List<Double>, start: Double): List<AudioProcessor> = listOfNotNull(
    ChannelMixingAudioProcessor().apply {
      for (channels in 1..2) {
        putChannelMixingMatrix(ChannelMixingMatrix.createForConstantGain(channels, 2).scaleBy(v.toFloat()))
      }
    },
    if (envelope.size >= 4) EnvelopeAudioProcessor(envelope.toDoubleArray(), start) else null,
  )

  private fun textOverlay(t: ExportText): BitmapOverlay? {
    val bitmap = renderText(t, spec.width) ?: return null
    bitmaps += bitmap
    fun settings(a: AnimState) = StaticOverlaySettings.Builder()
      .setAlphaScale((t.opacity * a.alpha).toFloat())
      // Center of the text in NDC (y-up). Media3 requires the anchor inside the frame.
      .setBackgroundFrameAnchor(
        (t.x / spec.width * 2 - 1).toFloat().coerceIn(-1f, 1f),
        (1 - (t.y / spec.height + a.dy) * 2).toFloat().coerceIn(-1f, 1f),
      )
      .setScale(a.scale.toFloat(), a.scale.toFloat())
      .setRotationDegrees(-t.rotation.toFloat()) // ours is clockwise, Media3's counter-clockwise
      .build()
    val visible = settings(AnimState())
    val hidden = StaticOverlaySettings.Builder().setAlphaScale(0f).build()
    val animated = t.animDuration > 0 && (t.animIn != "none" || t.animOut != "none")
    val startUs = us(t.start)
    val endUs = us(t.end)
    return object : BitmapOverlay() {
      override fun getBitmap(presentationTimeUs: Long) = bitmap
      override fun getOverlaySettings(presentationTimeUs: Long): OverlaySettings = when {
        presentationTimeUs !in startUs until endUs -> hidden
        animated -> settings(textAnimAt(t, presentationTimeUs / 1e6))
        else -> visible
      }
    }
  }

  private fun us(seconds: Double) = (seconds * 1_000_000).toLong()
}

/** The same cropped, graded cover and 64-tap spiral as Backdrop, at bounded resolution for held frames. */
private fun drawBlurredSceneBackground(
  canvas: Canvas,
  source: Bitmap,
  crop: RectF,
  color: ColorMatrix,
  width: Int,
  height: Int,
) {
  if (crop.width() <= 0 || crop.height() <= 0 || width <= 0 || height <= 0) return
  val sourceScale = min(1.0, 256.0 / max(crop.width(), crop.height()))
  val sourceWidth = max(1, (crop.width() * sourceScale).roundToInt())
  val sourceHeight = max(1, (crop.height() * sourceScale).roundToInt())
  val outputScale = min(1.0, 256.0 / max(width, height))
  val outputWidth = max(1, (width * outputScale).roundToInt())
  val outputHeight = max(1, (height * outputScale).roundToInt())
  var thumbnail: Bitmap? = null
  var blurred: Bitmap? = null
  try {
    val input = Bitmap.createBitmap(sourceWidth, sourceHeight, Bitmap.Config.ARGB_8888).also { thumbnail = it }
    Canvas(input).apply {
      drawColor(Color.BLACK)
      val matrix = Matrix().apply {
        postTranslate(-crop.left, -crop.top)
        postScale(sourceWidth / crop.width(), sourceHeight / crop.height())
      }
      drawBitmap(source, matrix, Paint(Paint.FILTER_BITMAP_FLAG).apply { colorFilter = ColorMatrixColorFilter(color) })
    }
    val pixels = IntArray(sourceWidth * sourceHeight)
    input.getPixels(pixels, 0, sourceWidth, 0, 0, sourceWidth, sourceHeight)
    val result = IntArray(outputWidth * outputHeight)
    val coverScale = max(width / crop.width().toDouble(), height / crop.height().toDouble())
    val coverX = width / (coverScale * crop.width())
    val coverY = height / (coverScale * crop.height())
    val radiusX = .1 * coverX
    val radiusY = .1 * width / height * coverY
    val dx = DoubleArray(64)
    val dy = DoubleArray(64)
    val weights = DoubleArray(64)
    for (index in weights.indices) {
      val radius = sqrt((index + .5) / 64)
      val angle = index * 2.39996
      dx[index] = cos(angle) * radius * radiusX
      dy[index] = -sin(angle) * radius * radiusY // Canvas y-down, shader y-up.
      weights[index] = 1 - .6 * radius
    }
    val total = weights.sum()
    for (y in 0 until outputHeight) {
      val centerY = ((y + .5) / outputHeight - .5) * coverY + .5
      for (x in 0 until outputWidth) {
        val centerX = ((x + .5) / outputWidth - .5) * coverX + .5
        var red = 0.0; var green = 0.0; var blue = 0.0
        for (index in weights.indices) {
          val sx = ((centerX + dx[index]).coerceIn(0.0, 1.0) * sourceWidth - .5).coerceIn(0.0, sourceWidth - 1.0)
          val sy = ((centerY + dy[index]).coerceIn(0.0, 1.0) * sourceHeight - .5).coerceIn(0.0, sourceHeight - 1.0)
          val left = sx.toInt(); val top = sy.toInt()
          val right = min(left + 1, sourceWidth - 1); val bottom = min(top + 1, sourceHeight - 1)
          val fx = sx - left; val fy = sy - top
          val w00 = (1 - fx) * (1 - fy) * weights[index]; val w10 = fx * (1 - fy) * weights[index]
          val w01 = (1 - fx) * fy * weights[index]; val w11 = fx * fy * weights[index]
          val p00 = pixels[top * sourceWidth + left]; val p10 = pixels[top * sourceWidth + right]
          val p01 = pixels[bottom * sourceWidth + left]; val p11 = pixels[bottom * sourceWidth + right]
          red += (p00 ushr 16 and 255) * w00 + (p10 ushr 16 and 255) * w10 + (p01 ushr 16 and 255) * w01 + (p11 ushr 16 and 255) * w11
          green += (p00 ushr 8 and 255) * w00 + (p10 ushr 8 and 255) * w10 + (p01 ushr 8 and 255) * w01 + (p11 ushr 8 and 255) * w11
          blue += (p00 and 255) * w00 + (p10 and 255) * w10 + (p01 and 255) * w01 + (p11 and 255) * w11
        }
        result[y * outputWidth + x] = Color.rgb((red / total).roundToInt().coerceIn(0, 255), (green / total).roundToInt().coerceIn(0, 255), (blue / total).roundToInt().coerceIn(0, 255))
      }
    }
    val output = Bitmap.createBitmap(outputWidth, outputHeight, Bitmap.Config.ARGB_8888).also { blurred = it }
    output.setPixels(result, 0, outputWidth, 0, 0, outputWidth, outputHeight)
    canvas.drawBitmap(output, null, RectF(0f, 0f, width.toFloat(), height.toFloat()), Paint(Paint.FILTER_BITMAP_FLAG))
  } finally {
    thumbnail?.recycle()
    blurred?.recycle()
  }
}

/** The output frame grid, shared by all clips so the last filled slot carries across cuts. */
/** Exact y-down normalized overlay primitives emitted by core/effects.ts and drawn by the RN preview. */
private fun drawSceneEffects(canvas: Canvas, primitives: List<ExportEffectPrimitive>, width: Int, height: Int) {
  val paint = Paint(Paint.ANTI_ALIAS_FLAG)
  for (primitive in primitives.take(512)) {
    if (!listOf(primitive.x, primitive.y, primitive.w, primitive.h, primitive.a0, primitive.a1).all { it.isFinite() } || primitive.w <= 0 || primitive.h <= 0) continue
    val rect = RectF((primitive.x * width).toFloat(), (primitive.y * height).toFloat(), ((primitive.x + primitive.w) * width).toFloat(), ((primitive.y + primitive.h) * height).toFloat())
    val color = parseColor(primitive.color)
    fun withAlpha(value: Double) = Color.argb((value.coerceIn(0.0, 1.0) * 255).roundToInt(), Color.red(color), Color.green(color), Color.blue(color))
    paint.shader = null
    if (primitive.axis == "solid") paint.color = withAlpha(primitive.a0)
    else {
      paint.color = Color.WHITE
      paint.shader = LinearGradient(rect.left, rect.top, if (primitive.axis == "x") rect.right else rect.left, if (primitive.axis == "x") rect.top else rect.bottom, withAlpha(primitive.a0), withAlpha(primitive.a1), Shader.TileMode.CLAMP)
    }
    canvas.drawRect(rect, paint)
  }
}

private class FrameGrid(val fps: Int) {
  @Volatile var lastSlot = Long.MIN_VALUE
}

/**
 * Puts frames on the output frame grid (1/fps): each frame moves to the nearest slot and a frame landing on an
 * already-filled slot is dropped, so e.g. 30 fps sources export at exactly 24 fps. Media3's FrameDropEffect can't do
 * 30 -> 24 (it only drops whole-frame intervals). Frames are never duplicated, so the output can't exceed the source
 * rate. The timestamps it emits are timeline time, which the later effects and the muxer use.
 *
 * Media3's speed change (TimestampAdjustment, run before our effects) also divides the clip's sequence offset by the
 * speed: a 1.5x clip starting at 4 s arrives at 4 / 1.5 + local. Undo that, or the clip's frames look like they
 * belong before the previous clip's and are all dropped.
 */
private class FrameRateEffect(private val grid: FrameGrid, start: Double, speed: Double) : GlEffect {
  private val offsetUs = Math.round((start - start / speed) * 1_000_000)

  override fun toGlShaderProgram(context: Context, useHdr: Boolean): GlShaderProgram =
    object : PassthroughShaderProgram() {
      override fun queueInputFrame(provider: GlObjectsProvider, texture: GlTextureInfo, presentationTimeUs: Long) {
        val fps = grid.fps
        val slot = Math.round((presentationTimeUs + offsetUs) * fps / 1_000_000.0)
        val lastSlot = grid.lastSlot
        if (slot <= lastSlot) {
          inputListener.onInputFrameProcessed(texture)
          inputListener.onReadyToAcceptInputFrame()
          return
        }
        grid.lastSlot = slot
        super.queueInputFrame(provider, texture, slot * 1_000_000L / fps)
      }
    }
}

/** Opacity multiplier, scale and vertical offset (fraction of the canvas height, y down) of an animated text. */
private class AnimState(var alpha: Double = 1.0, var scale: Double = 1.0, var dy: Double = 0.0)

/** Mirrors textAnimAt in src/core/timeline.ts. */
private fun textAnimAt(t: ExportText, time: Double): AnimState {
  val s = AnimState()
  fun phase(kind: String, p: Double, dir: Double) {
    if (kind == "none" || kind.isEmpty() || p >= 1) return
    val q = max(0.0, p)
    val k = 1 - (1 - q) * (1 - q) * (1 - q)
    s.alpha *= k
    if (kind == "slide") s.dy += dir * (1 - k) * 0.06
    if (kind == "slideDown") s.dy -= dir * (1 - k) * 0.06
    if (kind == "pop") {
      val b = 1 + 2.70158 * (q - 1) * (q - 1) * (q - 1) + 1.70158 * (q - 1) * (q - 1)
      s.scale *= 0.4 + 0.6 * b
    }
    if (kind == "bounce") {
      var progress = q
      val bounce: Double
      if (progress < 1 / 2.75) {
        bounce = 7.5625 * progress * progress
      } else if (progress < 2 / 2.75) {
        progress -= 1.5 / 2.75
        bounce = 7.5625 * progress * progress + 0.75
      } else if (progress < 2.5 / 2.75) {
        progress -= 2.25 / 2.75
        bounce = 7.5625 * progress * progress + 0.9375
      } else {
        progress -= 2.625 / 2.75
        bounce = 7.5625 * progress * progress + 0.984375
      }
      s.scale *= 0.55 + 0.45 * bounce
      s.dy += dir * (1 - bounce) * 0.045
    }
    if (kind == "zoomIn") s.scale *= 0.6 + 0.4 * k
    if (kind == "zoomOut") s.scale *= 1.5 - 0.5 * k
    if (kind == "rise") {
      s.dy += dir * (1 - q) * 0.1
      s.scale *= 0.94 + 0.06 * k
    }
    if (kind == "pulse") s.scale *= 1 + 0.18 * (1 - q) * sin(q * Math.PI * 3)
  }
  if (t.animDuration <= 0) return s
  phase(t.animIn, (time - t.start) / t.animDuration, 1.0)
  phase(t.animOut, (t.end - time) / t.animDuration, -1.0)
  return s
}

/** Piecewise-linear `[time, gain, ...]` keyframes (see fadeEnvelope in src/core/timeline.ts). */
private fun envelopeGain(e: DoubleArray, t: Double): Double {
  if (e.size < 4) return 1.0
  if (t <= e[0]) return e[1]
  for (i in 0 until e.size - 2 step 2) {
    if (t <= e[i + 2]) {
      val span = e[i + 2] - e[i]
      return if (span > 0) e[i + 1] + (e[i + 3] - e[i + 1]) * (t - e[i]) / span else e[i + 3]
    }
  }
  return e[e.size - 1]
}

/** Fade to black: scales the clip's RGB by its envelope. Effects see timeline timestamps (see FrameRateEffect). */
private class FadeEffect(private val envelope: DoubleArray) : RgbMatrix {
  override fun getMatrix(presentationTimeUs: Long, useHdr: Boolean): FloatArray {
    val g = envelopeGain(envelope, presentationTimeUs / 1e6).toFloat()
    return floatArrayOf(g, 0f, 0f, 0f, 0f, g, 0f, 0f, 0f, 0f, g, 0f, 0f, 0f, 0f, 1f)
  }
}

/**
 * Applies a fade envelope to one item's audio. Audio processors see the item's own stream (after clipping and speed),
 * so the timeline time of a frame is the item's timeline start plus the frames output since the last flush.
 */
private class EnvelopeAudioProcessor(private val envelope: DoubleArray, private val start: Double) :
  BaseAudioProcessor() {
  private var frames = 0L

  override fun onConfigure(inputAudioFormat: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat {
    if (inputAudioFormat.encoding != C.ENCODING_PCM_16BIT && inputAudioFormat.encoding != C.ENCODING_PCM_FLOAT) {
      throw AudioProcessor.UnhandledAudioFormatException(inputAudioFormat)
    }
    return inputAudioFormat
  }

  override fun queueInput(inputBuffer: ByteBuffer) {
    val format = inputAudioFormat
    val float = format.encoding == C.ENCODING_PCM_FLOAT
    val out = replaceOutputBuffer(inputBuffer.remaining())
    while (inputBuffer.remaining() >= format.bytesPerFrame) {
      val g = envelopeGain(envelope, start + frames.toDouble() / format.sampleRate).toFloat()
      repeat(format.channelCount) {
        if (float) out.putFloat(inputBuffer.float * g)
        else out.putShort((inputBuffer.short * g).roundToInt().coerceIn(-32768, 32767).toShort())
      }
      frames++
    }
    inputBuffer.position(inputBuffer.limit())
    out.flip()
  }

  override fun onFlush() {
    frames = 0
  }

  override fun onReset() {
    frames = 0
  }
}

private class ConstantSpeed(private val speed: Float) : SpeedProvider {
  override fun getSpeed(timeUs: Long) = speed
  override fun getNextSpeedChangeTimeUs(timeUs: Long) = C.TIME_UNSET
}

/**
 * Same geometry as the preview's ClipLayer: the (cropped) frame fitted centered in the W x H canvas, then the user's
 * scale / flip / rotation (clockwise) / offset. Works in NDC (y-up), so angles and y offsets are mirrored.
 */
private class Placement(private val clip: ExportClip, private val width: Int, private val height: Int) :
  MatrixTransformation {
  private val matrix = Matrix()
  private var inputWidth = 1
  private var inputHeight = 1

  override fun configure(inputWidth: Int, inputHeight: Int): Size {
    this.inputWidth = inputWidth
    this.inputHeight = inputHeight
    build(1f)
    return Size(width, height)
  }

  /** Ken Burns: the scale grows linearly over the clip. Effects see timeline time (see FrameRateEffect). */
  override fun getMatrix(presentationTimeUs: Long): Matrix {
    if (clip.kenBurns > 0 && clip.duration > 0) {
      val p = ((presentationTimeUs / 1e6 - clip.start) / clip.duration).coerceIn(0.0, 1.0)
      build((1 + clip.kenBurns * p).toFloat())
    }
    return matrix
  }

  private fun build(zoom: Float) {
    val t = clip.transform
    val s = t.scale.toFloat() * zoom
    matrix.reset()
    // Input NDC -> pixels around the frame center -> fitted frame -> user transform -> output NDC.
    matrix.postScale(inputWidth / 2f, inputHeight / 2f)
    matrix.postScale(
      (clip.frameWidth / inputWidth).toFloat() * s * (if (t.flip) -1f else 1f),
      (clip.frameHeight / inputHeight).toFloat() * s,
    )
    matrix.postRotate(-t.rotation.toFloat())
    matrix.postTranslate((t.x * width).toFloat(), (-t.y * height).toFloat())
    matrix.postScale(2f / width, 2f / height)
  }
}

/**
 * Placement over a background, in one pass: inside the placed frame the clip, outside it a solid color or ('blur')
 * the frame scaled to cover the canvas and blurred, like the preview's BlurBackground.
 * ponytail: single-pass 64-tap spiral blur; make it a separable two-pass blur if banding shows. Held crossfade frames
 * use the same sampling kernel over a bounded CPU thumbnail (drawBlurredSceneBackground).
 */
private class Backdrop(
  private val clip: ExportClip,
  private val width: Int,
  private val height: Int,
  private val background: String,
) : GlEffect {
  override fun toGlShaderProgram(context: Context, useHdr: Boolean): GlShaderProgram =
    object : BaseGlShaderProgram(false, 1) {
      private val placement = Placement(clip, width, height)
      private val program = GlProgram(BACKDROP_VERTEX, BACKDROP_FRAGMENT).apply {
        setBufferAttribute("aFramePosition", GlUtil.getNormalizedCoordinateBounds(), GlUtil.HOMOGENEOUS_COORDINATE_VECTOR_SIZE)
      }
      private val inverse = Matrix()
      private val values = FloatArray(9)
      private var cover = floatArrayOf(1f, 1f)
      private val blur = background == "blur"
      private val fill = if (blur) Color.BLACK else runCatching { Color.parseColor(background) }.getOrDefault(Color.BLACK)

      override fun configure(inputWidth: Int, inputHeight: Int): Size {
        placement.configure(inputWidth, inputHeight)
        val s = max(width / inputWidth.toFloat(), height / inputHeight.toFloat())
        cover = floatArrayOf(width / (s * inputWidth), height / (s * inputHeight))
        return Size(width, height)
      }

      override fun drawFrame(inputTexId: Int, presentationTimeUs: Long) {
        placement.getMatrix(presentationTimeUs).invert(inverse)
        inverse.getValues(values)
        program.use()
        program.setSamplerTexIdUniform("uTex", inputTexId, 0)
        // Row-major android.graphics.Matrix to a column-major mat3.
        program.setFloatsUniform(
          "uInverse",
          floatArrayOf(values[0], values[3], values[6], values[1], values[4], values[7], values[2], values[5], values[8]),
        )
        program.setFloatsUniform("uCover", cover)
        // Radius 10% of the canvas width (about the preview's blur), in the input's texture coordinates.
        program.setFloatsUniform("uRadius", floatArrayOf(0.1f * cover[0], 0.1f * width / height * cover[1]))
        program.setFloatsUniform("uFill", floatArrayOf(Color.red(fill) / 255f, Color.green(fill) / 255f, Color.blue(fill) / 255f))
        program.setFloatUniform("uBlur", if (blur) 1f else 0f)
        program.bindAttributesAndUniforms()
        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
        GlUtil.checkGlError()
      }

      override fun release() {
        super.release()
        program.delete()
      }
    }
}

private const val BACKDROP_VERTEX = """
attribute vec4 aFramePosition;
varying vec2 vPos;
void main() {
  gl_Position = aFramePosition;
  vPos = aFramePosition.xy;
}
"""

private const val BACKDROP_FRAGMENT = """
precision highp float;
uniform sampler2D uTex;
uniform mat3 uInverse;
uniform vec2 uCover;
uniform vec2 uRadius;
uniform vec3 uFill;
uniform float uBlur;
varying vec2 vPos;
void main() {
  vec2 uv = (uInverse * vec3(vPos, 1.0)).xy * 0.5 + 0.5;
  if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) {
    gl_FragColor = texture2D(uTex, uv);
    return;
  }
  if (uBlur < 0.5) {
    gl_FragColor = vec4(uFill, 1.0);
    return;
  }
  vec2 c = vPos * uCover * 0.5 + 0.5;
  vec3 sum = vec3(0.0);
  float total = 0.0;
  for (int i = 0; i < 64; i++) {
    float f = float(i);
    float r = sqrt((f + 0.5) / 64.0);
    float a = f * 2.39996;
    float w = 1.0 - 0.6 * r;
    sum += texture2D(uTex, clamp(c + vec2(cos(a), sin(a)) * r * uRadius, 0.0, 1.0)).rgb * w;
    total += w;
  }
  gl_FragColor = vec4(sum / total, 1.0);
}
"""

/** Our 4x5 row-major matrix as Media3's 4x4 column-major one, applied as `M * (r, g, b, 1)`. */
private class ColorMatrixEffect(m: List<Double>) : RgbMatrix {
  private val matrix = FloatArray(16).also { out ->
    for (row in 0 until 3) {
      for (col in 0 until 3) out[col * 4 + row] = m[row * 5 + col].toFloat()
      out[3 * 4 + row] = m[row * 5 + 4].toFloat() // bias
    }
    out[15] = 1f
  }

  override fun getMatrix(presentationTimeUs: Long, useHdr: Boolean) = matrix
}

/** Mirrors the preview's text styles (src/editor/Preview.tsx). The shadow is in preview points (~400pt wide). */
private fun renderText(t: ExportText, canvasWidth: Int): Bitmap? {
  val px = t.fontSize.toFloat()
  if (px <= 0 || t.text.isBlank()) return null
  val unit = canvasWidth / 400f
  val paint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
    textSize = px
    color = parseColor(t.color)
    typeface = typeface(t.font)
    if (!t.box) setShadowLayer(4 * unit, 0f, unit, Color.argb(140, 0, 0, 0))
  }
  val padX = if (t.box) px * 0.35f else 0f
  val padY = if (t.box) px * 0.12f else 0f
  val margin = if (t.box) 0f else ceil(6 * unit)
  val maxWidth = max(1, (canvasWidth * 0.9f - 2 * padX).toInt())
  fun layout(width: Int) = StaticLayout.Builder.obtain(t.text, 0, t.text.length, paint, width)
    .setAlignment(Layout.Alignment.ALIGN_CENTER)
    .setLineSpacing(0f, 1f)
    .setIncludePad(false)
    .build()
  val measured = layout(maxWidth)
  val textWidth = (0 until measured.lineCount).maxOf { ceil(measured.getLineWidth(it)).toInt() }.coerceAtLeast(1)
  val text = layout(min(textWidth, maxWidth))
  // RN uses a 1.2 x font size line height; pad the default layout height up to it.
  val lineHeight = px * 1.2f
  val extra = max(0f, lineHeight * text.lineCount - text.height)
  val w = ceil(text.width + 2 * (padX + margin)).toInt()
  val h = ceil(text.height + extra + 2 * (padY + margin)).toInt()
  val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
  val canvas = Canvas(bitmap)
  if (t.box) {
    canvas.drawRoundRect(
      RectF(0f, 0f, w.toFloat(), h.toFloat()),
      px * 0.25f,
      px * 0.25f,
      Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(153, 0, 0, 0) },
    )
  }
  canvas.translate(padX + margin, padY + margin + extra / 2)
  text.draw(canvas)
  return bitmap
}

private fun typeface(font: String): Typeface {
  fun weight(base: Typeface, w: Int) =
    if (Build.VERSION.SDK_INT >= 28) Typeface.create(base, w, false) else Typeface.create(base, Typeface.BOLD)
  return when (font) {
    "serif" -> Typeface.create("serif", Typeface.BOLD)
    "mono" -> Typeface.create("monospace", Typeface.BOLD)
    "rounded" -> weight(Typeface.create("sans-serif-medium", Typeface.NORMAL), 800)
    "condensed" -> Typeface.create("sans-serif-condensed", Typeface.BOLD)
    else -> weight(Typeface.DEFAULT, 800)
  }
}

/** `#RRGGBB` or `#RRGGBBAA` (CSS order; Android's parseColor wants alpha first). */
private fun parseColor(hex: String): Int {
  val s = hex.removePrefix("#")
  val v = s.toLongOrNull(16) ?: return Color.WHITE
  return when (s.length) {
    6 -> (0xFF000000 or v).toInt()
    8 -> ((v and 0xFF) shl 24 or (v ushr 8)).toInt()
    else -> Color.WHITE
  }
}
