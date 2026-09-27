import SwiftUI
import AuthenticationServices
import ASKit

struct SignInView: View {
    @Environment(AppModel.self) private var app
    @State private var rawNonce = AppleNonce.make()
    @State private var devName = ""
    @State private var working = false

    var body: some View {
        ZStack {
            Theme.paper.ignoresSafeArea()
            VStack(spacing: 28) {
                Spacer()
                VStack(spacing: 10) {
                    Text("Another Society")
                        .font(.system(.largeTitle, design: .serif).weight(.semibold))
                        .foregroundStyle(Theme.ink)
                    Text("A quiet place to live alongside others.")
                        .font(.body)
                        .foregroundStyle(Theme.ink.opacity(0.7))
                }
                DioramaMark().frame(height: 160)
                Spacer()
                SignInWithAppleButton(.continue) { request in
                    rawNonce = AppleNonce.make()
                    request.requestedScopes = [] // we never need name or email; the Apple user id is the identity
                    request.nonce = AppleNonce.sha256(rawNonce)
                } onCompletion: { result in
                    handle(result)
                }
                .signInWithAppleButtonStyle(.black)
                .frame(height: 50)
                .disabled(working)

                if AppConfig.allowsDevSignIn {
                    VStack(spacing: 8) {
                        Text("Local server (DEV_AUTH)").font(.caption).foregroundStyle(.secondary)
                        HStack {
                            TextField("dev name", text: $devName)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .textFieldStyle(.roundedBorder)
                            Button("Enter") {
                                working = true
                                Task { await app.devSignIn(name: devName); working = false }
                            }
                            .buttonStyle(.bordered)
                        }
                        Text(AppConfig.apiBaseURL.absoluteString).font(.caption2).foregroundStyle(.tertiary)
                    }
                }
            }
            .padding(24)
        }
    }

    private func handle(_ result: Result<ASAuthorization, Error>) {
        guard case .success(let auth) = result,
              let cred = auth.credential as? ASAuthorizationAppleIDCredential,
              let tokenData = cred.identityToken, let token = String(data: tokenData, encoding: .utf8),
              let codeData = cred.authorizationCode, let code = String(data: codeData, encoding: .utf8)
        else {
            if case .failure(let e) = result, (e as? ASAuthorizationError)?.code == .canceled { return }
            app.banner = "Sign in with Apple did not complete."
            return
        }
        working = true
        let nonce = rawNonce
        Task {
            await app.signInWithApple(identityToken: token, authorizationCode: code, rawNonce: nonce)
            working = false
        }
    }
}

/// Small paper-diorama vignette used on the welcome screen (placeholder art).
struct DioramaMark: View {
    var body: some View {
        Canvas { ctx, size in
            let w = size.width, h = size.height
            let ground = Path(roundedRect: CGRect(x: w * 0.15, y: h * 0.62, width: w * 0.7, height: h * 0.22), cornerRadius: 18)
            ctx.fill(ground, with: .color(Theme.ground))
            for (i, x) in [0.22, 0.72, 0.8].enumerated() {
                let r = CGFloat(18 + i * 4)
                ctx.fill(Path(ellipseIn: CGRect(x: w * x - r, y: h * 0.5 - r, width: r * 2, height: r * 2.2)), with: .color(Theme.forest))
            }
            var house = Path()
            house.addRect(CGRect(x: w * 0.4, y: h * 0.45, width: w * 0.2, height: h * 0.22))
            ctx.fill(house, with: .color(Theme.wall))
            var roof = Path()
            roof.move(to: CGPoint(x: w * 0.37, y: h * 0.46))
            roof.addLine(to: CGPoint(x: w * 0.5, y: h * 0.3))
            roof.addLine(to: CGPoint(x: w * 0.63, y: h * 0.46))
            roof.closeSubpath()
            ctx.fill(roof, with: .color(Theme.roofWarm))
            ctx.fill(Path(roundedRect: CGRect(x: w * 0.475, y: h * 0.56, width: w * 0.05, height: h * 0.11), cornerRadius: 3), with: .color(Theme.ink.opacity(0.7)))
        }
        .accessibilityHidden(true)
    }
}
