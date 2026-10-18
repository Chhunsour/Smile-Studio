import AVFoundation
import CoreImage
import ExpoModulesCore
import UIKit

// MARK: - Spec (mirrors ExportSpec in src/core/export.ts)

struct ExportCrop: Record {
  @Field var x: Double = 0
  @Field var y: Double = 0
  @Field var w: Double = 1
  @Field var h: Double = 1
}

struct ExportTransform: Record {
  @Field var x: Double = 0
  @Field var y: Double = 0
  @Field var scale: Double = 1
  @Field var rotation: Double = 0
  @Field var flip: Bool = false
}

struct ExportEffectPrimitive: Record {
  @Field var x: Double = 0
  @Field var y: Double = 0
  @Field var w: Double = 0
  @Field var h: Double = 0
  @Field var color: String = "#000000"
  @Field var a0: Double = 0
  @Field var a1: Double = 0
  @Field var axis: String = "solid"
}

struct ExportClip: Record {
  @Field var uri: String = ""
  @Field var still: Bool = false
  @Field var start: Double = 0
  @Field var duration: Double = 0
  @Field var sourceIn: Double = 0
  @Field var sourceOut: Double = 0
  @Field var speed: Double = 1
  @Field var volume: Double = 1
  @Field var frameWidth: Double = 0
  @Field var frameHeight: Double = 0
  @Field var crop: ExportCrop = ExportCrop()
  @Field var transform: ExportTransform = ExportTransform()
  @Field var matrix: [Double]? = nil
  @Field var envelope: [Double] = []
  @Field var transition: Double = 0
  @Field var kenBurns: Double = 0
  @Field var effects: [ExportEffectPrimitive] = []
}

struct ExportText: Record {
  @Field var text: String = ""
  @Field var font: String = "sans"
  @Field var color: String = "#FFFFFF"
  @Field var opacity: Double = 1
  @Field var box: Bool = false
  @Field var x: Double = 0
  @Field var y: Double = 0
  @Field var fontSize: Double = 0
  @Field var rotation: Double = 0
  @Field var start: Double = 0
  @Field var end: Double = 0
  @Field var animIn: String = "none"
  @Field var animOut: String = "none"
  @Field var animDuration: Double = 0
  @Field var caption: Bool = false
}

struct ExportAudio: Record {
  @Field var uri: String = ""
  @Field var start: Double = 0
  @Field var sourceIn: Double = 0
  @Field var sourceOut: Double = 0
  @Field var volume: Double = 1
  @Field var envelope: [Double] = []
}

struct ExportSpec: Record {
  @Field var output: String = ""
  @Field var width: Int = 0
  @Field var height: Int = 0
  @Field var fps: Int = 30
  @Field var bitrate: Int = 0
  @Field var background: String = "#000000"
  @Field var duration: Double = 0
  @Field var clips: [ExportClip] = []
  @Field var texts: [ExportText] = []
  @Field var audio: [ExportAudio] = []
}

final class ExportFailedException: GenericException<String> {
  override var reason: String { param }
}

final class ExportCancelledException: Exception {
  override var reason: String { "Export cancelled" }
}

// MARK: - Exporter

/// Renders a project to an H.264/AAC MP4.
///
/// Video is decoded with AVAssetReader, composed with Core Image (crop, color matrix, transform, text) and encoded
/// with AVAssetWriter. We deliberately avoid AVVideoComposition: on iOS 27 any custom/Core Image compositor fails
/// (see SmileEngineModule.swift), and frame-by-frame rendering also gives us exact output frame rates.
/// Audio (clip sound with speed + volume, plus music tracks) is mixed by an AVMutableComposition + AVAudioMix.
final class SmileExporter: @unchecked Sendable {
  private let spec: ExportSpec
  private let onProgress: (Double) -> Void
  private let lock = NSLock()
  private var isCancelled = false
  private var musicAssets: [AVURLAsset] = []

  init(spec: ExportSpec, onProgress: @escaping (Double) -> Void) {
    self.spec = spec
    self.onProgress = onProgress
  }

  func cancel() {
    lock.withLock { isCancelled = true }
  }

  private var cancelled: Bool { lock.withLock { isCancelled } }

  func run() async throws -> URL {
    guard let out = URL(string: spec.output), spec.width > 0, spec.height > 0, !spec.clips.isEmpty else {
      throw ExportFailedException("Nothing to export")
    }
    try? FileManager.default.removeItem(at: out)
    try FileManager.default.createDirectory(at: out.deletingLastPathComponent(), withIntermediateDirectories: true)

    var sources: [ClipSource] = []
    for clip in spec.clips {
      guard let url = URL(string: clip.uri) else { throw ExportFailedException("Bad media path \(clip.uri)") }
      if clip.still {
        // Photos are stored as upright JPEGs (see importPhoto).
        guard let image = CIImage(contentsOf: url) else { throw ExportFailedException("\(url.lastPathComponent) could not be read") }
        sources.append(ClipSource(asset: nil, video: nil, still: image, orientation: .up, audio: nil, audioRange: nil))
        continue
      }
      let asset = AVURLAsset(url: url)
      guard let video = try await asset.loadTracks(withMediaType: .video).first else {
        throw ExportFailedException("\(url.lastPathComponent) has no video track")
      }
      let transform = try await video.load(.preferredTransform)
      let audio = try await asset.loadTracks(withMediaType: .audio).first
      let audioRange = try await audio?.load(.timeRange)
      sources.append(
        ClipSource(
          asset: asset, video: video, still: nil, orientation: SmileColor.orientation(transform), audio: audio,
          audioRange: audioRange))
    }
    // Crossfades show the incoming clip's first frame before the cut and the outgoing clip's last frame after it.
    for (i, clip) in spec.clips.enumerated() where i > 0 && clip.transition > 0 {
      sources[i].first = try await edgeFrame(sources[i], at: clip.sourceIn)
      sources[i - 1].last = try await edgeFrame(sources[i - 1], at: max(spec.clips[i - 1].sourceIn, spec.clips[i - 1].sourceOut - 0.03))
    }
    let audioMix = try await makeAudioMix(sources)
    let texts = spec.texts.compactMap { TextLayer($0, canvasWidth: Double(spec.width), canvasHeight: Double(spec.height)) }

    let writer = try AVAssetWriter(outputURL: out, fileType: .mp4)
    let videoInput = AVAssetWriterInput(
      mediaType: .video,
      outputSettings: [
        AVVideoCodecKey: AVVideoCodecType.h264,
        AVVideoWidthKey: spec.width,
        AVVideoHeightKey: spec.height,
        AVVideoCompressionPropertiesKey: [
          AVVideoAverageBitRateKey: spec.bitrate,
          AVVideoExpectedSourceFrameRateKey: spec.fps,
          AVVideoMaxKeyFrameIntervalKey: spec.fps * 2,
          AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
        ],
        AVVideoColorPropertiesKey: [
          AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2,
          AVVideoTransferFunctionKey: AVVideoTransferFunction_ITU_R_709_2,
          AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2,
        ],
      ])
    videoInput.expectsMediaDataInRealTime = false
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(
      assetWriterInput: videoInput,
      sourcePixelBufferAttributes: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
        kCVPixelBufferWidthKey as String: spec.width,
        kCVPixelBufferHeightKey as String: spec.height,
        kCVPixelBufferMetalCompatibilityKey as String: true,
      ])
    writer.add(videoInput)

    var audioInput: AVAssetWriterInput?
    if audioMix != nil {
      let input = AVAssetWriterInput(
        mediaType: .audio,
        outputSettings: [
          AVFormatIDKey: kAudioFormatMPEG4AAC,
          AVSampleRateKey: 44100,
          AVNumberOfChannelsKey: 2,
          AVEncoderBitRateKey: 192_000,
        ])
      input.expectsMediaDataInRealTime = false
      writer.add(input)
      audioInput = input
    }

    guard writer.startWriting() else {
      throw ExportFailedException(writer.error?.localizedDescription ?? "Could not start writing")
    }
    writer.startSession(atSourceTime: .zero)
    if let audioMix, !audioMix.reader.startReading() {
      writer.cancelWriting()
      throw ExportFailedException(audioMix.reader.error?.localizedDescription ?? "Could not read audio")
    }

    let renderer = FrameRenderer(spec: spec, sources: sources, texts: texts)
    let frameCount = max(1, Int((spec.duration * Double(spec.fps) - 0.001).rounded(.up)))
    var failure: Error?

    await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
      let group = DispatchGroup()

      group.enter()
      var frame = 0
      var videoDone = false
      var lastReport = 0.0
      let finishVideo = {
        if videoDone { return }
        videoDone = true
        videoInput.markAsFinished()
        group.leave()
      }
      videoInput.requestMediaDataWhenReady(on: DispatchQueue(label: "smile.export.video")) { [self] in
        while videoInput.isReadyForMoreMediaData && !videoDone {
          if cancelled || frame >= frameCount {
            finishVideo()
            return
          }
          var ok = false
          autoreleasepool {
            do {
              let buffer = try renderer.render(frame: frame, pool: adaptor.pixelBufferPool)
              ok = adaptor.append(buffer, withPresentationTime: CMTime(value: CMTimeValue(frame), timescale: CMTimeScale(spec.fps)))
              if !ok { failure = writer.error ?? ExportFailedException("Could not encode frame \(frame)") }
            } catch {
              failure = error
            }
          }
          if !ok {
            finishVideo()
            return
          }
          frame += 1
          let progress = Double(frame) / Double(frameCount)
          if progress - lastReport >= 0.01 {
            lastReport = progress
            onProgress(progress)
          }
        }
      }

      if let audioInput, let audioMix {
        group.enter()
        var audioDone = false
        audioInput.requestMediaDataWhenReady(on: DispatchQueue(label: "smile.export.audio")) { [self] in
          while audioInput.isReadyForMoreMediaData && !audioDone {
            if !cancelled, failure == nil, let sample = audioMix.output.copyNextSampleBuffer() {
              audioInput.append(sample)
              continue
            }
            audioDone = true
            audioInput.markAsFinished()
            group.leave()
          }
        }
      }

      group.notify(queue: .global()) { done.resume() }
    }

    renderer.finish()
    audioMix?.reader.cancelReading()
    if cancelled || failure != nil {
      writer.cancelWriting()
      try? FileManager.default.removeItem(at: out)
      if let failure { throw failure }
      throw ExportCancelledException()
    }
    writer.endSession(atSourceTime: CMTime(seconds: spec.duration, preferredTimescale: 600))
    await writer.finishWriting()
    guard writer.status == .completed else {
      try? FileManager.default.removeItem(at: out)
      throw ExportFailedException(writer.error?.localizedDescription ?? "Writing failed")
    }
    return out
  }

  /// One exact frame of a clip, oriented for display (the photo itself for stills).
  private func edgeFrame(_ source: ClipSource, at seconds: Double) async throws -> CIImage? {
    if let still = source.still { return still }
    guard let asset = source.asset else { return nil }
    let generator = AVAssetImageGenerator(asset: asset)
    generator.appliesPreferredTrackTransform = false // oriented below, like decoded frames
    generator.requestedTimeToleranceBefore = .zero
    generator.requestedTimeToleranceAfter = .zero
    let (image, _) = try await generator.image(at: CMTime(seconds: seconds, preferredTimescale: 600))
    return CIImage(cgImage: image).oriented(source.orientation)
  }

  /// Inserting past the end of a composition track fails (-12780), so fill the gap with an empty edit first.
  private func insert(_ range: CMTimeRange, of source: AVAssetTrack, into track: AVMutableCompositionTrack, at: CMTime) throws {
    let end = track.timeRange.end
    if at > end { track.insertEmptyTimeRange(CMTimeRange(start: end, end: at)) }
    try track.insertTimeRange(range, of: source, at: at)
  }

  /// A constant volume from `from`, or the fade envelope (timeline keyframes) as consecutive ramps. Ramps alone,
  /// without a `setVolume` at the same instant: the two must not overlap.
  private func applyVolume(_ volume: Double, envelope e: [Double], from: CMTime, to p: AVMutableAudioMixInputParameters) {
    guard e.count >= 4 else {
      p.setVolume(Float(volume), at: from)
      return
    }
    let time = { (s: Double) in CMTime(seconds: s, preferredTimescale: 48000) }
    for i in stride(from: 0, to: e.count - 2, by: 2) where e[i + 2] > e[i] {
      p.setVolumeRamp(
        fromStartVolume: Float(volume * e[i + 1]), toEndVolume: Float(volume * e[i + 3]),
        timeRange: CMTimeRange(start: time(e[i]), end: time(e[i + 2])))
    }
  }

  /// Clip sound (with speed and volume) on one track, each music clip on its own track, mixed down.
  private func makeAudioMix(_ sources: [ClipSource]) async throws -> (reader: AVAssetReader, output: AVAssetReaderAudioMixOutput)? {
    let composition = AVMutableComposition()
    var tracks: [AVAssetTrack] = []
    var params: [AVMutableAudioMixInputParameters] = []
    let time = { (s: Double) in CMTime(seconds: s, preferredTimescale: 48000) }

    if let main = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) {
      let p = AVMutableAudioMixInputParameters(track: main)
      var used = false
      for (clip, source) in zip(spec.clips, sources) {
        guard let audio = source.audio, let available = source.audioRange, clip.volume > 0 else { continue }
        let range = CMTimeRange(start: time(clip.sourceIn), end: time(clip.sourceOut)).intersection(available)
        guard range.duration > .zero else { continue }
        let at = time(clip.start)
        try insert(range, of: audio, into: main, at: at)
        if clip.speed != 1 {
          main.scaleTimeRange(
            CMTimeRange(start: at, duration: range.duration),
            toDuration: time(range.duration.seconds / clip.speed))
        }
        applyVolume(clip.volume, envelope: clip.envelope, from: at, to: p)
        used = true
      }
      if used {
        tracks.append(main)
        params.append(p)
      } else {
        composition.removeTrack(main)
      }
    }

    for music in spec.audio {
      guard let url = URL(string: music.uri) else { continue }
      // A track doesn't retain its asset: keep the asset alive or inserting from the track fails (-12780).
      let asset = AVURLAsset(url: url)
      musicAssets.append(asset)
      guard let audio = try await asset.loadTracks(withMediaType: .audio).first,
        let track = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)
      else { continue }
      let available = try await audio.load(.timeRange)
      let range = CMTimeRange(start: time(music.sourceIn), end: time(music.sourceOut)).intersection(available)
      guard range.duration > .zero else {
        composition.removeTrack(track)
        continue
      }
      try insert(range, of: audio, into: track, at: time(music.start))
      let p = AVMutableAudioMixInputParameters(track: track)
      applyVolume(music.volume, envelope: music.envelope, from: .zero, to: p)
      tracks.append(track)
      params.append(p)
    }

    guard !tracks.isEmpty else { return nil }
    let mix = AVMutableAudioMix()
    mix.inputParameters = params
    let reader = try AVAssetReader(asset: composition)
    reader.timeRange = CMTimeRange(start: .zero, duration: time(spec.duration))
    let output = AVAssetReaderAudioMixOutput(
      audioTracks: tracks,
      audioSettings: [
        AVFormatIDKey: kAudioFormatLinearPCM,
        AVSampleRateKey: 44100,
        AVNumberOfChannelsKey: 2,
        AVLinearPCMBitDepthKey: 16,
        AVLinearPCMIsFloatKey: false,
        AVLinearPCMIsBigEndianKey: false,
        AVLinearPCMIsNonInterleaved: false,
      ])
    output.audioMix = mix
    // Keep the pitch of sped-up / slowed-down clips, like the preview does.
    output.audioTimePitchAlgorithm = .spectral
    reader.add(output)
    return (reader, output)
  }
}

private struct ClipSource {
  let asset: AVURLAsset?
  let video: AVAssetTrack?
  /// A photo instead of a video.
  let still: CIImage?
  let orientation: CGImagePropertyOrientation
  let audio: AVAssetTrack?
  let audioRange: CMTimeRange?
  /// Display-oriented first / last frames, loaded only when a crossfade needs them.
  var first: CIImage?
  var last: CIImage?
}

// MARK: - Frames

/// Produces output frame `n` by sampling the clip under the playhead and drawing it like the preview does.
private final class FrameRenderer {
  private let spec: ExportSpec
  private let sources: [ClipSource]
  private let texts: [TextLayer]
  private let context = CIContext(options: [.cacheIntermediates: false])
  private let canvas: CGRect
  private let black: CIImage
  /// Solid fill behind each clip (nil for black, which is already the base, and for blur: see backdrop).
  private let fill: CIImage?
  private let blur: Bool
  private var reader: ClipReader?
  private var readerIndex = -1
  private var effectImages: [Int: CIImage] = [:]

  init(spec: ExportSpec, sources: [ClipSource], texts: [TextLayer]) {
    self.spec = spec
    self.sources = sources
    self.texts = texts
    canvas = CGRect(x: 0, y: 0, width: spec.width, height: spec.height)
    black = CIImage(color: .black).cropped(to: canvas)
    blur = spec.background == "blur"
    fill = blur || spec.background.uppercased() == "#000000"
      ? nil : CIImage(color: CIColor(color: TextLayer.color(spec.background))).cropped(to: canvas)
  }

  func render(frame n: Int, pool: CVPixelBufferPool?) throws -> CVPixelBuffer {
    let t = Double(n) / Double(spec.fps)
    var image = black
    if let index = clipIndex(at: t), let frame = try sourceFrame(index, at: t) {
      effectImages = effectImages.filter { abs($0.key - index) <= 1 }
      // Crossfades (same as the preview): the earlier clip fully drawn, the later one over it at its weight.
      if let w = crossfade(into: index, at: t), let last = sources[index - 1].last {
        image = compositeSRGB(layer(last, index - 1, at: t), 1, over: image)
        image = compositeSRGB(layer(frame, index, at: t), w, over: image)
      } else if let w = crossfade(into: index + 1, at: t), let first = sources[index + 1].first {
        image = compositeSRGB(layer(frame, index, at: t), 1, over: image)
        image = compositeSRGB(layer(first, index + 1, at: t), w, over: image)
      } else {
        image = compositeSRGB(layer(frame, index, at: t), 1, over: image)
      }
    }
    for text in texts where t >= text.start && t < text.end {
      if let layer = text.image(at: t, canvasHeight: Double(spec.height)) { image = compositeSRGB(layer, 1, over: image) }
    }
    guard let pool else { throw ExportFailedException("No pixel buffer pool") }
    var buffer: CVPixelBuffer?
    guard CVPixelBufferPoolCreatePixelBuffer(nil, pool, &buffer) == kCVReturnSuccess, let buffer else {
      throw ExportFailedException("Out of memory")
    }
    context.render(image.cropped(to: canvas), to: buffer, bounds: canvas, colorSpace: CGColorSpace(name: CGColorSpace.sRGB))
    return buffer
  }

  func finish() {
    reader?.cancel()
    reader = nil
  }

  /// Weight of clip `index` in its crossfade window at `t`, or nil outside it (mirrors crossfadeWeight).
  private func crossfade(into index: Int, at t: Double) -> Double? {
    guard index > 0, index < spec.clips.count else { return nil }
    let c = spec.clips[index]
    guard c.transition > 0, abs(t - c.start) <= c.transition / 2 else { return nil }
    return (t - (c.start - c.transition / 2)) / c.transition
  }

  /// A clip's frame placed on the canvas over its background, with its fade-to-black opacity.
  private func layer(_ frame: CIImage, _ index: Int, at t: Double) -> CIImage {
    let clip = spec.clips[index]
    var image = place(frame, clip: clip, at: t)
    if blur { image = image.composited(over: backdrop(frame, clip: clip)) } else { image = image.composited(over: fill ?? black) }
    if let effects = effectsImage(index) {
      // UIKit/RN scene overlays blend gamma-encoded sRGB; Core Image otherwise blends in linear light.
      // Use the same transfer curves as SmileColor so intensity matches the live preview.
      image = compositeSRGB(effects, 1, over: image)
    }
    let gain = envelopeGain(clip.envelope, at: t)
    return gain >= 1 ? image : compositeSRGB(image, gain, over: black)
  }

  /// Draw the same y-down, normalized primitives as EffectsOverlay.tsx. Cache only nearby scene textures.
  private func effectsImage(_ index: Int) -> CIImage? {
    if let cached = effectImages[index] { return cached }
    let primitives = spec.clips[index].effects
    guard !primitives.isEmpty else { return nil }
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = false
    format.preferredRange = .standard
    let size = CGSize(width: spec.width, height: spec.height)
    let rendered = UIGraphicsImageRenderer(size: size, format: format).image { renderer in
      let context = renderer.cgContext
      for primitive in primitives.prefix(512) {
        guard [primitive.x, primitive.y, primitive.w, primitive.h, primitive.a0, primitive.a1].allSatisfy({ $0.isFinite }), primitive.w > 0, primitive.h > 0 else { continue }
        let rect = CGRect(x: primitive.x * size.width, y: primitive.y * size.height, width: primitive.w * size.width, height: primitive.h * size.height)
        let color = TextLayer.color(primitive.color)
        let start = color.withAlphaComponent(min(1, max(0, primitive.a0)))
        let end = color.withAlphaComponent(min(1, max(0, primitive.a1)))
        if primitive.axis == "solid" {
          context.setFillColor(start.cgColor)
          context.fill(rect)
        } else if let gradient = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB), colors: [start.cgColor, end.cgColor] as CFArray, locations: [0, 1]) {
          context.saveGState()
          context.clip(to: rect)
          context.drawLinearGradient(gradient, start: rect.origin, end: primitive.axis == "x" ? CGPoint(x: rect.maxX, y: rect.minY) : CGPoint(x: rect.minX, y: rect.maxY), options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
          context.restoreGState()
        }
      }
    }
    guard let cgImage = rendered.cgImage else { return nil }
    let result = CIImage(cgImage: cgImage)
    effectImages[index] = result
    return result
  }

  /// The 'blur' background: the cropped, color graded frame scaled to cover the canvas and blurred (radius 4% of
  /// the canvas width, like the preview's BACKGROUND_BLUR).
  private func backdrop(_ oriented: CIImage, clip: ExportClip) -> CIImage {
    var image = oriented.transformed(by: CGAffineTransform(translationX: -oriented.extent.minX, y: -oriented.extent.minY))
    let c = clip.crop
    let rect = CGRect(
      x: c.x * image.extent.width, y: (1 - c.y - c.h) * image.extent.height,
      width: c.w * image.extent.width, height: c.h * image.extent.height)
    image = image.cropped(to: rect)
    if let m = clip.matrix, m.count == 20 { image = SmileColor.apply(m, to: image) }
    let k = max(canvas.width / rect.width, canvas.height / rect.height)
    let cover = CGAffineTransform(translationX: -rect.midX, y: -rect.midY)
      .concatenating(CGAffineTransform(scaleX: k, y: k))
      .concatenating(CGAffineTransform(translationX: canvas.midX, y: canvas.midY))
    return image.transformed(by: cover).clampedToExtent()
      .applyingGaussianBlur(sigma: 0.04 * canvas.width).cropped(to: canvas)
  }

  private func clipIndex(at t: Double) -> Int? {
    if let i = spec.clips.lastIndex(where: { $0.start <= t + 1e-9 }), t < spec.clips[i].start + spec.clips[i].duration {
      return i
    }
    return spec.clips.isEmpty ? nil : spec.clips.count - 1
  }

  /// The clip's frame at timeline time `t`, oriented for display.
  private func sourceFrame(_ index: Int, at t: Double) throws -> CIImage? {
    let clip = spec.clips[index]
    let src = sources[index]
    if let still = src.still { return still }
    guard let asset = src.asset, let track = src.video else { return nil }
    if index != readerIndex {
      reader?.cancel()
      reader = try ClipReader(asset: asset, track: track, from: clip.sourceIn, to: clip.sourceOut)
      readerIndex = index
    }
    let source = clip.sourceIn + (t - clip.start) * clip.speed
    return reader?.frame(at: min(source, clip.sourceOut)).map { CIImage(cvPixelBuffer: $0).oriented(src.orientation) }
  }

  /// Same geometry as the preview's ClipLayer: crop, fit the frame centered in the canvas, then the user's
  /// scale / flip / rotation (clockwise) / offset. Core Image is y-up, so angles and y offsets are mirrored.
  /// Ken Burns grows the scale linearly over the clip (clamped outside it, like kenBurnsScale).
  private func place(_ oriented: CIImage, clip: ExportClip, at t: Double) -> CIImage {
    var image = oriented
    image = image.transformed(by: CGAffineTransform(translationX: -image.extent.minX, y: -image.extent.minY))
    let w = image.extent.width
    let h = image.extent.height
    let c = clip.crop
    let rect = CGRect(x: c.x * w, y: (1 - c.y - c.h) * h, width: c.w * w, height: c.h * h)
    image = image.cropped(to: rect)
    if let m = clip.matrix, m.count == 20 { image = SmileColor.apply(m, to: image) }
    let tr = clip.transform
    let progress = clip.duration > 0 ? min(1, max(0, (t - clip.start) / clip.duration)) : 0
    let scale = tr.scale * (1 + clip.kenBurns * progress)
    let W = Double(spec.width)
    let H = Double(spec.height)
    let placement = CGAffineTransform(translationX: -rect.midX, y: -rect.midY)
      .concatenating(
        CGAffineTransform(
          scaleX: clip.frameWidth / rect.width * scale * (tr.flip ? -1 : 1),
          y: clip.frameHeight / rect.height * scale))
      .concatenating(CGAffineTransform(rotationAngle: -tr.rotation * .pi / 180))
      .concatenating(CGAffineTransform(translationX: W / 2 + tr.x * W, y: H / 2 - tr.y * H))
    return image.transformed(by: placement)
  }
}

/// Reads one clip's frames in order and returns, for a source time, the latest frame at or before it.
private final class ClipReader {
  private let reader: AVAssetReader
  private let output: AVAssetReaderTrackOutput
  private var current: CVPixelBuffer?
  private var pending: CMSampleBuffer?
  private var ended = false

  init(asset: AVAsset, track: AVAssetTrack, from: Double, to: Double) throws {
    reader = try AVAssetReader(asset: asset)
    output = AVAssetReaderTrackOutput(
      track: track, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
    output.alwaysCopiesSampleData = false
    reader.add(output)
    reader.timeRange = CMTimeRange(
      start: CMTime(seconds: from, preferredTimescale: 600), end: CMTime(seconds: to + 0.1, preferredTimescale: 600))
    guard reader.startReading() else {
      throw ExportFailedException(reader.error?.localizedDescription ?? "Could not decode video")
    }
  }

  func frame(at time: Double) -> CVPixelBuffer? {
    while !ended {
      if pending == nil {
        pending = output.copyNextSampleBuffer()
        if pending == nil {
          ended = true
          break
        }
      }
      guard let sample = pending else { break }
      guard let image = CMSampleBufferGetImageBuffer(sample) else {
        pending = nil
        continue
      }
      let pts = CMSampleBufferGetPresentationTimeStamp(sample).seconds
      // Take frames up to `time`; if there is none yet (first frame starts a bit later), take the first one.
      if pts > time + 0.0005 && current != nil { break }
      current = image
      pending = nil
      if pts > time { break }
    }
    return current
  }

  func cancel() {
    if reader.status == .reading { reader.cancelReading() }
  }
}

// MARK: - Text

/// A text overlay pre-rendered once and placed on the canvas each frame (its in / out animation moves it).
private struct TextLayer {
  /// Centered on the origin, unrotated.
  let image: CIImage
  let start: Double
  let end: Double
  let x: Double
  let y: Double
  let rotation: Double
  let animIn: String
  let animOut: String
  let animDuration: Double

  /// Mirrors textAnimAt in src/core/timeline.ts.
  func image(at t: Double, canvasHeight H: Double) -> CIImage? {
    var s = (alpha: 1.0, scale: 1.0, dy: 0.0)
    if animDuration > 0 {
      TextLayer.animPhase(animIn, (t - start) / animDuration, 1, &s)
      TextLayer.animPhase(animOut, (end - t) / animDuration, -1, &s)
    }
    if s.alpha <= 0 { return nil }
    // Center at (x, y + dy) (y-down canvas pixels), rotated clockwise around its center; Core Image is y-up.
    let placed = image.transformed(
      by: CGAffineTransform(scaleX: s.scale, y: s.scale)
        .concatenating(CGAffineTransform(rotationAngle: -rotation * .pi / 180))
        .concatenating(CGAffineTransform(translationX: x, y: H - (y + s.dy * H))))
    return opacity(placed, s.alpha)
  }

  static func animPhase(_ kind: String, _ p: Double, _ dir: Double, _ s: inout (alpha: Double, scale: Double, dy: Double)) {
    if kind == "none" || kind.isEmpty || p >= 1 { return }
    let q = max(0, p)
    let k = 1 - (1 - q) * (1 - q) * (1 - q)
    s.alpha *= k
    if kind == "slide" { s.dy += dir * (1 - k) * 0.06 }
    if kind == "slideDown" { s.dy -= dir * (1 - k) * 0.06 }
    if kind == "pop" {
      let b = 1 + 2.70158 * (q - 1) * (q - 1) * (q - 1) + 1.70158 * (q - 1) * (q - 1)
      s.scale *= 0.4 + 0.6 * b
    }
    if kind == "bounce" {
      var progress = q
      let bounce: Double
      if progress < 1 / 2.75 {
        bounce = 7.5625 * progress * progress
      } else if progress < 2 / 2.75 {
        progress -= 1.5 / 2.75
        bounce = 7.5625 * progress * progress + 0.75
      } else if progress < 2.5 / 2.75 {
        progress -= 2.25 / 2.75
        bounce = 7.5625 * progress * progress + 0.9375
      } else {
        progress -= 2.625 / 2.75
        bounce = 7.5625 * progress * progress + 0.984375
      }
      s.scale *= 0.55 + 0.45 * bounce
      s.dy += dir * (1 - bounce) * 0.045
    }
    if kind == "zoomIn" { s.scale *= 0.6 + 0.4 * k }
    if kind == "zoomOut" { s.scale *= 1.5 - 0.5 * k }
    if kind == "rise" {
      s.dy += dir * (1 - q) * 0.1
      s.scale *= 0.94 + 0.06 * k
    }
    if kind == "pulse" { s.scale *= 1 + 0.18 * (1 - q) * sin(q * .pi * 3) }
  }

  /// Mirrors the preview's TextLayer styles (src/editor/Preview.tsx). The shadow is specified in preview points;
  /// ~400pt is a typical preview width, so it scales with the canvas.
  init?(_ t: ExportText, canvasWidth W: Double, canvasHeight H: Double) {
    let px = t.fontSize
    guard px > 0, !t.text.isEmpty else { return nil }
    let font = TextLayer.font(t.font, size: px)
    let paragraph = NSMutableParagraphStyle()
    paragraph.alignment = .center
    paragraph.minimumLineHeight = px * 1.2
    paragraph.maximumLineHeight = px * 1.2
    var attributes: [NSAttributedString.Key: Any] = [
      .font: font,
      .foregroundColor: TextLayer.color(t.color),
      .paragraphStyle: paragraph,
      .baselineOffset: (px * 1.2 - font.lineHeight) / 2,
    ]
    let shadowUnit = W / 400
    if !t.box {
      let shadow = NSShadow()
      shadow.shadowColor = UIColor(white: 0, alpha: 0.55)
      shadow.shadowOffset = CGSize(width: 0, height: shadowUnit)
      shadow.shadowBlurRadius = 4 * shadowUnit
      attributes[.shadow] = shadow
    }
    let string = NSAttributedString(string: t.text, attributes: attributes)
    let padX = t.box ? px * 0.35 : 0
    let padY = t.box ? px * 0.12 : 0
    let margin = t.box ? 0 : ceil(6 * shadowUnit)
    let bounds = string.boundingRect(
      with: CGSize(width: W * 0.9 - 2 * padX, height: .greatestFiniteMagnitude),
      options: [.usesLineFragmentOrigin, .usesFontLeading], context: nil)
    let textSize = CGSize(width: ceil(bounds.width), height: ceil(bounds.height))
    let size = CGSize(width: textSize.width + 2 * (padX + margin), height: textSize.height + 2 * (padY + margin))

    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = false
    let rendered = UIGraphicsImageRenderer(size: size, format: format).image { ctx in
      let cg = ctx.cgContext
      cg.setAlpha(t.opacity)
      cg.beginTransparencyLayer(auxiliaryInfo: nil)
      if t.box {
        UIColor(white: 0, alpha: 0.6).setFill()
        UIBezierPath(roundedRect: CGRect(origin: .zero, size: size), cornerRadius: px * 0.25).fill()
      }
      string.draw(
        with: CGRect(x: padX + margin, y: padY + margin, width: textSize.width, height: textSize.height),
        options: [.usesLineFragmentOrigin, .usesFontLeading], context: nil)
      cg.endTransparencyLayer()
    }
    guard let cgImage = rendered.cgImage else { return nil }

    image = CIImage(cgImage: cgImage).transformed(
      by: CGAffineTransform(translationX: -size.width / 2, y: -size.height / 2))
    start = t.start
    end = t.end
    x = t.x
    y = t.y
    rotation = t.rotation
    animIn = t.animIn
    animOut = t.animOut
    animDuration = t.animDuration
  }

  static func font(_ id: String, size: Double) -> UIFont {
    switch id {
    case "serif": return UIFont(name: "Georgia-Bold", size: size) ?? .systemFont(ofSize: size, weight: .bold)
    case "mono": return UIFont(name: "Menlo-Bold", size: size) ?? .monospacedSystemFont(ofSize: size, weight: .bold)
    case "rounded":
      let base = UIFont.systemFont(ofSize: size, weight: .heavy)
      return base.fontDescriptor.withDesign(.rounded).map { UIFont(descriptor: $0, size: size) } ?? base
    case "condensed":
      return UIFont(name: "AvenirNextCondensed-Heavy", size: size) ?? .systemFont(ofSize: size, weight: .heavy)
    default: return .systemFont(ofSize: size, weight: .heavy)
    }
  }

  /// `#RRGGBB` or `#RRGGBBAA`.
  static func color(_ hex: String) -> UIColor {
    let s = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
    guard let v = UInt64(s, radix: 16), s.count == 6 || s.count == 8 else { return .white }
    let rgba = s.count == 6 ? (v << 8) | 0xFF : v
    return UIColor(
      red: CGFloat((rgba >> 24) & 0xFF) / 255, green: CGFloat((rgba >> 16) & 0xFF) / 255,
      blue: CGFloat((rgba >> 8) & 0xFF) / 255, alpha: CGFloat(rgba & 0xFF) / 255)
  }
}

// MARK: - Fades

/// Piecewise-linear `[time, gain, ...]` keyframes (see fadeEnvelope in src/core/timeline.ts); empty = 1.
private func envelopeGain(_ e: [Double], at t: Double) -> Double {
  guard e.count >= 4 else { return 1 }
  if t <= e[0] { return e[1] }
  for i in stride(from: 0, to: e.count - 2, by: 2) where t <= e[i + 2] {
    let span = e[i + 2] - e[i]
    return span > 0 ? e[i + 1] + (e[i + 3] - e[i + 1]) * (t - e[i]) / span : e[i + 3]
  }
  return e[e.count - 1]
}

/// `image` with its alpha scaled by `alpha` (Core Image color filters work on unpremultiplied color).
private func opacity(_ image: CIImage, _ alpha: Double) -> CIImage {
  if alpha >= 1 { return image }
  return image.applyingFilter("CIColorMatrix", parameters: ["inputAVector": CIVector(x: 0, y: 0, z: 0, w: max(0, alpha))])
}

/// Match RN/Core Animation source-over in display sRGB, despite Core Image's linear working color space.
private func compositeSRGB(_ foreground: CIImage, _ alpha: Double, over background: CIImage) -> CIImage {
  opacity(foreground.applyingFilter("CILinearToSRGBToneCurve"), alpha)
    .composited(over: background.applyingFilter("CILinearToSRGBToneCurve"))
    .applyingFilter("CISRGBToneCurveToLinear")
}
