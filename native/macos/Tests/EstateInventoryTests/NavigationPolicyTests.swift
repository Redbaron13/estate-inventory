import XCTest
@testable import EstateInventory

final class NavigationPolicyTests: XCTestCase {
    func testProductionAndProjectRoutes() {
        for home in [URL(string: "https://eiapp3.redbaronworks.com/")!, URL(string: "https://redbaron13.github.io/estate-inventory/")!] {
            for path in ["", "e/123/scan", "e/123/reports/family?sort=name"] {
                XCTAssertTrue(NavigationPolicy.isAppURL(URL(string: home.absoluteString + path)!, home: home))
            }
            for value in ["http://eiapp3.redbaronworks.com/", "https://eiapp3.redbaronworks.com:444/", "https://redbaron13.github.io.evil.example/estate-inventory/", "file:///etc/passwd", "javascript:alert(1)", "https://user@eiapp3.redbaronworks.com/"] {
                XCTAssertFalse(NavigationPolicy.isAppURL(URL(string: value)!, home: home))
            }
        }
    }
    func testProjectPathBoundaryAndDownloads() {
        let home = URL(string: "https://redbaron13.github.io/estate-inventory/")!
        for path in ["/another-site/", "/estate-inventory-evil/", "/estate-inventory/../another-site/"] {
            XCTAssertFalse(NavigationPolicy.isAppURL(URL(string: "https://redbaron13.github.io" + path)!, home: home))
        }
        XCTAssertTrue(NavigationPolicy.isDownload(URL(string: "blob:https://redbaron13.github.io/id")!, home: home))
        XCTAssertFalse(NavigationPolicy.isDownload(URL(string: "blob:https://evil.example/id")!, home: home))
    }
    func testLoopbackOnlyInDevelopment() {
        let home = URL(string: "http://127.0.0.1:4173/")!
        XCTAssertTrue(NavigationPolicy.validHome(home, development: true))
        XCTAssertFalse(NavigationPolicy.validHome(home, development: false))
        XCTAssertFalse(NavigationPolicy.validHome(URL(string: "http://remote.example/")!, development: true))
        XCTAssertTrue(NavigationPolicy.isAppURL(URL(string: "http://127.0.0.1:4173/e/123")!, home: home))
        XCTAssertFalse(NavigationPolicy.isAppURL(URL(string: "http://127.0.0.1:4174/")!, home: home))
    }
}
