import Foundation

struct NavigationPolicy {
    static let home = URL(string: "https://redbaron13.github.io/estate-inventory/")!
    static func isAppURL(_ url: URL) -> Bool {
        url.scheme == "https" && url.host == home.host &&
        (url.port == nil || url.port == 443) && url.user == nil && url.password == nil &&
        (url.path == "/estate-inventory" || url.path.hasPrefix("/estate-inventory/"))
    }
    static func isDownload(_ url: URL) -> Bool {
        url.absoluteString.hasPrefix("blob:https://redbaron13.github.io/")
    }
}
