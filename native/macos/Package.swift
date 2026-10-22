// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "EstateInventory",
    platforms: [.macOS(.v13)],
    products: [.executable(name: "EstateInventory", targets: ["EstateInventory"])],
    targets: [
        .executableTarget(name: "EstateInventory"),
        .testTarget(name: "EstateInventoryTests", dependencies: ["EstateInventory"])
    ]
)
