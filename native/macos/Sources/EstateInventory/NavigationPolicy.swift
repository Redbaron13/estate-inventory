import Foundation

struct NavigationPolicy {
    static let home: URL = {
        let value = Bundle.main.object(forInfoDictionaryKey: "EstateAppURL") as? String ?? "https://eiapp3.redbaronworks.com/"
        let development = (Bundle.main.object(forInfoDictionaryKey: "EstateReleaseID") as? String)?.hasPrefix("ZY") == true
        guard let url = URL(string: value), validHome(url, development: development) else { fatalError("Invalid inventory URL in app bundle.") }
        return url
    }()
    static func validHome(_ url: URL, development: Bool) -> Bool {
        guard url.user == nil, url.password == nil, url.query == nil, url.fragment == nil, url.host != nil else { return false }
        return url.scheme == "https" || (development && url.scheme == "http" && ["127.0.0.1", "localhost", "[::1]"].contains(url.host!))
    }
    private static func port(_ url: URL) -> Int { url.port ?? (url.scheme == "https" ? 443 : 80) }
    static func sameOrigin(_ url: URL, home: URL = home) -> Bool {
        url.scheme == home.scheme && url.host == home.host && port(url) == port(home) && url.user == nil && url.password == nil
    }
    static func trustedOrigin(scheme: String, host: String, port: Int) -> Bool {
        scheme == home.scheme && host == home.host && (port == 0 ? (scheme == "https" ? 443 : 80) : port) == self.port(home)
    }
    static func isAppURL(_ url: URL, home: URL = home) -> Bool {
        let root = home.standardized.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let path = url.standardized.path
        return sameOrigin(url, home: home) && (root.isEmpty || path == "/" + root || path.hasPrefix("/" + root + "/"))
    }
    static func isDownload(_ url: URL, home: URL = home) -> Bool {
        guard url.scheme == "blob", let origin = URL(string: String(url.absoluteString.dropFirst(5))) else { return false }
        return sameOrigin(origin, home: home)
    }
}
