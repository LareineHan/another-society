import XCTest

/// Walks the main screens against a DEV_AUTH server and saves screenshots
/// (CI publishes them to the `ci-screenshots` branch).
final class ScreenshotTests: XCTestCase {
    private let dir = ProcessInfo.processInfo.environment["AS_SHOT_DIR"]

    override func setUp() { continueAfterFailure = false }

    private func shot(_ name: String) {
        let s = XCUIScreen.main.screenshot()
        let a = XCTAttachment(screenshot: s)
        a.name = name
        a.lifetime = .keepAlways
        add(a)
        if let dir {
            try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
            try? s.pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"))
        }
    }

    func testSignInScreen() {
        let app = XCUIApplication()
        app.launchEnvironment["AS_RESET"] = "1"
        app.launch()
        XCTAssertTrue(app.staticTexts["Another Society"].waitForExistence(timeout: 20))
        sleep(1)
        shot("01-sign-in")
    }

    func testWorldTour() {
        let app = XCUIApplication()
        app.launchEnvironment["AS_DEMO_NAME"] = "tour-\(UUID().uuidString.prefix(8))"
        app.launch()

        let home = app.buttons["Home"]
        XCTAssertTrue(home.waitForExistence(timeout: 90), "world did not open")
        sleep(3)
        shot("02-city")

        home.tap()
        XCTAssertTrue(app.buttons["Arrange"].waitForExistence(timeout: 30), "home room did not open")
        sleep(2)
        shot("03-home-with-guest-and-gift")

        app.buttons["Arrange"].tap()
        sleep(1)
        shot("04-arrange")
        app.buttons["Cancel"].tap()

        let guests = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Guests'")).firstMatch
        if guests.waitForExistence(timeout: 5) {
            guests.tap()
            sleep(1)
            shot("05-guests")
            app.swipeDown(velocity: .fast)
            sleep(1)
        }

        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(home.waitForExistence(timeout: 10))
        app.buttons["Bag"].tap()
        sleep(2)
        shot("06-bag")
        app.swipeDown(velocity: .fast)
        sleep(1)
        let wander = app.buttons["Wander"]
        for _ in 0..<3 where !wander.isHittable { app.swipeDown(velocity: .fast); sleep(1) }

        wander.tap()
        let row = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'quiet home' OR label CONTAINS[c] 'someone staying'")).firstMatch
        if row.waitForExistence(timeout: 15) {
            sleep(1)
            shot("07-wander")
            row.tap()
            if app.buttons["Leave a gift"].waitForExistence(timeout: 30) {
                sleep(2)
                shot("08-visiting")
            }
        } else {
            shot("07-wander-empty")
        }
    }
}
