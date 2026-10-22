import XCTest
@testable import EstateInventory

final class NavigationPolicyTests: XCTestCase {
    func testEstateRoutesStayInsideApp() {
        for path in ["", "e/123/scan", "e/123/reports/family?sort=name"] {
            XCTAssertTrue(NavigationPolicy.isAppURL(URL(string: NavigationPolicy.home.absoluteString + path)!))
        }
    }
    func testUntrustedOriginsAndSiblingSitesStayOutsideApp() {
        for value in ["http://redbaron13.github.io/estate-inventory/", "https://redbaron13.github.io.evil.example/estate-inventory/", "https://redbaron13.github.io/another-site/", "https://redbaron13.github.io/estate-inventory-evil/", "file:///etc/passwd", "javascript:alert(1)"] {
            XCTAssertFalse(NavigationPolicy.isAppURL(URL(string: value)!))
        }
    }
}
