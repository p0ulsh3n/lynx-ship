import Foundation
import Lynx
import UIKit

public protocol LynxShipContainerDelegate: AnyObject {
  func containerDidPrepare(_ container: LynxShipContainerView, bundle: String)
  func containerDidFailPreparing(_ container: LynxShipContainerView, bundle: String, error: Error)
  func containerDidStartLoading(_ container: LynxShipContainerView, bundle: String)
  func containerDidStartFetchingResource(_ container: LynxShipContainerView, bundle: String)
  func containerDidReachFirstScreen(_ container: LynxShipContainerView, bundle: String)
  func containerDidUpdate(_ container: LynxShipContainerView, bundle: String)
  func containerDidFailLoading(_ container: LynxShipContainerView, bundle: String, error: Error)
  func containerDidShow(_ container: LynxShipContainerView)
  func containerDidHide(_ container: LynxShipContainerView)
}

/// Optional host-owned loading and failure UI for an embedded Lynx container.
/// Returning nil keeps the container free of presentation overlays.
public protocol LynxShipContainerUIProvider: AnyObject {
  func makeLoadingView(for container: LynxShipContainerView, bundle: String) -> UIView?
  func makeErrorView(
    for container: LynxShipContainerView,
    bundle: String,
    error: Error?,
    retry: @escaping () -> Void
  ) -> UIView?
}

public extension LynxShipContainerUIProvider {
  func makeLoadingView(for container: LynxShipContainerView, bundle: String) -> UIView? { nil }
  func makeErrorView(
    for container: LynxShipContainerView,
    bundle: String,
    error: Error?,
    retry: @escaping () -> Void
  ) -> UIView? { nil }
}

public extension LynxShipContainerDelegate {
  func containerDidPrepare(_ container: LynxShipContainerView, bundle: String) {}
  func containerDidFailPreparing(_ container: LynxShipContainerView, bundle: String, error: Error) {}
  func containerDidStartLoading(_ container: LynxShipContainerView, bundle: String) {}
  func containerDidStartFetchingResource(_ container: LynxShipContainerView, bundle: String) {}
  func containerDidReachFirstScreen(_ container: LynxShipContainerView, bundle: String) {}
  func containerDidUpdate(_ container: LynxShipContainerView, bundle: String) {}
  func containerDidFailLoading(_ container: LynxShipContainerView, bundle: String, error: Error) {}
  func containerDidShow(_ container: LynxShipContainerView) {}
  func containerDidHide(_ container: LynxShipContainerView) {}
}

private final class LynxShipContainerTemplateProvider: NSObject, LynxTemplateProvider {
  private let load: (String) throws -> Data
  private let onStart: (String) -> Void
  private let onError: (Error) -> Void

  init(load: @escaping (String) throws -> Data, onStart: @escaping (String) -> Void, onError: @escaping (Error) -> Void) {
    self.load = load
    self.onStart = onStart
    self.onError = onError
  }

  func loadTemplate(withUrl url: String!, onComplete callback: LynxTemplateLoadBlock!) {
    onStart(url ?? "")
    DispatchQueue.global(qos: .userInitiated).async { [load, onError] in
      do {
        callback(load(url ?? ""), nil)
      } catch {
        onError(error)
        callback(nil, error)
      }
    }
  }
}

private final class LynxShipContainerLifecycleClient: NSObject, LynxViewLifecycle {
  private let onStart: () -> Void
  private let onFirstScreen: () -> Void

  init(onStart: @escaping () -> Void, onFirstScreen: @escaping () -> Void) {
    self.onStart = onStart
    self.onFirstScreen = onFirstScreen
  }

  func lynxViewDidStartLoading(_ view: LynxView) { onStart() }
  func lynxViewDidFirstScreen(_ view: LynxView) { onFirstScreen() }
}

public final class LynxShipContainerView: UIView {
  private static let maxPreparedTemplateBytes = 32 * 1024 * 1024
  public enum State: String { case idle, loading, loaded, failed, released }

  private let assetLoader: (String) throws -> Data
  private let builderConfigurator: LynxShipContainerBuilderConfigurator?
  private let preparedLock = NSLock()
  private weak var delegate: LynxShipContainerDelegate?
  private weak var uiProvider: LynxShipContainerUIProvider?
  private var overlayView: UIView?
  private lazy var templateProvider = LynxShipContainerTemplateProvider(
    load: { [weak self] name in
      guard let self else { throw NSError(domain: "com.lynxship.container", code: 8) }
      return try self.preparedData(for: name) ?? self.assetLoader(name)
    },
    onStart: { [weak self] bundle in
      DispatchQueue.main.async {
        guard let self, self.state != .released else { return }
        self.delegate?.containerDidStartFetchingResource(self, bundle: bundle)
      }
    },
    onError: { [weak self] error in
      DispatchQueue.main.async {
        guard let self, self.state != .released else { return }
        self.state = .failed
        self.showErrorUI(error)
        if let bundleName { self.delegate?.containerDidFailLoading(self, bundle: bundleName, error: error) }
      }
    }
  )
  private lazy var lifecycleClient = LynxShipContainerLifecycleClient(
    onStart: { [weak self] in
      guard let self else { return }
      state = .loading
      showLoadingUI()
      delegate?.containerDidStartLoading(self, bundle: bundleName)
    },
    onFirstScreen: { [weak self] in
      guard let self else { return }
      state = .loaded
      clearOverlay()
      delegate?.containerDidReachFirstScreen(self, bundle: bundleName)
    }
  )
  private lazy var lynxView: LynxView = {
    LynxView { [weak self] builder in
      guard let self else { return }
      builder.config = LynxConfig(provider: templateProvider)
      self.builderConfigurator?.configure(builder)
      builder.fontScale = 1.0
    }
  }()

  public private(set) var state: State = .idle
  public let containerID = UUID().uuidString
  public private(set) var bundleName: String?
  private var initialData = ""
  private var globalProps: [String: Any] = [:]
  private var autoGlobalPropsEnabled = true
  private var appInBackground = false
  private let containerInitTime = ISO8601DateFormatter().string(from: Date())
  private var lifecycleObservers: [NSObjectProtocol] = []

  /// True only after Lynx reports that the first screen has rendered.
  public var isLoadSuccess: Bool { state == .loaded }

  /// Enables the reserved Sparkling-compatible host context by default. Set
  /// false only when the host owns every global-props field itself.
  public func setAutoGlobalProps(_ enabled: Bool) throws {
    try ensureUsable()
    autoGlobalPropsEnabled = enabled
    if state != .idle { pushGlobalProps() }
  }

  public var autoGlobalProps: Bool { autoGlobalPropsEnabled }

  public init(
    frame: CGRect = .zero,
    assetLoader: @escaping (String) throws -> Data,
    delegate: LynxShipContainerDelegate? = nil,
    uiProvider: LynxShipContainerUIProvider? = nil,
    builderConfigurator: LynxShipContainerBuilderConfigurator? = nil
  ) {
    self.assetLoader = assetLoader
    self.builderConfigurator = builderConfigurator
    self.delegate = delegate
    self.uiProvider = uiProvider
    super.init(frame: frame)
    let center = NotificationCenter.default
    lifecycleObservers = [
      center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
        guard let self else { return }
        self.appInBackground = true
        if self.state != .idle && self.state != .released && self.autoGlobalPropsEnabled { self.pushGlobalProps() }
      },
      center.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { [weak self] _ in
        guard let self else { return }
        self.appInBackground = false
        if self.state != .idle && self.state != .released && self.autoGlobalPropsEnabled { self.pushGlobalProps() }
      },
    ]
    addSubview(lynxView)
    lynxView.addLifecycleClient(lifecycleClient)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  public func load(
    bundle: String,
    initialData: String? = nil,
    globalProps: [String: Any] = [:]
  ) throws {
    try ensureUsable()
    guard !bundle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, bundle.count <= 4096 else {
      throw containerError("Lynx bundle name is empty or too long", code: 1)
    }
    bundleName = bundle
    self.initialData = initialData ?? ""
    self.globalProps = globalProps
    state = .loading
    showLoadingUI()
    if autoGlobalPropsEnabled || !globalProps.isEmpty { pushGlobalProps() }
    lynxView.loadTemplate(fromURL: bundle, initData: self.initialData)
  }

  /// Loads and retains one verified bundle source without mounting a Lynx
  /// view. The host loader remains responsible for network and signature
  /// policy; this bounded cache only avoids a duplicate source read.
  public func prepare(bundle: String, completion: ((Result<Void, Error>) -> Void)? = nil) throws {
    try ensureUsable()
    let loader = assetLoader
    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      do {
        guard let self else { return }
        let data = try loader(bundle)
        guard !data.isEmpty, data.count <= Self.maxPreparedTemplateBytes else {
          throw self.containerError("Prepared Lynx bundle is empty or too large", code: 7)
        }
        self.storePrepared(data, for: bundle)
        DispatchQueue.main.async {
          guard self.state != .released else { return }
          self.delegate?.containerDidPrepare(self, bundle: bundle)
          completion?(.success(()))
        }
      } catch {
        DispatchQueue.main.async {
          guard let self, self.state != .released else { return }
          self.delegate?.containerDidFailPreparing(self, bundle: bundle, error: error)
          completion?(.failure(error))
        }
      }
    }
  }

  public func reload() throws {
    try ensureUsable()
    guard let bundleName else { throw containerError("No Lynx bundle has been loaded", code: 2) }
    try load(bundle: bundleName, initialData: initialData, globalProps: globalProps)
  }

  /// Updates initData through Lynx's official non-remounting update API.
  public func updateData(_ data: String, processorName: String? = nil) throws {
    try ensureUsable()
    guard bundleName != nil else { throw containerError("No Lynx bundle has been loaded", code: 8) }
    guard data.utf8.count <= 8 * 1024 * 1024 else {
      throw containerError("Lynx update data is larger than 8 MiB", code: 9)
    }
    if let processorName {
      guard !processorName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
            processorName.count <= 256,
            processorName.rangeOfCharacter(from: .controlCharacters) == nil
      else { throw containerError("Lynx data processor name is invalid", code: 10) }
      let templateData = LynxTemplateData(json: data)
      templateData.markState(processorName)
      lynxView.updateData(withTemplateData: templateData)
    } else {
      lynxView.updateData(withString: data)
    }
    initialData = data
    if let bundleName { delegate?.containerDidUpdate(self, bundle: bundleName) }
  }

  public func updateGlobalProps(_ props: [String: Any]) throws {
    try ensureUsable()
    globalProps = props
    if autoGlobalPropsEnabled { pushGlobalProps() }
    else { lynxView.updateGlobalProps(withDictionary: globalProps) }
  }

  /// Applies a partial global-props update without remounting the view.
  public func updateGlobalPropsByIncrement(_ props: [String: Any]) throws {
    try ensureUsable()
    for (key, value) in props { globalProps[key] = value }
    if autoGlobalPropsEnabled { pushGlobalProps() }
    else { lynxView.updateGlobalProps(withDictionary: props) }
  }

  public func sendGlobalEvent(_ name: String, params: [Any] = []) throws {
    try ensureUsable()
    guard !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, name.count <= 256, params.count <= 256 else {
      throw containerError("Invalid Lynx global event", code: 3)
    }
    lynxView.sendGlobalEvent(name, withParams: params)
  }

  public func updateViewport(width: CGFloat, height: CGFloat) throws {
    try ensureUsable()
    guard width.isFinite, height.isFinite, width >= 0, height >= 0 else {
      throw containerError("Lynx viewport dimensions must be finite and non-negative", code: 4)
    }
    lynxView.updateViewport(withPreferredLayoutWidth: width, preferredLayoutHeight: height, needLayout: true)
  }

  public func show() throws { try ensureUsable(); isHidden = false }
  public func hide() throws { try ensureUsable(); isHidden = true }

  public func release() {
    guard state != .released else { return }
    state = .released
    preparedLock.lock()
    preparedBundle = nil
    preparedTemplate = nil
    preparedLock.unlock()
    clearOverlay()
    lynxView.removeLifecycleClient(lifecycleClient)
    lynxView.destroy()
    lynxView.removeFromSuperview()
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    lynxView.frame = bounds
    overlayView?.frame = bounds
    lynxView.preferredLayoutWidth = bounds.width
    lynxView.preferredLayoutHeight = bounds.height
    lynxView.updateViewport(withPreferredLayoutWidth: bounds.width, preferredLayoutHeight: bounds.height, needLayout: true)
    if state != .idle && state != .released && autoGlobalPropsEnabled { pushGlobalProps() }
  }

  public override func didMoveToWindow() {
    super.didMoveToWindow()
    guard state != .released else { return }
    if window == nil {
      appInBackground = true
      lynxView.onEnterBackground()
      delegate?.containerDidHide(self)
    } else {
      appInBackground = false
      lynxView.onEnterForeground()
      delegate?.containerDidShow(self)
    }
    if state != .idle && state != .released && autoGlobalPropsEnabled { pushGlobalProps() }
  }

  private func ensureUsable() throws {
    guard Thread.isMainThread else { throw containerError("Lynx container methods must run on the main thread", code: 5) }
    guard state != .released else { throw containerError("Lynx container has been released", code: 6) }
  }

  private func showLoadingUI() {
    clearOverlay()
    guard let bundleName, let view = uiProvider?.makeLoadingView(for: self, bundle: bundleName) else { return }
    setOverlay(view)
  }

  private func showErrorUI(_ error: Error?) {
    clearOverlay()
    guard let bundleName,
          let view = uiProvider?.makeErrorView(for: self, bundle: bundleName, error: error, retry: { [weak self] in
            guard let self else { return }
            do { try self.reload() } catch { }
          }) else { return }
    setOverlay(view)
  }

  private func setOverlay(_ view: UIView) {
    guard view.superview == nil || view.superview === self else { return }
    if view.superview === self { view.removeFromSuperview() }
    view.frame = bounds
    view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    addSubview(view)
    overlayView = view
  }

  private func clearOverlay() {
    overlayView?.removeFromSuperview()
    overlayView = nil
  }

  private func pushGlobalProps() {
    if !autoGlobalPropsEnabled && globalProps.isEmpty { return }
    lynxView.updateGlobalProps(withDictionary: effectiveGlobalProps())
  }

  private func effectiveGlobalProps() -> [String: Any] {
    if !autoGlobalPropsEnabled { return globalProps }
    return LynxShipGlobalProps.create(
      host: self,
      containerID: containerID,
      containerInitTime: containerInitTime,
      appProps: globalProps,
      appInBackground: appInBackground
    )
  }

  private var preparedBundle: String?
  private var preparedTemplate: Data?

  private func storePrepared(_ data: Data, for bundle: String) {
    preparedLock.lock()
    preparedBundle = bundle
    preparedTemplate = data
    preparedLock.unlock()
  }

  private func preparedData(for bundle: String) -> Data? {
    preparedLock.lock()
    defer { preparedLock.unlock() }
    guard preparedBundle == bundle else { return nil }
    return preparedTemplate
  }

  private func containerError(_ message: String, code: Int) -> NSError {
    NSError(domain: "com.lynxship.container", code: code, userInfo: [NSLocalizedDescriptionKey: message])
  }

  deinit {
    let center = NotificationCenter.default
    lifecycleObservers.forEach { center.removeObserver($0) }
  }
}
