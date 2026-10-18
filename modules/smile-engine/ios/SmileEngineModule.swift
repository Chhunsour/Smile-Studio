import AVFoundation
import CoreImage
import ExpoModulesCore

public class SmileEngineModule: Module {
  private var exporter: SmileExporter?
  private let audioJobs = SmileAudioJobs()

  public func definition() -> ModuleDefinition {
    Name("SmileEngine")

    Events("onExportProgress")

    /// Renders the project described by `spec` (see src/core/export.ts) to an MP4; resolves with its file URL.
    AsyncFunction("exportVideo") { (spec: ExportSpec) async throws -> String in
      let exporter = SmileExporter(spec: spec) { [weak self] progress in
        self?.sendEvent("onExportProgress", ["progress": progress])
      }
      self.exporter?.cancel()
      self.exporter = exporter
      defer { if self.exporter === exporter { self.exporter = nil } }
      do {
        return try await exporter.run().absoluteString
      } catch let error as Exception {
        throw error
      } catch {
        // AVFoundation errors often have no useful description; keep the code for bug reports.
        let ns = error as NSError
        throw ExportFailedException("\(ns.localizedDescription) (\(ns.domain) \(ns.code))")
      }
    }

    Function("cancelExport") {
      self.exporter?.cancel()
    }

    AsyncFunction("analyzeAudio") { (uri: String, requestId: String) async throws -> [String: Any] in
      let job = self.audioJobs.begin(requestId)
      defer { self.audioJobs.finish(requestId) }
      return try await Task.detached(priority: .utility) {
        try await SmileAudioAnalyzer.analyze(uri, job: job)
      }.value
    }

    Function("cancelAudioAnalysis") { (requestId: String) in self.audioJobs.cancel(requestId) }
    OnDestroy { self.audioJobs.cancelAll() }

    /// Draws an expo-video player's frames through a color matrix (see src/core/color.ts).
    ///
    /// We can't use `AVPlayerItem.videoComposition` for this: on iOS 27 any custom/CIFilter compositor makes the
    /// item fail with -11800 / -12784 (https://developer.apple.com/forums/thread/837179). Pulling frames with
    /// AVPlayerItemVideoOutput and drawing them ourselves avoids the compositor entirely.
    View(SmileColorView.self) {
      // expo-video's player class is internal, but it is a public `SharedRef<AVPlayer>`.
      Prop("player") { (view: SmileColorView, player: SharedObject?) in
        view.setPlayer((player as? SharedRef<AVPlayer>)?.ref)
      }
      Prop("matrix") { (view: SmileColorView, matrix: [Double]?) in
        view.setMatrix(matrix)
      }
      Prop("image") { (view: SmileColorView, uri: String?) in
        view.setImage(uri.flatMap(URL.init(string:)))
      }
    }
  }
}

private final class SmileAudioJob: @unchecked Sendable {
  private let lock = NSLock()
  private var cancelled = false
  func cancel() { lock.lock(); cancelled = true; lock.unlock() }
  func check(_ deadline: Date) throws {
    lock.lock(); let stopped = cancelled; lock.unlock()
    if stopped { throw AudioAnalysisException("Audio analysis cancelled.") }
    if Date() > deadline { throw AudioAnalysisException("This file took too long to analyze. Try a shorter audio file.") }
  }
}

private final class SmileAudioJobs {
  private let lock = NSLock()
  private var jobs: [String: SmileAudioJob] = [:]
  private var cancelledBeforeStart = Set<String>()
  private var destroyed = false
  func begin(_ id: String) -> SmileAudioJob {
    lock.lock(); defer { lock.unlock() }
    let job = SmileAudioJob()
    if destroyed || cancelledBeforeStart.remove(id) != nil { job.cancel() }
    jobs[id] = job
    return job
  }
  func finish(_ id: String) { lock.lock(); jobs.removeValue(forKey: id); lock.unlock() }
  func cancel(_ id: String) {
    lock.lock(); defer { lock.unlock() }
    if let job = jobs[id] { job.cancel() }
    else {
      cancelledBeforeStart.insert(id)
      // Keep cancellation effective even when the synchronous call wins the async registration race.
      if cancelledBeforeStart.count > 128, let first = cancelledBeforeStart.first { cancelledBeforeStart.remove(first) }
    }
  }
  func cancelAll() {
    lock.lock(); destroyed = true
    let pending = Array(jobs.values); jobs.removeAll(); cancelledBeforeStart.removeAll()
    lock.unlock(); pending.forEach { $0.cancel() }
  }
}

private final class AudioAnalysisException: GenericException<String> {
  override var reason: String { param }
}

/** Bounded streaming PCM decode. Only small amplitude summaries cross the native boundary. */
private enum SmileAudioAnalyzer {
  static func analyze(_ uri: String, job: SmileAudioJob) async throws -> [String: Any] {
    let deadline = Date().addingTimeInterval(35)
    try job.check(deadline)
    guard let url = URL(string: uri), url.isFileURL else { throw AudioAnalysisException("Audio analysis needs a local media file.") }
    let fileSize = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
    guard fileSize <= 512 * 1024 * 1024 else { throw AudioAnalysisException("Audio analysis supports files up to 512 MB.") }
    let asset = AVURLAsset(url: url)
    let duration = try await asset.load(.duration).seconds
    guard duration.isFinite, duration > 0, duration <= 1800 else { throw AudioAnalysisException("Audio analysis supports files up to 30 minutes.") }
    guard let track = try await asset.loadTracks(withMediaType: .audio).first else { throw AudioAnalysisException("This file has no audio track to analyze.") }
    try job.check(deadline)
    let reader = try AVAssetReader(asset: asset)
    let output = AVAssetReaderTrackOutput(track: track, outputSettings: [
      AVFormatIDKey: kAudioFormatLinearPCM,
      AVSampleRateKey: 12000,
      AVLinearPCMBitDepthKey: 32,
      AVLinearPCMIsFloatKey: true,
      AVLinearPCMIsBigEndianKey: false,
      AVLinearPCMIsNonInterleaved: false,
    ])
    output.alwaysCopiesSampleData = false
    guard reader.canAdd(output) else { throw AudioAnalysisException("This audio format cannot be analyzed on this device.") }
    reader.add(output)
    guard reader.startReading() else { throw AudioAnalysisException(reader.error?.localizedDescription ?? "Could not decode this audio file.") }
    defer { reader.cancelReading() }
    let bins = 1024, windows = max(1, Int(ceil(duration / 0.02)))
    var sums = [Double](repeating: 0, count: bins), peaks = sums
    var counts = [Int](repeating: 0, count: bins)
    var energy = [Double](repeating: 0, count: windows), energyCounts = [Int](repeating: 0, count: windows)
    var sampleRate = 12000.0, channels = 1, decoded = 0
    while let sample = output.copyNextSampleBuffer() {
      try job.check(deadline)
      guard let format = CMSampleBufferGetFormatDescription(sample), let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(format), let block = CMSampleBufferGetDataBuffer(sample) else { continue }
      sampleRate = asbd.pointee.mSampleRate; channels = Int(asbd.pointee.mChannelsPerFrame)
      guard sampleRate > 0, channels > 0, channels <= 32 else { throw AudioAnalysisException("Unsupported decoded audio format.") }
      let length = CMBlockBufferGetDataLength(block)
      guard length > 0, length <= 8 * 1024 * 1024 else { throw AudioAnalysisException("This audio stream has an unsupported buffer size.") }
      var pcm = [Float](repeating: 0, count: length / MemoryLayout<Float>.size)
      let status = pcm.withUnsafeMutableBytes { bytes in CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: bytes.count, destination: bytes.baseAddress!) }
      guard status == kCMBlockBufferNoErr else { throw AudioAnalysisException("Could not read decoded audio samples.") }
      let timestamp = max(0, CMSampleBufferGetPresentationTimeStamp(sample).seconds)
      guard timestamp.isFinite else { continue }
      for frame in 0..<(pcm.count / channels) {
        let time = timestamp + Double(frame) / sampleRate
        if time >= duration { break }
        let bin = min(bins - 1, Int(time / duration * Double(bins))), window = min(windows - 1, Int(time / 0.02))
        for channel in 0..<channels {
          let raw = Double(pcm[frame * channels + channel]), value = raw.isFinite ? min(1, abs(raw)) : 0
          sums[bin] += value * value; counts[bin] += 1; peaks[bin] = max(peaks[bin], value)
          energy[window] += value * value; energyCounts[window] += 1
        }
        decoded += 1
      }
    }
    try job.check(deadline)
    guard reader.status == .completed, decoded > 0 else { throw AudioAnalysisException(reader.error?.localizedDescription ?? "This audio track could not be decoded.") }
    let rms = sums.enumerated().map { sqrt($0.element / Double(max(1, counts[$0.offset]))) }
    let windowRms = energy.enumerated().map { sqrt($0.element / Double(max(1, energyCounts[$0.offset]))) }
    return ["duration": duration, "rms": rms, "peaks": peaks, "onsets": onsets(windowRms), "sampleRate": sampleRate, "channels": channels]
  }

  private static func onsets(_ energy: [Double]) -> [Double] {
    let flux = energy.enumerated().map { max(0, $0.element - ($0.offset > 0 ? energy[$0.offset - 1] : 0)) }
    var result: [(time: Double, strength: Double)] = []
    for i in flux.indices {
      let value = flux[i]
      if value < 0.018 || value < (i > 0 ? flux[i - 1] : 0) || value < (i + 1 < flux.count ? flux[i + 1] : 0) { continue }
      var sum = 0.0, count = 0
      for j in max(0, i - 8)...min(flux.count - 1, i + 8) where j != i { sum += flux[j]; count += 1 }
      if value < max(0.018, count > 0 ? sum / Double(count) * 2.2 : 0.018) { continue }
      let time = Double(i) * 0.02
      if let last = result.last, time - last.time < 0.18 {
        if value > last.strength { result[result.count - 1] = (time, value) }
      } else { result.append((time, value)) }
    }
    return result.prefix(10_000).map { $0.time }
  }
}

enum SmileColor {
  /// The matrix is defined on gamma-encoded (sRGB) values, while Core Image works in linear light by default.
  static func apply(_ m: [Double], to image: CIImage) -> CIImage {
    let filter = CIFilter(name: "CIColorMatrix")!
    filter.setValue(image.applyingFilter("CILinearToSRGBToneCurve"), forKey: kCIInputImageKey)
    filter.setValue(CIVector(x: m[0], y: m[1], z: m[2], w: m[3]), forKey: "inputRVector")
    filter.setValue(CIVector(x: m[5], y: m[6], z: m[7], w: m[8]), forKey: "inputGVector")
    filter.setValue(CIVector(x: m[10], y: m[11], z: m[12], w: m[13]), forKey: "inputBVector")
    filter.setValue(CIVector(x: m[15], y: m[16], z: m[17], w: m[18]), forKey: "inputAVector")
    filter.setValue(CIVector(x: m[4], y: m[9], z: m[14], w: m[19]), forKey: "inputBiasVector")
    return filter.outputImage!
      .applyingFilter("CISRGBToneCurveToLinear")
      .cropped(to: image.extent)
  }

  /// Video tracks store frames in sensor orientation; `preferredTransform` says how to display them.
  static func orientation(_ t: CGAffineTransform) -> CGImagePropertyOrientation {
    switch (t.a, t.b, t.c, t.d) {
    case (0, 1, -1, 0): return .right
    case (0, -1, 1, 0): return .left
    case (-1, 0, 0, -1): return .down
    default: return .up
    }
  }
}
