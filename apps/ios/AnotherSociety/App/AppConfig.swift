import Foundation

enum AppConfig {
    private static let overrideKey = "as.apiBaseURL.override"

    /// Debug: http://127.0.0.1:8787 (`wrangler dev` on this Mac, reachable from the Simulator).
    /// Release: set AS_API_BASE_URL in project.yml. A Debug-only override lives in Settings.
    static var apiBaseURL: URL {
        #if DEBUG
        if let s = UserDefaults.standard.string(forKey: overrideKey), let u = URL(string: s), u.scheme != nil { return u }
        #endif
        let raw = Bundle.main.object(forInfoDictionaryKey: "ASAPIBaseURL") as? String ?? ""
        return URL(string: raw) ?? URL(string: "http://127.0.0.1:8787")!
    }

    static func setOverride(_ url: String?) {
        UserDefaults.standard.set(url?.isEmpty == false ? url : nil, forKey: overrideKey)
    }

    static var overrideValue: String { UserDefaults.standard.string(forKey: overrideKey) ?? "" }

    /// Published support contact (App Store UGC requirement, Blueprint §34).
    static let supportEmail = "talk@implemon.com"

    /// Seconds a visitor must stay before the server counts the visit (server re-measures; Blueprint §11.1).
    static let visitQualifyDelay: Double = 6

    #if DEBUG
    static let allowsDevSignIn = true
    #else
    static let allowsDevSignIn = false
    #endif
}
