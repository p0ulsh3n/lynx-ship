import Foundation
import Lynx
import UIKit

private final class LynxShipNavigationTemplateProvider: NSObject, LynxTemplateProvider {
  func loadTemplate(withUrl url: String!, onComplete callback: LynxTemplateLoadBlock!) {
    let name = url ?? ""
    guard LynxShipNavigationPageViewController.isSafeBundle(name) else {
      callback(nil, NSError(domain: "com.lynxship.navigation", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid Lynx bundle path."]))
      return
    }
    DispatchQueue.global(qos: .userInitiated).async {
      let fileURL = Bundle.main.url(forResource: name, withExtension: nil)
        ?? Bundle.main.url(forResource: name.replacingOccurrences(of: ".lynx.bundle", with: ""), withExtension: "lynx.bundle")
      guard let fileURL else {
        let error = NSError(domain: "com.lynxship.navigation", code: 2, userInfo: [NSLocalizedDescriptionKey: "Lynx bundle was not found in the application resources."])
        callback(nil, error)
        return
      }
      do { callback(try Data(contentsOf: fileURL), nil) }
      catch { callback(nil, error) }
    }
  }
}

private final class LynxShipNavigationLifecycle: NSObject, LynxViewLifecycle {
  private let onStart: () -> Void
  private let onFirstScreen: () -> Void
  private let onError: (Error) -> Void

  init(onStart: @escaping () -> Void, onFirstScreen: @escaping () -> Void, onError: @escaping (Error) -> Void) {
    self.onStart = onStart
    self.onFirstScreen = onFirstScreen
    self.onError = onError
  }

  func lynxViewDidStartLoading(_ view: LynxView) { onStart() }
  func lynxViewDidFirstScreen(_ view: LynxView) { onFirstScreen() }
  func lynxView(_ view: LynxView, didReceiveError error: Error) { onError(error) }
}

@objc(LynxShipNavigationPageViewController)
final class LynxShipNavigationPageViewController: UIViewController, LynxShipNavigationHost {
  private let pageURL: URL
  private var bundleName: String = ""
  private var lynxView: LynxView!
  private let loading = UIActivityIndicatorView(style: .medium)
  private let errorLabel = UILabel()
  private var toolbarActions: [UIBarButtonItem] = []
  private var hideLoading = false
  private var disableAutoRemoveLoading = false
  private var hideError = false
  private var containerBackgroundColor = UIColor.systemBackground
  private var loadingBackgroundColor = UIColor.systemBackground
  private var hideStatusBar = false
  private var transparentStatusBar = false
  private var showNavBarInTransparentStatusBar = false
  private var statusFontMode: UIStatusBarStyle = .default
  private var forcedTheme: UIUserInterfaceStyle = .unspecified
  private var screenOrientation: String?
  private let containerID = UUID().uuidString
  private let containerInitTime = ISO8601DateFormatter().string(from: Date())
  private var appInBackground = false
  private var contentReady = false

  @objc(initWithURL:)
  init(url: URL) {
    pageURL = url
    super.init(nibName: nil, bundle: nil)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground
    createLynxView()
    createFailureSurface()
    applySchemeChrome()
    loadPage()
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    lynxView?.frame = view.bounds
    lynxView?.preferredLayoutWidth = view.bounds.width
    lynxView?.preferredLayoutHeight = view.bounds.height
    lynxView?.updateViewport(withPreferredLayoutWidth: view.bounds.width,
                             preferredLayoutHeight: view.bounds.height,
                             needLayout: true)
    pushGlobalProps()
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    appInBackground = false
    lynxView?.onEnterForeground()
    pushGlobalProps()
  }

  override var prefersStatusBarHidden: Bool { hideStatusBar }

  override var preferredStatusBarStyle: UIStatusBarStyle { statusFontMode }

  override var supportedInterfaceOrientations: UIInterfaceOrientationMask {
    switch screenOrientation {
    case "portrait": return .portrait
    case "portrait-upside-down": return .portraitUpsideDown
    case "landscape", "landscape-left", "landscape-right": return .landscape
    default: return .all
    }
  }

  override func viewDidDisappear(_ animated: Bool) {
    appInBackground = true
    lynxView?.onEnterBackground()
    pushGlobalProps()
    super.viewDidDisappear(animated)
  }

  @objc(lynxShipOpenURL:replace:)
  func lynxShipOpenURL(_ url: URL, replace: Bool) -> Bool {
    guard Self.hasBundle(url) else { return false }
    let page = Self(url: url)
    if replace, let navigationController {
      var stack = navigationController.viewControllers
      if !stack.isEmpty { stack.removeLast() }
      stack.append(page)
      navigationController.setViewControllers(stack, animated: true)
    } else if let navigationController {
      navigationController.pushViewController(page, animated: true)
    } else {
      present(page, animated: true)
    }
    return true
  }

  @objc(lynxShipGoBack)
  func lynxShipGoBack() -> Bool {
    if let navigationController, navigationController.viewControllers.count > 1 {
      navigationController.popViewController(animated: true)
    } else if presentingViewController != nil {
      dismiss(animated: true)
    } else { return false }
    return true
  }

  @objc(lynxShipClose)
  func lynxShipClose() -> Bool { lynxShipGoBack() }

  @objc(lynxShipUpdateChromeJSON:)
  func lynxShipUpdateChromeJSON(_ json: String) -> Bool {
    guard let data = json.data(using: .utf8),
          let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return false }
    applyChrome(object)
    return true
  }

  private func createLynxView() {
    let provider = LynxShipNavigationTemplateProvider()
    lynxView = LynxView { builder in
      builder.config = LynxConfig(provider: provider)
      builder.fontScale = 1.0
    }
    let lifecycle = LynxShipNavigationLifecycle(
      onStart: { [weak self] in self?.showLoading() },
      onFirstScreen: { [weak self] in self?.showContent() },
      onError: { [weak self] error in self?.showError(error.localizedDescription) }
    )
    lynxView.addLifecycleClient(lifecycle)
    view.addSubview(lynxView)
  }

  private func createFailureSurface() {
    loading.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(loading)
    NSLayoutConstraint.activate([
      loading.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      loading.centerYAnchor.constraint(equalTo: view.centerYAnchor),
    ])
    errorLabel.translatesAutoresizingMaskIntoConstraints = false
    errorLabel.textAlignment = .center
    errorLabel.numberOfLines = 0
    errorLabel.textColor = .secondaryLabel
    errorLabel.isHidden = true
    errorLabel.isUserInteractionEnabled = true
    errorLabel.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(retry)))
    view.addSubview(errorLabel)
    NSLayoutConstraint.activate([
      errorLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 32),
      errorLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -32),
      errorLabel.centerYAnchor.constraint(equalTo: view.centerYAnchor),
    ])
  }

  private func loadPage() {
    guard let bundle = pageURL.queryValue("bundle"), Self.isSafeBundle(bundle) else {
      showError("This Lynx page does not identify a local bundle.")
      return
    }
    bundleName = bundle
    contentReady = false
    showLoading()
    pushGlobalProps()
    lynxView.loadTemplate(fromURL: bundle, initData: nil)
  }

  private func pushGlobalProps() {
    guard isViewLoaded, lynxView != nil, !bundleName.isEmpty else { return }
    lynxView.updateGlobalProps(withDictionary: LynxShipNavigationGlobalProps.create(
      host: view,
      containerID: containerID,
      containerInitTime: containerInitTime,
      pageURL: pageURL,
      appInBackground: appInBackground
    ))
  }

  @objc private func retry() { loadPage() }

  private func applySchemeChrome() {
    var values: [String: Any] = [:]
    if let title = pageURL.queryValue("title") { values["title"] = title }
    if let color = themedValue("title_color") { values["titleColor"] = color }
    if let color = themedValue("nav_bar_color") { values["backgroundColor"] = color }
    if let color = themedValue("container_bg_color") { values["containerBackgroundColor"] = color }
    if let color = themedValue("loading_bg_color") { values["loadingBackgroundColor"] = color }
    if Self.isFlag(pageURL.queryValue("hide_loading")) { values["hideLoading"] = true }
    if Self.isFlag(pageURL.queryValue("disable_auto_remove_loading")) {
      values["disableAutoRemoveLoading"] = true
    }
    if Self.isFlag(pageURL.queryValue("hide_error")) { values["hideError"] = true }
    if pageURL.queryValue("hide_nav_bar") == "1" { values["visible"] = false }
    if Self.isFlag(pageURL.queryValue("hide_status_bar")) { values["hideStatusBar"] = true }
    if Self.isFlag(pageURL.queryValue("trans_status_bar")) { values["transparentStatusBar"] = true }
    if Self.isFlag(pageURL.queryValue("show_nav_bar_in_trans_status_bar")) {
      values["showNavBarInTransparentStatusBar"] = true
    }
    if Self.isFlag(pageURL.queryValue("hide_back_button")) { values["hideBackButton"] = true }
    if let orientation = pageURL.queryValue("screen_orientation"), Self.isSafeOrientation(orientation) {
      values["screenOrientation"] = orientation
    }
    if let status = pageURL.queryValue("status_font_mode"), ["default", "light", "dark"].contains(status) {
      values["statusFontMode"] = status
    }
    if let theme = pageURL.queryValue("force_theme_style"), ["light", "dark"].contains(theme) {
      values["forceThemeStyle"] = theme
    }
    applyChrome(values)
  }

  private func applyChrome(_ values: [String: Any]) {
    if let visible = values["visible"] as? Bool { navigationController?.setNavigationBarHidden(!visible, animated: true) }
    if let title = values["title"] as? String { navigationItem.title = title }
    if let color = Self.uiColor(values["backgroundColor"] as? String) {
      let appearance = UINavigationBarAppearance()
      appearance.configureWithOpaqueBackground()
      appearance.backgroundColor = color
      navigationController?.navigationBar.standardAppearance = appearance
      navigationController?.navigationBar.scrollEdgeAppearance = appearance
    }
    if let color = Self.uiColor(values["containerBackgroundColor"] as? String) { containerBackgroundColor = color }
    if let color = Self.uiColor(values["loadingBackgroundColor"] as? String) { loadingBackgroundColor = color }
    if let value = values["hideLoading"] as? Bool { hideLoading = value }
    if let value = values["disableAutoRemoveLoading"] as? Bool { disableAutoRemoveLoading = value }
    if let value = values["hideError"] as? Bool { hideError = value }
    if let value = values["hideStatusBar"] as? Bool { hideStatusBar = value }
    if let value = values["transparentStatusBar"] as? Bool { transparentStatusBar = value }
    if let value = values["showNavBarInTransparentStatusBar"] as? Bool {
      showNavBarInTransparentStatusBar = value
    }
    if let value = values["hideBackButton"] as? Bool { navigationItem.hidesBackButton = value }
    if let value = values["screenOrientation"] as? String, Self.isSafeOrientation(value) {
      screenOrientation = value
      if #available(iOS 16.0, *) {
        setNeedsUpdateOfSupportedInterfaceOrientations()
      } else {
        UIViewController.attemptRotationToDeviceOrientation()
      }
    }
    if let value = values["statusFontMode"] as? String {
      statusFontMode = value == "light" ? .lightContent : value == "dark" ? .darkContent : .default
      setNeedsStatusBarAppearanceUpdate()
    }
    if let value = values["forceThemeStyle"] as? String {
      forcedTheme = value == "dark" ? .dark : value == "light" ? .light : .unspecified
      overrideUserInterfaceStyle = forcedTheme
    }
    navigationController?.setNavigationBarHidden(
      (values["visible"] as? Bool == false) ||
      (transparentStatusBar && !showNavBarInTransparentStatusBar),
      animated: false
    )
    if transparentStatusBar {
      navigationController?.navigationBar.isTranslucent = true
      navigationController?.navigationBar.backgroundColor = .clear
    }
    view.backgroundColor = containerBackgroundColor
    if contentReady {
      if hideLoading || !disableAutoRemoveLoading { loading.stopAnimating() }
      else { loading.startAnimating() }
    }
    if let color = Self.uiColor(values["titleColor"] as? String) {
      navigationController?.navigationBar.titleTextAttributes = [.foregroundColor: color]
    }
    navigationItem.leftBarButtonItem = makeBarButton(values["leadingAction"] as? [String: Any])
    toolbarActions = []
    if let actions = values["trailingActions"] as? [[String: Any]] {
      toolbarActions = actions.prefix(4).compactMap { item in
        guard let id = item["id"] as? String, Self.isSafeActionID(id) else { return nil }
        let title = (item["label"] as? String) ?? id
        let button = makeBarButtonItem(title: title, icon: item["icon"] as? String)
        button.target = self
        button.action = #selector(toolbarAction(_:))
        button.accessibilityLabel = (item["accessibilityLabel"] as? String) ?? title
        button.accessibilityHint = (item["role"] as? String) ?? "action"
        button.accessibilityIdentifier = id
        button.isEnabled = (item["enabled"] as? Bool) ?? true
        if (item["destructive"] as? Bool) == true { button.tintColor = .systemRed }
        return button
      }
      navigationItem.rightBarButtonItems = toolbarActions
    } else { navigationItem.rightBarButtonItems = nil }
  }

  private func makeBarButton(_ item: [String: Any]?) -> UIBarButtonItem? {
    guard let item,
          let id = item["id"] as? String,
          Self.isSafeActionID(id),
          let role = item["role"] as? String,
          ["back", "close", "action"].contains(role)
    else { return nil }
    let title = (item["label"] as? String) ?? id
    guard !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
    let button = makeBarButtonItem(title: title, icon: item["icon"] as? String)
    button.target = self
    button.action = #selector(toolbarAction(_:))
    button.accessibilityLabel = (item["accessibilityLabel"] as? String) ?? title
    button.accessibilityHint = role
    button.accessibilityIdentifier = id
    button.isEnabled = (item["enabled"] as? Bool) ?? true
    if (item["destructive"] as? Bool) == true { button.tintColor = .systemRed }
    return button
  }

  private func makeBarButtonItem(title: String, icon: String?) -> UIBarButtonItem {
    if let icon, Self.isSafeIconName(icon), let image = UIImage(systemName: icon) {
      return UIBarButtonItem(image: image, style: .plain, target: nil, action: nil)
    }
    return UIBarButtonItem(title: title, style: .plain, target: nil, action: nil)
  }

  @objc private func toolbarAction(_ sender: UIBarButtonItem) {
    guard let id = sender.accessibilityIdentifier else { return }
    if sender.accessibilityHint == "back" || sender.accessibilityHint == "close" { _ = lynxShipGoBack(); return }
    lynxView.sendGlobalEvent("lynxship:navigation-action", withParams: [id])
  }

  private func showLoading() {
    view.backgroundColor = loadingBackgroundColor
    if hideLoading { loading.stopAnimating() } else { loading.startAnimating() }
    errorLabel.isHidden = true
  }
  private func showContent() {
    view.backgroundColor = containerBackgroundColor
    contentReady = true
    if hideLoading || !disableAutoRemoveLoading { loading.stopAnimating() }
    else { loading.startAnimating() }
    errorLabel.isHidden = true
  }
  private func showError(_ message: String) {
    view.backgroundColor = containerBackgroundColor
    loading.stopAnimating()
    errorLabel.text = "Unable to load Lynx content.\nTap to retry.\n\n\(message)"
    errorLabel.isHidden = hideError
  }

  deinit {
    lynxView?.destroy()
  }

  fileprivate static func hasBundle(_ url: URL) -> Bool {
    guard let value = url.queryValue("bundle") else { return false }
    return isSafeBundle(value)
  }

  fileprivate static func isSafeBundle(_ value: String?) -> Bool {
    guard let value, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
          value.count <= 4096, !value.hasPrefix("/"), !value.contains("\\"),
          !value.contains(".."), value.rangeOfCharacter(from: .controlCharacters) == nil else { return false }
    return true
  }

  private static func isSafeActionID(_ value: String) -> Bool {
    value.range(of: "^[A-Za-z][A-Za-z0-9_.:-]{0,63}$", options: .regularExpression) != nil
  }

  private static func isSafeIconName(_ value: String) -> Bool {
    value.range(of: "^[A-Za-z][A-Za-z0-9_.:-]{0,127}$", options: .regularExpression) != nil
  }

  private static func isFlag(_ value: String?) -> Bool {
    value == "1" || value?.lowercased() == "true"
  }

  private static func isSafeOrientation(_ value: String) -> Bool {
    ["auto", "portrait", "portrait-upside-down", "landscape", "landscape-left", "landscape-right"].contains(value)
  }

  private func themedValue(_ key: String) -> String? {
    let force = pageURL.queryValue("force_theme_style")
    let suffix = force == "light" ? "_light" :
      force == "dark" ? "_dark" :
      traitCollection.userInterfaceStyle == .dark ? "_dark" : "_light"
    if let value = pageURL.queryValue("\(key)\(suffix)"), Self.isColor(value) { return value }
    if let value = pageURL.queryValue(key), Self.isColor(value) { return value }
    return nil
  }

  private static func isColor(_ value: String?) -> Bool {
    value?.range(of: "^#[0-9a-fA-F]{6}$", options: .regularExpression) != nil
  }

  private static func uiColor(_ value: String?) -> UIColor? {
    guard let value, isColor(value) else { return nil }
    var number: UInt64 = 0
    Scanner(string: String(value.dropFirst())).scanHexInt64(&number)
    return UIColor(red: CGFloat((number >> 16) & 0xff) / 255,
                   green: CGFloat((number >> 8) & 0xff) / 255,
                   blue: CGFloat(number & 0xff) / 255,
                   alpha: 1)
  }
}

private extension URL {
  func queryValue(_ name: String) -> String? {
    URLComponents(url: self, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == name })?.value
  }
}
