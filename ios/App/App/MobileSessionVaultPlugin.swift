import Capacitor
import Foundation
import Security

@objc(MobileSessionVaultPlugin)
public final class MobileSessionVaultPlugin: CAPInstancePlugin, CAPBridgedPlugin {
    public let identifier = "MobileSessionVaultPlugin"
    public let jsName = "MobileSessionVault"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "load", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "save", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise)
    ]

    private let item: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "com.tchurch.mobile-auth",
        kSecAttrAccount as String: "session-v1",
        kSecAttrSynchronizable as String: false
    ]

    @objc func load(_ call: CAPPluginCall) {
        var query = item
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        query[kSecReturnData as String] = true
        var value: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &value)
        if status == errSecItemNotFound {
            call.resolve()
        } else if status == errSecSuccess, let data = value as? Data, let session = String(data: data, encoding: .utf8) {
            call.resolve(["session": session])
        } else {
            call.reject("Could not read the mobile session")
        }
    }

    @objc func save(_ call: CAPPluginCall) {
        guard let session = call.getString("session"), !session.isEmpty, session.utf8.count <= 32_768 else {
            call.reject("Invalid mobile session")
            return
        }

        let data = Data(session.utf8)
        var status = SecItemUpdate(item as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var attributes = item
            attributes[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            attributes[kSecValueData as String] = data
            status = SecItemAdd(attributes as CFDictionary, nil)
        }
        if status == errSecSuccess {
            call.resolve()
        } else {
            call.reject("Could not save the mobile session")
        }
    }

    @objc func clear(_ call: CAPPluginCall) {
        let status = SecItemDelete(item as CFDictionary)
        if status == errSecSuccess || status == errSecItemNotFound {
            call.resolve()
        } else {
            call.reject("Could not clear the mobile session")
        }
    }
}
