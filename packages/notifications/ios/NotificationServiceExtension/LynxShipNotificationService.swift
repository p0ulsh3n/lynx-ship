import Foundation
import Intents
import UserNotifications

/// Downloads a validated profile image before iOS presents a rich alert.
/// Add this file to a Notification Service Extension target, not the app target.
final class LynxShipNotificationService: UNNotificationServiceExtension {
  private let completionLock = NSLock()
  private var contentHandler: ((UNNotificationContent) -> Void)?
  private var bestAttemptContent: UNMutableNotificationContent?
  private var task: URLSessionDataTask?
  private var didComplete = false

  override func didReceive(
    _ request: UNNotificationRequest,
    withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    completionLock.lock()
    self.contentHandler = contentHandler
    bestAttemptContent = nil
    didComplete = false
    completionLock.unlock()

    guard let content = request.content.mutableCopy() as? UNMutableNotificationContent else {
      complete(request.content)
      return
    }
    bestAttemptContent = content
    guard
      let rawURL = content.userInfo["lynxship.image-url"] as? String,
      let url = secureImageURL(rawURL)
    else {
      complete(content)
      return
    }

    var imageRequest = URLRequest(url: url)
    imageRequest.httpMethod = "GET"
    imageRequest.timeoutInterval = 4
    imageRequest.cachePolicy = .reloadIgnoringLocalCacheData
    task = URLSession(configuration: .ephemeral).dataTask(with: imageRequest) { [weak self] data, response, _ in
      defer { self?.task = nil }
      guard
        let self,
        let data,
        data.count <= 1_048_576,
        let http = response as? HTTPURLResponse,
        (200..<300).contains(http.statusCode),
        let mime = http.mimeType,
        ["image/jpeg", "image/png", "image/gif"].contains(mime),
        let fileURL = self.writeTemporaryImage(data: data, mimeType: mime),
        let attachment = try? UNNotificationAttachment(
          identifier: "lynxship-profile-image",
          url: fileURL,
          options: nil
      )
      else {
        self.complete(self.fallbackContent(content))
        return
      }
      self.bestAttemptContent?.attachments = [attachment]
      self.applyCommunicationMetadata(imageData: data, content: self.bestAttemptContent ?? content)
    }
    task?.resume()
  }

  override func serviceExtensionTimeWillExpire() {
    task?.cancel()
    complete(fallbackContent(nil))
  }

  private func secureImageURL(_ value: String) -> URL? {
    guard let url = URL(string: value), url.scheme?.lowercased() == "https", url.user == nil, url.password == nil else {
      return nil
    }
    return url
  }

  private func writeTemporaryImage(data: Data, mimeType: String) -> URL? {
    let ext: String
    switch mimeType {
    case "image/png": ext = "png"
    case "image/gif": ext = "gif"
    default: ext = "jpg"
    }
    let url = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString)
      .appendingPathExtension(ext)
    do {
      try data.write(to: url, options: [.atomic])
      return url
    } catch {
      return nil
    }
  }

  private func applyCommunicationMetadata(imageData: Data, content: UNMutableNotificationContent) {
    guard
      let actorID = content.userInfo["actorId"] as? String,
      !actorID.isEmpty,
      let conversationID = content.userInfo["conversationId"] as? String,
      !conversationID.isEmpty,
      let image = INImage(imageData: imageData)
    else {
      complete(content)
      return
    }

    let handle = INPersonHandle(value: actorID, type: .unknown)
    let sender = INPerson(
      personHandle: handle,
      nameComponents: nil,
      displayName: content.title,
      image: image,
      contactIdentifier: nil,
      customIdentifier: actorID,
      isMe: false
    )
    let intent = INSendMessageIntent(
      recipients: nil,
      outgoingMessageType: .outgoingMessageText,
      content: content.body,
      speakableGroupName: content.subtitle.isEmpty
        ? nil
        : INSpeakableString(spokenPhrase: content.subtitle),
      conversationIdentifier: conversationID,
      serviceName: nil,
      sender: sender,
      attachments: nil
    )
    let interaction = INInteraction(intent: intent, response: nil)
    interaction.direction = .incoming
    interaction.donate { [weak self] _ in
      guard let self else { return }
      let updated = (try? content.updating(from: intent)) ?? content
      self.complete(updated)
    }
  }

  private func fallbackContent(_ fallback: UNNotificationContent?) -> UNNotificationContent {
    completionLock.lock()
    defer { completionLock.unlock() }
    return bestAttemptContent ?? fallback ?? UNMutableNotificationContent()
  }

  /// Calls Apple's completion handler exactly once, including timeout races.
  private func complete(_ content: UNNotificationContent) {
    completionLock.lock()
    if didComplete {
      completionLock.unlock()
      return
    }
    didComplete = true
    let handler = contentHandler
    contentHandler = nil
    task = nil
    completionLock.unlock()
    handler?(content)
  }
}
