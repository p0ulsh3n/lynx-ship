import ExpoModulesCore
import Foundation
import Lynx
import LynxShipOta
import UIKit

private final class LynxShipTemplateProvider: NSObject, LynxTemplateProvider {
  private let load: (String) throws -> Data
  private let onLoaded: () -> Void

  init(load: @escaping (String) throws -> Data, onLoaded: @escaping () -> Void) {
    self.load = load
    self.onLoaded = onLoaded
  }

  func loadTemplate(withUrl url: String!, onComplete callback: LynxTemplateLoadBlock!) {
    do {
      callback(load(url), nil)
      onLoaded()
    } catch {
      callback(nil, error)
    }
  }
}

public final class LynxShipExpoView: ExpoView {
  let onReady = EventDispatcher()
  let onError = EventDispatcher()
  let onUpdate = EventDispatcher()

  private lazy var templateProvider = LynxShipTemplateProvider(
    load: { [weak self] path in
      guard let self else { throw NSError(domain: "LynxShip", code: 1, userInfo: [NSLocalizedDescriptionKey: "Lynx view was released"]) }
      return try self.otaClient?.openActiveAsset(path) ?? self.readEmbeddedAsset(path)
    },
    onLoaded: { [weak self] in
      guard let self else { return }
      try? self.otaClient?.markLaunchSuccess()
      DispatchQueue.main.async {
        self.onReady(["bundle": self.bundleName, "sequence": self.otaClient?.activeSequence ?? 0])
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
  var bundleName = "main.lynx.bundle"
  var initialData = ""
  var reloadOnUpdate = true

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    LynxEnv.sharedInstance()
    otaClient = makeOtaClient()
    addSubview(lynxView)
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    lynxView.frame = bounds
    lynxView.preferredLayoutWidth = bounds.width
    lynxView.preferredLayoutHeight = bounds.height
  }

  public override func didMoveToWindow() {
    super.didMoveToWindow()
    guard window != nil, !hasRendered else { return }
    do {
      try otaClient?.beginLaunch()
      render()
      checkForUpdate()
    } catch {
      onError(["message": error.localizedDescription])
    }
  }

  func reload() throws {
    render()
  }

  private func render() {
    lynxView.loadTemplate(fromURL: bundleName, initData: initialData)
    hasRendered = true
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
}
