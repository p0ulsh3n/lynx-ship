import ExpoModulesCore
import Foundation
import Lynx
import LynxShipOta
import UIKit

private final class LynxShipTemplateProvider: NSObject, LynxTemplateProvider {
  private let load: (String) throws -> Data
  private let onStart: (String) -> Void

  init(load: @escaping (String) throws -> Data, onStart: @escaping (String) -> Void) {
    self.load = load
    self.onStart = onStart
  }

  func loadTemplate(withUrl url: String!, onComplete callback: LynxTemplateLoadBlock!) {
    onStart(url ?? "")
    do {
      callback(load(url), nil)
    } catch {
      callback(nil, error)
    }
  }
}

private final class LynxShipLifecycleClient: NSObject, LynxViewLifecycle {
  private let onStart: () -> Void
  private let onFirstScreen: () -> Void

  init(onStart: @escaping () -> Void, onFirstScreen: @escaping () -> Void) {
    self.onStart = onStart
    self.onFirstScreen = onFirstScreen
  }

  func lynxViewDidStartLoading(_ view: LynxView) {
    onStart()
  }

  func lynxViewDidFirstScreen(_ view: LynxView) {
    onFirstScreen()
  }
}

public final class LynxShipExpoView: ExpoView {
  let onReady = EventDispatcher()
  let onLoadStart = EventDispatcher()
  let onResourceFetchStart = EventDispatcher()
  let onLoadSuccess = EventDispatcher()
  let onError = EventDispatcher()
  let onUpdate = EventDispatcher()
  let onShow = EventDispatcher()
  let onHide = EventDispatcher()

  private lazy var templateProvider = LynxShipTemplateProvider(
    load: { [weak self] path in
      guard let self else { throw NSError(domain: "LynxShip", code: 1, userInfo: [NSLocalizedDescriptionKey: "Lynx view was released"]) }
      return try self.otaClient?.openActiveAsset(path) ?? self.readEmbeddedAsset(path)
    },
    onStart: { [weak self] bundle in
      DispatchQueue.main.async { self?.onResourceFetchStart(["bundle": bundle]) }
    }
  )

  private lazy var lifecycleClient = LynxShipLifecycleClient(
    onStart: { [weak self] in
      guard let self else { return }
      self.loadState = "loading"
      self.onLoadStart(["bundle": self.bundleName])
    },
    onFirstScreen: { [weak self] in
      guard let self else { return }
      self.loadState = "loaded"
      do {
        try self.otaClient?.markLaunchSuccess()
      } catch {
        self.onError(["message": error.localizedDescription, "recoverable": true])
      }
      DispatchQueue.main.async {
        let event: [String: Any] = ["bundle": self.bundleName, "sequence": self.otaClient?.activeSequence ?? 0]
        self.onLoadSuccess(event)
        self.onReady(event)
      }
    }
  )

  private lazy var lynxView: LynxView = {
    LynxView { builder in
      builder.config = LynxConfig(provider: self.templateProvider)
      builder.fontScale = 1.0
    }
  }()

  private var otaClient: LynxShipOtaClient?
  private var hasRendered = false
  private var loadState = "idle"
  var bundleName = "main.lynx.bundle"
  var initialData = ""
  private var globalProps: [String: Any] = [:]
  var reloadOnUpdate = true
  var autoGlobalProps = true {
    didSet {
      if hasRendered { pushGlobalProps() }
    }
  }
  private let containerID = UUID().uuidString
  private let containerInitTime = ISO8601DateFormatter().string(from: Date())
  private var appInBackground = false

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    LynxEnv.sharedInstance()
    otaClient = makeOtaClient()
    addSubview(lynxView)
    lynxView.addLifecycleClient(lifecycleClient)
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    lynxView.frame = bounds
    lynxView.preferredLayoutWidth = bounds.width
    lynxView.preferredLayoutHeight = bounds.height
    lynxView.updateViewport(withPreferredLayoutWidth: bounds.width,
                            preferredLayoutHeight: bounds.height,
                            needLayout: true)
    if hasRendered && autoGlobalProps { pushGlobalProps() }
  }

  public override func didMoveToWindow() {
    super.didMoveToWindow()
    appInBackground = window == nil
    if window != nil {
      lynxView.onEnterForeground()
      onShow([:])
    } else {
      lynxView.onEnterBackground()
      onHide([:])
    }
    if hasRendered && autoGlobalProps { pushGlobalProps() }
    guard window != nil, !hasRendered else { return }
    do {
      try otaClient?.beginLaunch()
      render()
      checkForUpdate()
    } catch {
      loadState = "failed"
      onError(["message": error.localizedDescription])
    }
  }

  func reload() throws {
    render()
  }

  func getContainerId() -> String { containerID }

  func getLoadState() -> String { loadState }

  func isLoadSuccess() -> Bool { loadState == "loaded" }

  func updateData(_ data: String, processorName: String? = nil) throws {
    guard data.utf8.count <= 8 * 1024 * 1024 else {
      throw NSError(domain: "LynxShip", code: 8, userInfo: [NSLocalizedDescriptionKey: "Lynx update data is larger than 8 MiB"])
    }
    guard hasRendered else {
      throw NSError(domain: "LynxShip", code: 9, userInfo: [NSLocalizedDescriptionKey: "Lynx view has not loaded a bundle"])
    }
    if let processorName {
      guard !processorName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
            processorName.count <= 256,
            processorName.rangeOfCharacter(from: .controlCharacters) == nil else {
        throw NSError(domain: "LynxShip", code: 10, userInfo: [NSLocalizedDescriptionKey: "Lynx data processor name is invalid"])
      }
      let templateData = LynxTemplateData(json: data)
      templateData.markState(processorName)
      lynxView.updateData(withTemplateData: templateData)
    } else {
      lynxView.updateData(withString: data)
    }
    initialData = data
    onUpdate(["bundle": bundleName, "reason": "data"])
  }

  func setBundleName(_ value: String) {
    guard value != bundleName else { return }
    bundleName = value
    if hasRendered { render() }
  }

  func setInitialData(_ value: String) {
    guard value != initialData else { return }
    initialData = value
    if hasRendered { render() }
  }

  func updateGlobalProps(_ props: [String: Any]) {
    globalProps = props
    pushGlobalProps()
  }

  func updateGlobalPropsByIncrement(_ props: [String: Any]) {
    guard !props.isEmpty else { return }
    globalProps.merge(props) { _, newValue in newValue }
    lynxView.updateGlobalProps(withDictionary: props)
  }

  func sendGlobalEvent(_ eventName: String, params: [Any]) throws {
    guard !eventName.isEmpty else {
      throw NSError(domain: "LynxShip", code: 4, userInfo: [NSLocalizedDescriptionKey: "Lynx global event name cannot be empty"])
    }
    guard eventName.count <= 256 else {
      throw NSError(domain: "LynxShip", code: 5, userInfo: [NSLocalizedDescriptionKey: "Lynx global event name is too long"])
    }
    guard params.count <= 256 else {
      throw NSError(domain: "LynxShip", code: 6, userInfo: [NSLocalizedDescriptionKey: "Lynx global event payload is too large"])
    }
    lynxView.sendGlobalEvent(eventName, withParams: params)
  }

  func show() {
    isHidden = false
  }

  func hide() {
    isHidden = true
  }

  func updateViewport(_ viewport: [String: Double]) throws {
    let width = viewport["width"] ?? 0
    let height = viewport["height"] ?? 0
    guard width.isFinite && height.isFinite && width >= 0 && height >= 0 else {
      throw NSError(domain: "LynxShip", code: 7, userInfo: [NSLocalizedDescriptionKey: "Lynx viewport dimensions must be finite and non-negative"])
    }
    lynxView.updateViewport(withPreferredLayoutWidth: CGFloat(width),
                            preferredLayoutHeight: CGFloat(height),
                            needLayout: true)
  }

  private func render() {
    loadState = "loading"
    if autoGlobalProps || !globalProps.isEmpty {
      lynxView.updateGlobalProps(withDictionary: effectiveGlobalProps())
    }
    lynxView.loadTemplate(fromURL: bundleName, initData: initialData)
    hasRendered = true
  }

  private func pushGlobalProps() {
    guard autoGlobalProps || !globalProps.isEmpty else { return }
    lynxView.updateGlobalProps(withDictionary: effectiveGlobalProps())
  }

  private func effectiveGlobalProps() -> [String: Any] {
    guard autoGlobalProps else { return globalProps }
    let screen = window?.screen ?? UIScreen.main
    let screenSize = screen.bounds.size
    let insets = safeAreaInsets
    let width = max(0, bounds.width)
    let height = max(0, bounds.height)
    let contentWidth = max(0, width - insets.left - insets.right)
    let contentHeight = max(0, height - insets.top - insets.bottom)
    let orientation: String
    switch window?.windowScene?.interfaceOrientation {
    case .landscapeLeft: orientation = "landscape-left"
    case .landscapeRight: orientation = "landscape-right"
    case .portraitUpsideDown: orientation = "portrait-upside-down"
    case .portrait: orientation = "portrait"
    default: orientation = width > height ? "landscape" : "portrait"
    }
    let theme: String
    switch traitCollection.userInterfaceStyle {
    case .dark: theme = "dark"
    case .light: theme = "light"
    default: theme = "system"
    }
    let locale = Locale.current.identifier
    let language = Locale.current.languageCode ?? locale.split(separator: "_").first.map(String.init) ?? locale
    let isTablet = UIDevice.current.userInterfaceIdiom == .pad
    let isNotchScreen = UIDevice.current.userInterfaceIdiom == .phone && insets.top > 20
    var props = globalProps
    props["os"] = "ios"
    props["osVersion"] = UIDevice.current.systemVersion
    props["deviceModel"] = UIDevice.current.model
    props["containerID"] = containerID
    props["containerInitTime"] = containerInitTime
    props["screenWidth"] = screenSize.width
    props["screenHeight"] = screenSize.height
    props["contentWidth"] = contentWidth
    props["contentHeight"] = contentHeight
    props["safeAreaInsets"] = [
      "top": insets.top,
      "right": insets.right,
      "bottom": insets.bottom,
      "left": insets.left,
    ]
    props["pixelRatio"] = screen.scale
    props["accessibleMode"] = UIAccessibility.isVoiceOverRunning ? 1 : 0
    props["isIPhoneX"] = isNotchScreen ? 1 : 0
    props["isIPhoneXMax"] = isNotchScreen ? 1 : 0
    props["isPad"] = isTablet ? 1 : 0
    props["isNotchScreen"] = isNotchScreen
    props["isLowPowerMode"] = ProcessInfo.processInfo.isLowPowerModeEnabled ? 1 : 0
    props["orientation"] = orientation
    props["screenOrientation"] = orientation
    props["theme"] = theme
    props["appLanguage"] = language
    props["appLocale"] = locale
    props["isAppBackground"] = appInBackground
    props["queryItems"] = [String: String]()
    props["topHeight"] = insets.top
    props["bottomHeight"] = insets.bottom
    props["safeAreaHeight"] = insets.top
    return props
  }

  private func checkForUpdate() {
    Task { [weak self] in
      guard let self else { return }
      do {
        guard let otaClient else { return }
        guard try await otaClient.checkAndInstall() else { return }
        try otaClient.activateCandidate()
        await MainActor.run {
          self.onUpdate(["sequence": otaClient.activeSequence])
          if self.reloadOnUpdate { self.render() }
        }
      } catch {
        await MainActor.run {
          self.onError(["message": error.localizedDescription, "recoverable": true])
        }
      }
    }
  }

  private func readEmbeddedAsset(_ path: String) throws -> Data {
    guard !path.isEmpty, !path.hasPrefix("/"), !path.contains(".."), !path.contains("\\") else {
      throw NSError(domain: "LynxShip", code: 2, userInfo: [NSLocalizedDescriptionKey: "Unsafe Lynx asset path"])
    }
    guard let url = Bundle.main.url(forResource: path, withExtension: nil, subdirectory: "LynxShipAssets")
      ?? Bundle.main.url(forResource: path, withExtension: "bundle", subdirectory: "LynxShipAssets")
      ?? Bundle.main.url(forResource: path, withExtension: nil)
      ?? Bundle.main.url(forResource: path, withExtension: "bundle") else {
      throw NSError(domain: "LynxShip", code: 3, userInfo: [NSLocalizedDescriptionKey: "Embedded Lynx bundle not found: \(path)"])
    }
    return try Data(contentsOf: url)
  }

  private func makeOtaClient() -> LynxShipOtaClient? {
    guard let value = Bundle.main.object(forInfoDictionaryKey: "LynxShipExpo") as? [String: Any],
          let endpointString = value["endpoint"] as? String, !endpointString.isEmpty,
          let endpoint = URL(string: endpointString),
          let projectId = value["projectId"] as? String, !projectId.isEmpty,
          let runtimeVersion = value["runtimeVersion"] as? String, !runtimeVersion.isEmpty else { return nil }
    do {
      let keys = value["publicKeys"] as? [String: String] ?? [:]
      let channel = value["channel"] as? String ?? "production"
      let storage = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("lynxship-ota", isDirectory: true)
      let installationId = UIDevice.current.identifierForVendor?.uuidString ?? UUID().uuidString
      let configuration = try LynxShipOtaClient.Configuration(
        storageDirectory: storage,
        endpoint: endpoint,
        projectID: projectId,
        channel: channel,
        runtimeVersion: runtimeVersion,
        installationID: installationId,
        publicKeys: keys,
        embeddedAssets: readEmbeddedAsset,
        maxReleaseBytes: value["maxReleaseBytes"] as? Int ?? 100 * 1024 * 1024
      )
      return try LynxShipOtaClient(configuration: configuration)
    } catch {
      onError(["message": error.localizedDescription])
      return nil
    }
  }

  deinit {
    loadState = "released"
    lynxView.destroy()
  }
}
