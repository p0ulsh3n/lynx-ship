import Lynx

/// Configures the official Lynx builder before a container is created.
///
/// Hosts can use this seam for local custom UI elements and other builder-level
/// Lynx extensions. It runs once, before the view is constructed, so extension
/// registration is scoped to this container and does not require global state.
public protocol LynxShipContainerBuilderConfigurator: AnyObject {
  func configure(_ builder: LynxViewBuilder)
}
