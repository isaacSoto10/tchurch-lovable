import Capacitor

@objc(TchurchBridgeViewController)
final class TchurchBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(PresentationHardwarePlugin())
        bridge?.registerPluginInstance(StudioLANClientPlugin())
    }
}
