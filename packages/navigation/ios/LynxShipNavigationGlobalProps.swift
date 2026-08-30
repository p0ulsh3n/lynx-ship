import Foundation
import UIKit

/** Builds the automatic host context for the default full-page container. */
enum LynxShipNavigationGlobalProps {
  static func create(
    host: UIView,
    containerID: String,
    containerInitTime: String,
    pageURL: URL,
    appInBackground: Bool
  ) -> [String: Any] {
    let screen = host.window?.screen ?? UIScreen.main
    let screenSize = screen.bounds.size
    let insets = host.safeAreaInsets
    let width = max(0, host.bounds.width)
    let height = max(0, host.bounds.height)
    let locale = Locale.current.identifier
    let language = Locale.current.languageCode ?? locale.split(separator: "_").first.map(String.init) ?? locale
    let isTablet = UIDevice.current.userInterfaceIdiom == .pad
    let isNotch = UIDevice.current.userInterfaceIdiom == .phone && insets.top > 20
    let style = host.traitCollection.userInterfaceStyle
    let theme = style == .dark ? "dark" : style == .light ? "light" : "system"
    let orientation = orientation(for: host, width: width, height: height)
    return [
      "os": "ios",
      "osVersion": UIDevice.current.systemVersion,
      "deviceModel": UIDevice.current.model,
      "containerID": containerID,
      "containerInitTime": containerInitTime,
      "screenWidth": screenSize.width,
      "screenHeight": screenSize.height,
      "contentWidth": max(0, width - insets.left - insets.right),
      "contentHeight": max(0, height - insets.top - insets.bottom),
      "safeAreaInsets": ["top": insets.top, "right": insets.right, "bottom": insets.bottom, "left": insets.left],
      "pixelRatio": screen.scale,
      "accessibleMode": UIAccessibility.isVoiceOverRunning ? 1 : 0,
      "isIPhoneX": isNotch ? 1 : 0,
      "isIPhoneXMax": isNotch ? 1 : 0,
      "isPad": isTablet ? 1 : 0,
      "isNotchScreen": isNotch,
      "isLowPowerMode": ProcessInfo.processInfo.isLowPowerModeEnabled ? 1 : 0,
      "orientation": orientation,
      "screenOrientation": orientation,
      "theme": theme,
      "appLanguage": language,
      "appLocale": locale,
      "isAppBackground": appInBackground,
      "queryItems": queryItems(from: pageURL),
      "topHeight": insets.top,
      "bottomHeight": insets.bottom,
      "safeAreaHeight": insets.top,
    ]
  }

  private static func queryItems(from url: URL) -> [String: String] {
    var values: [String: String] = [:]
    for item in URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? [] {
      guard values.count < 64,
            !item.name.isEmpty,
            item.name.count <= 128,
            item.name.rangeOfCharacter(from: .controlCharacters) == nil,
            let value = item.value,
            value.count <= 4096,
            value.rangeOfCharacter(from: .controlCharacters) == nil
      else { continue }
      values[item.name] = values[item.name] ?? value
    }
    return values
  }

  private static func orientation(for host: UIView, width: CGFloat, height: CGFloat) -> String {
    switch host.window?.windowScene?.interfaceOrientation {
    case .landscapeLeft: return "landscape-left"
    case .landscapeRight: return "landscape-right"
    case .portraitUpsideDown: return "portrait-upside-down"
    case .portrait: return "portrait"
    default: return width > height ? "landscape" : "portrait"
    }
  }
}
