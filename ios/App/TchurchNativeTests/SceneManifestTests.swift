import XCTest
import UIKit

final class SceneManifestTests: XCTestCase {
    @MainActor
    func testProductionAppDeclaresSingleMainStoryboardScene() async throws {
        var scene: UIWindowScene?
        for _ in 0..<30 {
            scene = UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .first(where: { $0.windows.contains(where: { $0.rootViewController != nil }) })
            if scene != nil { break }
            try await Task.sleep(nanoseconds: 100_000_000)
        }

        let windowScene = try XCTUnwrap(scene, "The hosted production app did not connect a UIWindowScene")
        let window = try XCTUnwrap(
            windowScene.windows.first(where: { $0.rootViewController != nil }),
            "The production scene did not create its window"
        )
        let rootViewController = try XCTUnwrap(window.rootViewController)
        XCTAssertEqual(String(describing: type(of: rootViewController)), "TchurchBridgeViewController")
        XCTAssertIdentical(window.windowScene, windowScene)

        let appBundle = Bundle(for: type(of: rootViewController))
        XCTAssertEqual(appBundle.bundleIdentifier, "app.lovable.e5ddf50ff80d4eb7a86a937f7a9f8a62.tchurch")
        let manifest = try XCTUnwrap(
            appBundle.object(forInfoDictionaryKey: "UIApplicationSceneManifest") as? [String: Any]
        )

        XCTAssertEqual(manifest["UIApplicationSupportsMultipleScenes"] as? Bool, false)

        let configurations = try XCTUnwrap(
            manifest["UISceneConfigurations"] as? [String: Any]
        )
        let applicationScenes = try XCTUnwrap(
            configurations["UIWindowSceneSessionRoleApplication"] as? [[String: Any]]
        )
        let configuration = try XCTUnwrap(applicationScenes.first)

        XCTAssertEqual(configuration["UISceneStoryboardFile"] as? String, "Main")
        XCTAssertTrue((configuration["UISceneDelegateClassName"] as? String)?.hasSuffix(".SceneDelegate") == true)
    }
}
