// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "LynxShipOta",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "LynxShipOta", targets: ["LynxShipOta"]),
    ],
    targets: [
        .target(name: "LynxShipOta"),
    ]
)
