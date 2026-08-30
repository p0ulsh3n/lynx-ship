import Foundation

class DemoLynxProvider: NSObject, LynxTemplateProvider {
  private let onError: (Error) -> Void

  init(onError: @escaping (Error) -> Void) {
    self.onError = onError
  }

  func loadTemplate(withUrl url: String!, onComplete callback: LynxTemplateLoadBlock!) {
    let requestedURL = url ?? ""
    DispatchQueue.global(qos: .userInitiated).async { [onError] in
      guard let filePath = Bundle.main.path(forResource: requestedURL, ofType: "bundle")
        ?? Bundle.main.path(forResource: requestedURL, ofType: nil) else {
        let urlError = NSError(domain: "com.lynx", code: 400, userInfo: [NSLocalizedDescriptionKey: "Invalid URL."])
        onError(urlError)
        callback(nil, urlError)
        return
      }
      do {
        callback(try Data(contentsOf: URL(fileURLWithPath: filePath)), nil)
      } catch {
        onError(error)
        callback(nil, error)
      }
    }
  }
}
