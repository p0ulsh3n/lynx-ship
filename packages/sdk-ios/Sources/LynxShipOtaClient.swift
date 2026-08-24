import Foundation

#if canImport(CryptoKit)
import CryptoKit
#endif

/// Dependency-light OTA client for a native Lynx iOS host.
///
/// The host renders `openActiveAsset("main.lynx.bundle")` through its
/// LynxView template provider. Only interpreted Lynx assets are accepted.
public final class LynxShipOtaClient {
    public typealias EmbeddedAssetProvider = (String) throws -> Data

    public struct Configuration {
        public let storageDirectory: URL
        public let endpoint: URL
        public let projectID: String
        public let channel: String
        public let runtimeVersion: String
        public let installationID: String
        public let publicKeys: [String: String]
        public let embeddedAssets: EmbeddedAssetProvider
        public let maxConsecutiveFailures: Int
        public let maxReleaseBytes: Int

        public init(
            storageDirectory: URL,
            endpoint: URL,
            projectID: String,
            channel: String,
            runtimeVersion: String,
            installationID: String,
            publicKeys: [String: String],
            embeddedAssets: @escaping EmbeddedAssetProvider,
            maxConsecutiveFailures: Int = 3,
            maxReleaseBytes: Int = 100 * 1024 * 1024
        ) throws {
            guard endpoint.scheme == "https" || endpoint.isLocalDevelopment else {
                throw OtaError.insecureEndpoint
            }
            guard maxConsecutiveFailures > 0, maxReleaseBytes > 0 else {
                throw OtaError.invalidConfiguration
            }
            self.storageDirectory = storageDirectory
            self.endpoint = endpoint
            self.projectID = projectID
            self.channel = channel
            self.runtimeVersion = runtimeVersion
            self.installationID = installationID
            self.publicKeys = publicKeys
            self.embeddedAssets = embeddedAssets
            self.maxConsecutiveFailures = maxConsecutiveFailures
            self.maxReleaseBytes = maxReleaseBytes
        }
    }

    public enum OtaError: Error {
        case invalidConfiguration
        case insecureEndpoint
        case invalidRelease
        case invalidAssetPath
        case invalidAssetURL
        case signatureInvalid
        case integrityInvalid
        case incompatibleRelease
        case sizeLimitExceeded
        case noCandidate
        case rollbackUnavailable
    }

    public struct Release: Codable, Sendable {
        public let id: String
        public let signature: String
        public let manifest: Manifest
    }

    public struct Manifest: Codable, Sendable {
        public let protocolVersion: Int
        public let projectId: String
        public let channel: String
        public let platform: String
        public let runtimeVersion: String
        public let sequence: Int
        public let keyId: String
        public let assets: [Asset]
    }

    public struct Asset: Codable, Sendable {
        public let path: String
        public let hash: String
        public let size: Int
        public let url: URL?
    }

    private struct State: Codable {
        var activeSequence = 0
        var activeID = "embedded"
        var lastGoodSequence = 0
        var lastGoodID = "embedded"
        var failedLaunches = 0
        var candidatePending = false
    }

    private let configuration: Configuration
    private let activeDirectory: URL
    private let candidateDirectory: URL
    private let lastKnownGoodDirectory: URL
    private let stateURL: URL
    private var state: State
    private let fileManager = FileManager.default

    public init(configuration: Configuration) throws {
        self.configuration = configuration
        self.activeDirectory = configuration.storageDirectory.appendingPathComponent("active", isDirectory: true)
        self.candidateDirectory = configuration.storageDirectory.appendingPathComponent("candidate", isDirectory: true)
        self.lastKnownGoodDirectory = configuration.storageDirectory.appendingPathComponent("last-known-good", isDirectory: true)
        self.stateURL = configuration.storageDirectory.appendingPathComponent("state.json")
        self.state = (try? Self.readState(at: stateURL)) ?? State()
        try fileManager.createDirectory(at: configuration.storageDirectory, withIntermediateDirectories: true)
        try recoverInterruptedActivation()
    }

    public func checkForUpdate() async throws -> Release? {
        var components = URLComponents(url: configuration.endpoint.appendingPathComponent("v1/ota/check"), resolvingAgainstBaseURL: false)
        components?.queryItems = [
            URLQueryItem(name: "projectId", value: configuration.projectID),
            URLQueryItem(name: "channel", value: configuration.channel),
            URLQueryItem(name: "platform", value: "ios"),
            URLQueryItem(name: "runtimeVersion", value: configuration.runtimeVersion),
            URLQueryItem(name: "installationId", value: configuration.installationID),
        ]
        guard let url = components?.url else { throw OtaError.invalidConfiguration }
        let (data, response) = try await URLSession.shared.data(from: url)
        guard let http = response as? HTTPURLResponse else { throw OtaError.invalidRelease }
        if http.statusCode == 204 || http.statusCode == 404 { return nil }
        guard http.statusCode == 200 else { throw OtaError.invalidRelease }
        if data == Data("null".utf8) { return nil }
        return try JSONDecoder().decode(Release.self, from: data)
    }

    public func checkAndInstall() async throws -> Bool {
        guard let release = try await checkForUpdate() else { return false }
        return try await installCandidate(release)
    }

    public func installCandidate(_ release: Release) async throws -> Bool {
        try validate(release)
        guard release.manifest.sequence > state.activeSequence else { return false }
        let temporary = configuration.storageDirectory.appendingPathComponent("download-\(release.manifest.sequence).tmp", isDirectory: true)
        try removeIfPresent(temporary)
        try fileManager.createDirectory(at: temporary, withIntermediateDirectories: true)
        do {
            var total = 0
            for asset in release.manifest.assets {
                guard let url = asset.url else { throw OtaError.invalidAssetURL }
                let (data, response) = try await URLSession.shared.data(from: url)
                guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { throw OtaError.invalidAssetURL }
                total += data.count
                guard total <= configuration.maxReleaseBytes, data.count == asset.size else { throw OtaError.sizeLimitExceeded }
                guard sha256(data) == asset.hash.lowercased() else { throw OtaError.integrityInvalid }
                let destination = try safeURL(asset.path, inside: temporary)
                try fileManager.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
                try data.write(to: destination, options: .atomic)
            }
            let releaseData = try JSONEncoder().encode(release)
            try releaseData.write(to: temporary.appendingPathComponent("release.json"), options: .atomic)
            try removeIfPresent(candidateDirectory)
            try fileManager.moveItem(at: temporary, to: candidateDirectory)
            state.candidatePending = true
            try saveState()
            return true
        } catch {
            try? removeIfPresent(temporary)
            throw error
        }
    }

    public func activateCandidate() throws {
        guard fileManager.fileExists(atPath: candidateDirectory.path) else { return }
        try removeIfPresent(lastKnownGoodDirectory)
        if fileManager.fileExists(atPath: activeDirectory.path) {
            try fileManager.moveItem(at: activeDirectory, to: lastKnownGoodDirectory)
        }
        try fileManager.moveItem(at: candidateDirectory, to: activeDirectory)
        state.activeSequence = state.candidatePending ? sequenceFromActiveDirectory() : state.activeSequence
        state.activeID = state.candidatePending ? "release-\(state.activeSequence)" : state.activeID
        state.candidatePending = false
        state.failedLaunches = 0
        try saveState()
    }

    public func beginLaunch() throws {
        guard state.activeSequence != state.lastGoodSequence else { return }
        state.failedLaunches += 1
        try saveState()
        if state.failedLaunches >= configuration.maxConsecutiveFailures {
            try rollbackToLastKnownGood()
        }
    }

    public func markLaunchSuccess() throws {
        guard fileManager.fileExists(atPath: activeDirectory.path) else { return }
        try removeIfPresent(lastKnownGoodDirectory)
        try fileManager.copyItem(at: activeDirectory, to: lastKnownGoodDirectory)
        state.lastGoodSequence = state.activeSequence
        state.lastGoodID = state.activeID
        state.failedLaunches = 0
        try saveState()
    }

    public func openActiveAsset(_ path: String) throws -> Data {
        guard isSafePath(path) else { throw OtaError.invalidAssetPath }
        let activeURL = try safeURL(path, inside: activeDirectory)
        if fileManager.fileExists(atPath: activeURL.path) { return try Data(contentsOf: activeURL) }
        return try configuration.embeddedAssets(path)
    }

    public var activeSequence: Int { state.activeSequence }

    private func validate(_ release: Release) throws {
        guard release.manifest.protocolVersion == 1,
              release.manifest.projectId == configuration.projectID,
              release.manifest.channel == configuration.channel,
              release.manifest.platform == "ios",
              release.manifest.runtimeVersion == configuration.runtimeVersion,
              !release.manifest.assets.isEmpty else { throw OtaError.incompatibleRelease }
        guard let publicKey = configuration.publicKeys[release.manifest.keyId], verify(release, publicKey: publicKey) else {
            throw OtaError.signatureInvalid
        }
        var total = 0
        for asset in release.manifest.assets {
            guard isSafePath(asset.path), let url = asset.url else { throw OtaError.invalidAssetURL }
            guard url.scheme == "https" || (url.scheme == "http" && url.isLocalDevelopment) else { throw OtaError.insecureEndpoint }
            total += asset.size
            guard asset.size >= 0, total <= configuration.maxReleaseBytes else { throw OtaError.sizeLimitExceeded }
        }
    }

    private func verify(_ release: Release, publicKey: String) -> Bool {
        #if canImport(CryptoKit)
        do {
            let keyData = try Self.derPublicKeyData(publicKey)
            let key = try Curve25519.Signing.PublicKey(rawRepresentation: keyData)
            return key.isValidSignature(try Self.base64URLDecode(release.signature), for: Data(Self.canonicalManifest(release.manifest).utf8))
        } catch {
            return false
        }
        #else
        return false
        #endif
    }

    private func recoverInterruptedActivation() throws {
        if state.candidatePending, fileManager.fileExists(atPath: candidateDirectory.path) {
            try activateCandidate()
        }
        if state.failedLaunches >= configuration.maxConsecutiveFailures {
            try rollbackToLastKnownGood()
        }
    }

    private func rollbackToLastKnownGood() throws {
        guard fileManager.fileExists(atPath: lastKnownGoodDirectory.path) else { throw OtaError.rollbackUnavailable }
        try removeIfPresent(activeDirectory)
        try fileManager.moveItem(at: lastKnownGoodDirectory, to: activeDirectory)
        state.activeSequence = state.lastGoodSequence
        state.activeID = state.lastGoodID
        state.failedLaunches = 0
        try saveState()
    }

    private func saveState() throws {
        try fileManager.createDirectory(at: configuration.storageDirectory, withIntermediateDirectories: true)
        try JSONEncoder().encode(state).write(to: stateURL, options: .atomic)
    }

    private static func readState(at url: URL) throws -> State {
        guard FileManager.default.fileExists(atPath: url.path) else { return State() }
        return try JSONDecoder().decode(State.self, from: Data(contentsOf: url))
    }

    private func safeURL(_ path: String, inside directory: URL) throws -> URL {
        guard isSafePath(path) else { throw OtaError.invalidAssetPath }
        let result = directory.appendingPathComponent(path).standardizedFileURL
        guard result.path.hasPrefix(directory.standardizedFileURL.path + "/") else { throw OtaError.invalidAssetPath }
        return result
    }

    private func sequenceFromActiveDirectory() -> Int {
        guard let data = try? Data(contentsOf: activeDirectory.appendingPathComponent("release.json")),
              let release = try? JSONDecoder().decode(Release.self, from: data) else { return state.activeSequence }
        return release.manifest.sequence
    }

    private func removeIfPresent(_ url: URL) throws {
        if fileManager.fileExists(atPath: url.path) { try fileManager.removeItem(at: url) }
    }

    private static func canonicalManifest(_ manifest: Manifest) -> String {
        let assets = manifest.assets.sorted { $0.path < $1.path }.map { asset in
            var value: [String: Any] = ["hash": asset.hash, "path": asset.path, "size": asset.size]
            if let url = asset.url { value["url"] = url.absoluteString }
            return value
        }
        let value: [String: Any] = [
            "assets": assets,
            "channel": manifest.channel,
            "keyId": manifest.keyId,
            "platform": manifest.platform,
            "projectId": manifest.projectId,
            "protocolVersion": manifest.protocolVersion,
            "runtimeVersion": manifest.runtimeVersion,
            "sequence": manifest.sequence,
        ]
        let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .withoutEscapingSlashes])
        return String(decoding: data, as: UTF8.self)
    }

    private static func sha256(_ data: Data) -> String {
        #if canImport(CryptoKit)
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        #else
        return ""
        #endif
    }

    #if canImport(CryptoKit)
    private static func derPublicKeyData(_ pem: String) throws -> Data {
        let body = pem
            .replacingOccurrences(of: "-----BEGIN PUBLIC KEY-----", with: "")
            .replacingOccurrences(of: "-----END PUBLIC KEY-----", with: "")
            .components(separatedBy: .whitespacesAndNewlines).joined()
        guard let der = Data(base64Encoded: body), der.count >= 32 else { throw OtaError.signatureInvalid }
        return der.suffix(32)
    }

    private static func base64URLDecode(_ value: String) throws -> Data {
        var text = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        text += String(repeating: "=", count: (4 - text.count % 4) % 4)
        guard let data = Data(base64Encoded: text) else { throw OtaError.signatureInvalid }
        return data
    }
    #endif
}

private extension URL {
    var isLocalDevelopment: Bool {
        host == "localhost" || host == "127.0.0.1" || host == "10.0.2.2"
    }
}

private func isSafePath(_ path: String) -> Bool {
    !path.isEmpty && !path.hasPrefix("/") && !path.contains("\\") && !path.contains("..")
}
