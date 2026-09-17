import UIKit
import Capacitor

/// Owns the single UIKit scene that hosts Tchurch's Capacitor bridge.
///
/// URL delivery is forwarded to Capacitor's application delegate proxy so the
/// App plugin keeps the same cold-launch and warm-link behavior in a scene
/// based lifecycle.
final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(
        _ scene: UIScene,
        willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        guard scene is UIWindowScene else { return }

        for context in connectionOptions.urlContexts {
            forward(urlContext: context)
        }

        for userActivity in connectionOptions.userActivities {
            _ = forward(userActivity: userActivity)
        }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for context in URLContexts {
            forward(urlContext: context)
        }
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        _ = forward(userActivity: userActivity)
    }

    private func forward(urlContext: UIOpenURLContext) {
        var options: [UIApplication.OpenURLOptionsKey: Any] = [
            .openInPlace: urlContext.options.openInPlace
        ]
        if let sourceApplication = urlContext.options.sourceApplication {
            options[.sourceApplication] = sourceApplication
        }
        if let annotation = urlContext.options.annotation {
            options[.annotation] = annotation
        }

        _ = ApplicationDelegateProxy.shared.application(
            UIApplication.shared,
            open: urlContext.url,
            options: options
        )
    }

    @discardableResult
    private func forward(userActivity: NSUserActivity) -> Bool {
        ApplicationDelegateProxy.shared.application(
            UIApplication.shared,
            continue: userActivity,
            restorationHandler: { _ in }
        )
    }
}
