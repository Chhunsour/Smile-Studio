import AVFoundation
import CoreImage
import ExpoModulesCore
import MetalKit

/// Shows the frames of an AVPlayer through a color matrix. Sits on top of the player's own view and simply covers
/// it, so play/pause/seek keep working exactly as before.
class SmileColorView: ExpoView, MTKViewDelegate {
  private let device = MTLCreateSystemDefaultDevice()
  private lazy var queue = device?.makeCommandQueue()
  private lazy var ciContext: CIContext? = device.map { CIContext(mtlDevice: $0) }
  private let mtkView = MTKView()

  private weak var player: AVPlayer?
  private weak var item: AVPlayerItem?
  private var output: AVPlayerItemVideoOutput?
  private var itemObservation: NSKeyValueObservation?
  private var displayLink: CADisplayLink?
  private var matrix: [Double]?
  private var orientation: CGImagePropertyOrientation = .up
  /// Last decoded (unfiltered) frame, so a matrix change while paused redraws immediately.
  private var lastFrame: CIImage?
  private var imageURL: URL?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    mtkView.device = device
    mtkView.delegate = self
    mtkView.framebufferOnly = false
    mtkView.isPaused = true
    mtkView.enableSetNeedsDisplay = true
    mtkView.isOpaque = false
    mtkView.backgroundColor = .clear
    mtkView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    addSubview(mtkView)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    mtkView.frame = bounds
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil {
      displayLink?.invalidate()
      displayLink = nil
    } else if displayLink == nil {
      let link = CADisplayLink(target: self, selector: #selector(tick))
      link.add(to: .main, forMode: .common)
      displayLink = link
    }
  }

  deinit {
    displayLink?.invalidate()
    detachOutput()
  }

  func setPlayer(_ newPlayer: AVPlayer?) {
    guard newPlayer !== player else { return }
    itemObservation = nil
    detachOutput()
    player = newPlayer
    // The pool's players load their item asynchronously, so follow `currentItem`.
    itemObservation = newPlayer?.observe(\.currentItem, options: [.initial, .new]) { [weak self] player, _ in
      DispatchQueue.main.async { self?.attach(to: player.currentItem) }
    }
  }

  /// A photo (upright JPEG) to draw instead of a player's frames.
  func setImage(_ url: URL?) {
    guard url != imageURL else { return }
    imageURL = url
    lastFrame = url.flatMap { CIImage(contentsOf: $0) }
    mtkView.setNeedsDisplay()
  }

  func setMatrix(_ m: [Double]?) {
    matrix = (m?.count == 20) ? m : nil
    mtkView.setNeedsDisplay()
  }

  private func attach(to newItem: AVPlayerItem?) {
    guard newItem !== item else { return }
    detachOutput()
    guard let newItem else { return }
    let out = AVPlayerItemVideoOutput(pixelBufferAttributes: [
      kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
      kCVPixelBufferMetalCompatibilityKey as String: true,
    ])
    newItem.add(out)
    item = newItem
    output = out
    lastFrame = nil
    Task { [weak self] in
      let transform = try? await newItem.asset.loadTracks(withMediaType: .video).first?.load(.preferredTransform)
      await MainActor.run {
        self?.orientation = SmileColor.orientation(transform ?? .identity)
        // A paused player only hands the output a frame after a seek: re-seek in place to get one.
        if let player = self?.player, player.rate == 0 {
          player.seek(to: player.currentTime(), toleranceBefore: .zero, toleranceAfter: .zero)
        }
      }
    }
  }

  private func detachOutput() {
    if let output, let item, item.outputs.contains(output) {
      item.remove(output)
    }
    output = nil
    item = nil
  }

  @objc private func tick() {
    guard let output else { return }
    let time = output.itemTime(forHostTime: CACurrentMediaTime())
    guard output.hasNewPixelBuffer(forItemTime: time),
      let buffer = output.copyPixelBuffer(forItemTime: time, itemTimeForDisplay: nil)
    else { return }
    lastFrame = CIImage(cvPixelBuffer: buffer).oriented(orientation)
    mtkView.setNeedsDisplay()
  }

  // MARK: MTKViewDelegate

  func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}

  func draw(in view: MTKView) {
    guard let frame = lastFrame, let ciContext, let queue,
      let drawable = view.currentDrawable, let buffer = queue.makeCommandBuffer()
    else { return }
    var image = frame.transformed(by: CGAffineTransform(translationX: -frame.extent.minX, y: -frame.extent.minY))
    if let matrix { image = SmileColor.apply(matrix, to: image) }
    // The JS side sizes this view to the frame's aspect ratio, so stretching to fill is exact.
    let size = view.drawableSize
    image = image.transformed(by: CGAffineTransform(scaleX: size.width / image.extent.width, y: size.height / image.extent.height))
    ciContext.render(
      image,
      to: drawable.texture,
      commandBuffer: buffer,
      bounds: CGRect(origin: .zero, size: size),
      colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!
    )
    buffer.present(drawable)
    buffer.commit()
  }
}
