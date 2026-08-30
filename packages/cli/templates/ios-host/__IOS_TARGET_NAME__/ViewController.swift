import UIKit

class ViewController: UIViewController {
    private var lynxView: LynxView!
    private let loading = UIActivityIndicatorView(style: .large)
    private let errorLabel = UILabel()

  override func viewDidLoad() {
    super.viewDidLoad()

    view.backgroundColor = .systemBackground
    lynxView = LynxView { [weak self] builder in
      builder.config = LynxConfig(provider: DemoLynxProvider { [weak self] error in
        DispatchQueue.main.async {
          self?.showError(error.localizedDescription)
        }
      })
      builder.screenSize = self.view.frame.size
      builder.fontScale = 1.0
    }

    lynxView.preferredLayoutWidth = view.bounds.width
    lynxView.preferredLayoutHeight = view.bounds.height
    lynxView.layoutWidthMode = .exact
    lynxView.layoutHeightMode = .exact
    view.addSubview(lynxView)

    loading.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(loading)
    NSLayoutConstraint.activate([
      loading.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      loading.centerYAnchor.constraint(equalTo: view.centerYAnchor)
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
      errorLabel.centerYAnchor.constraint(equalTo: view.centerYAnchor)
    ])

    let lifecycle = LynxLifecycleClient(
      onStart: { [weak self] in self?.showLoading() },
      onFirstScreen: { [weak self] in self?.showContent() }
    )
    lynxView.addLifecycleClient(lifecycle)

    load()
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    lynxView?.frame = view.bounds
    lynxView?.preferredLayoutWidth = view.bounds.width
    lynxView?.preferredLayoutHeight = view.bounds.height
    lynxView?.updateViewport(withPreferredLayoutWidth: view.bounds.width,
                             preferredLayoutHeight: view.bounds.height,
                             needLayout: true)
  }

  private func load() {
    showLoading()
    lynxView.loadTemplate(fromURL: "main.lynx", initData: nil)
  }

  private func showLoading() {
    loading.startAnimating()
    errorLabel.isHidden = true
  }

  private func showContent() {
    loading.stopAnimating()
    errorLabel.isHidden = true
  }

  private func showError(_ message: String) {
    loading.stopAnimating()
    errorLabel.text = "Unable to load Lynx content.\nTap to retry.\n\n\(message)"
    errorLabel.isHidden = false
  }

  @objc private func retry() {
    load()
  }
}

private final class LynxLifecycleClient: NSObject, LynxViewLifecycle {
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
