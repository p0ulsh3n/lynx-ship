import Foundation
import UIKit

/** Builds the reserved host context injected into an iOS Lynx container. */
enum LynxShipGlobalProps {
  static func create(
    host: UIView,
    containerID: String,
    containerInitTime: String,
    appProps: [String: Any],
    appInBackground: Bool
  ) -> [String: Any] {
    let screen = host.window?.screen ?? UIScreen.main
    let screenSize = screen.bounds.size
    let insets = host.safeAreaInsets
    let width = max(0, host.bounds.width)
    let height = max(0, host.bounds.height)
    let contentWidth = max(0, width - insets.left - insets.right)
    let contentHeight = max(0, height - insets.top - insets.bottom)
    let orientation = orientation(for: host, width: width, height: height)
    let theme: String
    switch host.traitCollection.userInterfaceStyle {
    case .dark: theme = "dark"
    case .light: theme = "light"
    default: theme = "system"
    }
    let locale = Locale.current.identifier
    let language = Locale.current.languageCode ?? locale.split(separator: "_").first.map(String.init) ?? locale
    let isTablet = UIDevice.current.userInterfaceIdiom == .pad
    let isNotch = UIDevice.current.userInterfaceIdiom == .phone && insets.top > 20
    var props = appProps
    props["os"] = "ios"
    props["osVersion"] = UIDevice.current.systemVersion
    props["deviceModel"] = UIDevice.current.model
    props["containerID"] = containerID
    props["containerInitTime"] = containerInitTime
    props["screenWidth"] = screenSize.width
    props["screenHeight"] = screenSize.height
    props["contentWidth"] = contentWidth
    props["contentHeight"] = contentHeight
    props["safeAreaInsets"] = ["top": insets.top, "right": insets.right, "bottom": insets.bottom, "left": insets.left]
    props["pixelRatio"] = screen.scale
    props["accessibleMode"] = UIAccessibility.isVoiceOverRunning ? 1 : 0
    props["isIPhoneX"] = isNotch ? 1 : 0
    props["isIPhoneXMax"] = isNotch ? 1 : 0
    props["isPad"] = isTablet ? 1 : 0
    props["isNotchScreen"] = isNotch
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
