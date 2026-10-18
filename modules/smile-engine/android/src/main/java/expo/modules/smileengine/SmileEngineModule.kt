package expo.modules.smileengine

import android.content.Context
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Paint
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.OpenableColumns
import android.view.TextureView
import android.view.View
import android.view.ViewGroup
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.views.ExpoView

class SmileEngineModule : Module() {
  private var exporter: SmileExporter? = null
  private val audioJobLock = Any()
  private val audioJobs = mutableMapOf<String, AtomicBoolean>()
  private val cancelledBeforeStart = linkedSetOf<String>()
  private var audioDestroyed = false
  private val audioWorker = Executors.newSingleThreadExecutor { task ->
    Thread({ android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_BACKGROUND); task.run() }, "SmileAudioAnalysis")
  }

  override fun definition() = ModuleDefinition {
    Name("SmileEngine")

    Events("onExportProgress")

    // Renders the project described by `spec` (see src/core/export.ts) to an MP4; resolves with its file URI.
    AsyncFunction("exportVideo") { spec: ExportSpec, promise: Promise ->
      val context = appContext.reactContext ?: return@AsyncFunction promise.reject("ERR_EXPORT", "No context", null)
      exporter?.cancel()
      lateinit var current: SmileExporter
      current = SmileExporter(
        context,
        spec,
        onProgress = { sendEvent("onExportProgress", mapOf("progress" to it)) },
        onDone = { result ->
          if (exporter === current) exporter = null
          result.fold(
            { promise.resolve(it) },
            { promise.reject("ERR_EXPORT", it.message ?: "Export failed", it) },
          )
        },
      )
      exporter = current
      current.start()
    }.runOnQueue(Queues.MAIN) // Transformer needs a Looper thread; callbacks then arrive on main too.

    Function("cancelExport") {
      Handler(Looper.getMainLooper()).post { exporter?.cancel() }
    }

    AsyncFunction("analyzeAudio") { uri: String, requestId: String, promise: Promise ->
      val context = appContext.reactContext ?: return@AsyncFunction promise.reject("ERR_AUDIO_ANALYSIS", "No media context is available.", null)
      val cancelled = synchronized(audioJobLock) {
        AtomicBoolean(audioDestroyed || cancelledBeforeStart.remove(requestId)).also { audioJobs[requestId] = it }
      }
      try {
        audioWorker.execute {
          try { promise.resolve(SmileAudioAnalyzer.analyze(context, uri, cancelled)) }
          catch (error: Exception) { promise.reject("ERR_AUDIO_ANALYSIS", error.message ?: "This file's audio could not be analyzed.", error) }
          finally { synchronized(audioJobLock) { audioJobs.remove(requestId) } }
        }
      } catch (error: java.util.concurrent.RejectedExecutionException) {
        synchronized(audioJobLock) { audioJobs.remove(requestId) }
        promise.reject("ERR_AUDIO_ANALYSIS", "Audio analysis cancelled.", error)
      }
    }
    Function("cancelAudioAnalysis") { requestId: String ->
      synchronized(audioJobLock) {
        val job = audioJobs[requestId]
        if (job != null) job.set(true)
        else {
          cancelledBeforeStart.add(requestId)
          if (cancelledBeforeStart.size > 128) cancelledBeforeStart.remove(cancelledBeforeStart.first())
        }
      }
    }
    OnDestroy {
      synchronized(audioJobLock) {
        audioDestroyed = true
        audioJobs.values.forEach { it.set(true) }
        cancelledBeforeStart.clear()
      }
      audioWorker.shutdownNow()
    }

    // Android pickers return content:// URIs whose last segment is an id, not the file name.
    Function("displayName") { uri: String ->
      appContext.reactContext?.contentResolver
        ?.query(Uri.parse(uri), arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
        ?.use { if (it.moveToFirst()) it.getString(0) else null }
    }

    // Wraps the preview's VideoView and draws it through a color matrix (see src/core/color.ts).
    View(SmileColorView::class) {
      Prop("matrix") { view: SmileColorView, matrix: List<Double>? -> view.setMatrix(matrix) }
    }
  }
}

/** Bounded background audio decoding, shared by audio files and the audio track of videos. */
private object SmileAudioAnalyzer {
  fun analyze(context: Context, uri: String, cancelled: AtomicBoolean): Map<String, Any> {
    kotlin.check(!cancelled.get()) { "Audio analysis cancelled." }
    val source = Uri.parse(uri)
    require(source.scheme == "file" || source.scheme == "content") { "Audio analysis needs a local media file." }
    val size = if (source.scheme == "file") File(requireNotNull(source.path)).length()
      else context.contentResolver.openAssetFileDescriptor(source, "r")?.use { it.declaredLength } ?: -1
    require(size <= 512L * 1024 * 1024) { "Audio analysis supports files up to 512 MB." }
    val deadline = android.os.SystemClock.elapsedRealtime() + 35_000
    fun check() {
      kotlin.check(!cancelled.get() && !Thread.currentThread().isInterrupted) { "Audio analysis cancelled." }
      kotlin.check(android.os.SystemClock.elapsedRealtime() <= deadline) { "This file took too long to analyze. Try a shorter audio file." }
    }
    val extractor = MediaExtractor()
    var codec: MediaCodec? = null
    var started = false
    try {
      extractor.setDataSource(context, source, null)
      var audioTrack = -1
      var durationUs = 0L
      for (i in 0 until extractor.trackCount) {
        val format = extractor.getTrackFormat(i)
        if (format.containsKey(MediaFormat.KEY_DURATION)) durationUs = max(durationUs, format.getLong(MediaFormat.KEY_DURATION))
        if (audioTrack < 0 && format.getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true) audioTrack = i
      }
      require(audioTrack >= 0) { "This file has no audio track to analyze." }
      val duration = durationUs / 1_000_000.0
      require(duration.isFinite() && duration > 0 && duration <= 1800) { "Audio analysis supports files up to 30 minutes." }
      check()
      extractor.selectTrack(audioTrack)
      val format = extractor.getTrackFormat(audioTrack)
      val decoder = MediaCodec.createDecoderByType(requireNotNull(format.getString(MediaFormat.KEY_MIME)))
      codec = decoder
      decoder.configure(format, null, null, 0)
      decoder.start(); started = true
      var sampleRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
      var channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
      var encoding = AudioFormat.ENCODING_PCM_16BIT
      val bins = 1024
      val windows = max(1, ceil(duration / .02).toInt())
      val sums = DoubleArray(bins); val peaks = DoubleArray(bins); val counts = IntArray(bins)
      val energy = DoubleArray(windows); val energyCounts = IntArray(windows)
      val info = MediaCodec.BufferInfo()
      var inputDone = false; var outputDone = false; var decoded = 0L
      while (!outputDone) {
        check()
        if (!inputDone) {
          val index = decoder.dequeueInputBuffer(10_000)
          if (index >= 0) {
            val buffer = requireNotNull(decoder.getInputBuffer(index)); buffer.clear()
            val bytes = extractor.readSampleData(buffer, 0)
            if (bytes < 0) {
              decoder.queueInputBuffer(index, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM); inputDone = true
            } else {
              decoder.queueInputBuffer(index, 0, bytes, extractor.sampleTime, 0); extractor.advance()
            }
          }
        }
        val index = decoder.dequeueOutputBuffer(info, 10_000)
        if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
          val output = decoder.outputFormat
          sampleRate = output.getInteger(MediaFormat.KEY_SAMPLE_RATE)
          channels = output.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
          encoding = if (output.containsKey(MediaFormat.KEY_PCM_ENCODING)) output.getInteger(MediaFormat.KEY_PCM_ENCODING) else AudioFormat.ENCODING_PCM_16BIT
        } else if (index >= 0) {
          try {
            require(sampleRate > 0 && channels in 1..32) { "Unsupported decoded audio format." }
            val bytesPerSample = when (encoding) {
              AudioFormat.ENCODING_PCM_FLOAT, AudioFormat.ENCODING_PCM_32BIT -> 4
              AudioFormat.ENCODING_PCM_24BIT_PACKED -> 3
              AudioFormat.ENCODING_PCM_8BIT -> 1
              AudioFormat.ENCODING_PCM_16BIT -> 2
              else -> error("This device returned an unsupported PCM format.")
            }
            require(info.size <= 8 * 1024 * 1024) { "This audio stream has an unsupported buffer size." }
            if (info.size > 0 && info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG == 0) {
              val buffer = requireNotNull(decoder.getOutputBuffer(index)).duplicate().order(ByteOrder.LITTLE_ENDIAN)
              buffer.position(info.offset); buffer.limit(info.offset + info.size)
              val frames = info.size / (channels * bytesPerSample)
              for (frame in 0 until frames) {
                val time = max(0.0, info.presentationTimeUs / 1_000_000.0 + frame.toDouble() / sampleRate)
                val bin = min(bins - 1, (time / duration * bins).toInt())
                val window = min(windows - 1, (time / .02).toInt())
                for (channel in 0 until channels) {
                  val raw = readSample(buffer, encoding)
                  if (time < duration) {
                    val value = if (raw.isFinite()) min(1.0, abs(raw)) else 0.0
                    sums[bin] += value * value; counts[bin]++; peaks[bin] = max(peaks[bin], value)
                    energy[window] += value * value; energyCounts[window]++
                  }
                }
                decoded++
              }
            }
            outputDone = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
          } finally { decoder.releaseOutputBuffer(index, false) }
        }
      }
      check()
      require(decoded > 0) { "This audio track could not be decoded." }
      val rms = sums.indices.map { sqrt(sums[it] / max(1, counts[it])) }
      val windowRms = energy.indices.map { sqrt(energy[it] / max(1, energyCounts[it])) }
      return mapOf("duration" to duration, "rms" to rms, "peaks" to peaks.toList(), "onsets" to onsets(windowRms), "sampleRate" to sampleRate, "channels" to channels)
    } finally {
      if (started) runCatching { codec?.stop() }
      runCatching { codec?.release() }
      extractor.release()
    }
  }

  private fun readSample(buffer: ByteBuffer, encoding: Int): Double = when (encoding) {
    AudioFormat.ENCODING_PCM_FLOAT -> buffer.float.toDouble()
    AudioFormat.ENCODING_PCM_32BIT -> buffer.int.toDouble() / 2147483648.0
    AudioFormat.ENCODING_PCM_24BIT_PACKED -> {
      val bits = (buffer.get().toInt() and 255) or ((buffer.get().toInt() and 255) shl 8) or (buffer.get().toInt() shl 16)
      bits.toDouble() / 8388608.0
    }
    AudioFormat.ENCODING_PCM_8BIT -> ((buffer.get().toInt() and 255) - 128) / 128.0
    else -> buffer.short / 32768.0
  }

  private fun onsets(energy: List<Double>): List<Double> {
    val flux = energy.indices.map { max(0.0, energy[it] - if (it > 0) energy[it - 1] else 0.0) }
    val result = mutableListOf<Pair<Double, Double>>()
    for (i in flux.indices) {
      val value = flux[i]
      if (value < .018 || value < (flux.getOrNull(i - 1) ?: 0.0) || value < (flux.getOrNull(i + 1) ?: 0.0)) continue
      var sum = 0.0; var count = 0
      for (j in max(0, i - 8)..min(flux.size - 1, i + 8)) if (j != i) { sum += flux[j]; count++ }
      if (value < max(.018, if (count > 0) sum / count * 2.2 else .018)) continue
      val time = i * .02
      val previous = result.lastOrNull()
      if (previous != null && time - previous.first < .18) {
        if (value > previous.second) result[result.lastIndex] = time to value
      } else result.add(time to value)
    }
    return result.take(10_000).map { it.first }
  }
}

/**
 * A container that color grades the player's TextureView inside it. `TextureView.setLayerPaint` draws the video
 * texture through a ColorMatrixColorFilter on the GPU at no extra cost. (Media3's setVideoEffects left the preview
 * black on our test devices, and a hardware layer on this container is not applied over a TextureView.)
 * Without a TextureView inside (a photo), the container's own hardware layer carries the filter instead.
 */
class SmileColorView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private var paint: Paint? = null

  fun setMatrix(m: List<Double>?) {
    paint = if (m == null || m.size != 20) null else {
      // Same 4x5 row-major layout as ours, but Android's bias column is in 0..255 units.
      val values = FloatArray(20) { i -> if (i % 5 == 4) (m[i] * 255).toFloat() else m[i].toFloat() }
      Paint().apply { colorFilter = ColorMatrixColorFilter(ColorMatrix(values)) }
    }
    update()
  }

  override fun onViewAdded(child: View) {
    super.onViewAdded(child)
    update()
  }

  private fun update() {
    if (applyPaint(this)) setLayerType(LAYER_TYPE_NONE, null)
    else setLayerType(if (paint == null) LAYER_TYPE_NONE else LAYER_TYPE_HARDWARE, paint)
  }

  /** Paints every TextureView below `view`; returns whether there was one. */
  private fun applyPaint(view: View): Boolean = when (view) {
    is TextureView -> {
      view.setLayerPaint(paint)
      true
    }
    is ViewGroup -> (0 until view.childCount).map { applyPaint(view.getChildAt(it)) }.any { it }
    else -> false
  }
}
