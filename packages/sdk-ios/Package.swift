// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "LynxShipOta",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "LynxShipOta", targets: ["LynxShipOta"]),
    ],
    targets: [
        // The native Lynx container is consumed through the CocoaPods target,
        // which supplies the official Lynx framework dependency. Keeping the
        // OTA target explicit preserves a dependency-free Swift package.
        .target(name: "LynxShipOta", path: "Sources", sources: ["LynxShipOtaClient.swift"]),
    ]
)
