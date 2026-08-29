// The whole native app.
//
// It exists for one reason: there is no web API for AirPods head motion, and
// CMHeadphoneMotionManager is the only way to get it. So this is a WKWebView holding
// the same page you can open in Safari, plus the two things the web cannot do —
// read the buds, and keep talking with the screen off.
//
// It adds a sensor. It does not reimplement any of the coaching.

import SwiftUI
import WebKit
import CoreMotion
import AVFoundation

let appURL = URL(string: "https://form-coach-production.up.railway.app")!

@main
struct FormCoachApp: App {
    var body: some Scene {
        WindowGroup { CoachView().ignoresSafeArea().preferredColorScheme(.dark) }
    }
}

struct CoachView: UIViewRepresentable {
    func makeCoordinator() -> Bridge { Bridge() }

    func makeUIView(context: Context) -> WKWebView {
        let cfg = WKWebViewConfiguration()
        cfg.allowsInlineMediaPlayback = true
        cfg.mediaTypesRequiringUserActionForPlayback = []
        cfg.userContentController.add(context.coordinator, name: "say")

        let web = WKWebView(frame: .zero, configuration: cfg)
        web.navigationDelegate = context.coordinator
        web.isOpaque = false
        web.backgroundColor = .black
        web.scrollView.bounces = false
        context.coordinator.web = web

        UIApplication.shared.isIdleTimerDisabled = true   // never sleep mid-lap
        web.load(URLRequest(url: appURL, cachePolicy: .reloadRevalidatingCacheData))
        return web
    }

    func updateUIView(_ web: WKWebView, context: Context) {}
}

final class Bridge: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    weak var web: WKWebView?

    private let headphones = CMHeadphoneMotionManager()
    private let speaker = AVSpeechSynthesizer()
    private var t0: TimeInterval?
    private var triedBundled = false

    override init() {
        super.init()
        // .playback keeps cues coming with the screen off. duckOthers means we cut
        // through your music instead of stopping it.
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .spokenAudio,
                                 options: [.duckOthers, .mixWithOthers])
        try? session.setActive(true)
    }

    // MARK: web page -> native voice

    func userContentController(_ controller: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard let text = message.body as? String, !text.isEmpty else { return }
        speaker.stopSpeaking(at: .immediate)
        let utterance = AVSpeechUtterance(string: text)
        utterance.rate = 0.52
        speaker.speak(utterance)
    }

    // MARK: loading

    func webView(_ web: WKWebView, didFinish navigation: WKNavigation!) {
        startHeadUpdates()
    }

    func webView(_ web: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
                 withError error: Error) { loadBundled() }

    func webView(_ web: WKWebView, didFail navigation: WKNavigation!,
                 withError error: Error) { loadBundled() }

    // A track has dead spots and a cold start there should still work, so a copy of
    // the page ships inside the app. Only used when the network load fails.
    private func loadBundled() {
        guard !triedBundled,
              let file = Bundle.main.url(forResource: "index", withExtension: "html")
        else { return }
        triedBundled = true
        web?.loadFileURL(file, allowingReadAccessTo: file.deletingLastPathComponent())
    }

    // MARK: AirPods -> web page

    private func startHeadUpdates() {
        guard CMHeadphoneMotionManager.authorizationStatus() != .denied,
              headphones.isDeviceMotionAvailable,
              !headphones.isDeviceMotionActive
        else { return }

        // Roughly 25 Hz, and only ever from one bud at a time — the system picks
        // which, and switches on in-ear state. There is no way to get both.
        headphones.startDeviceMotionUpdates(to: .main) { [weak self] motion, _ in
            guard let self, let m = motion, let web = self.web else { return }
            if self.t0 == nil { self.t0 = m.timestamp }

            // CoreMotion reports g. The page works in m/s^2, like DeviceMotionEvent.
            // The sign convention differs from Safari's, which does not matter: every
            // metric in coach.js is computed from variance or autocorrelation.
            let a = m.userAcceleration, g = m.gravity, G = 9.81
            let sample: [String: Any] = [
                "t": (m.timestamp - (self.t0 ?? m.timestamp)) * 1000,
                "ax": a.x * G, "ay": a.y * G, "az": a.z * G,
                "gx": (a.x + g.x) * G, "gy": (a.y + g.y) * G, "gz": (a.z + g.z) * G,
            ]
            guard let data = try? JSONSerialization.data(withJSONObject: sample),
                  let json = String(data: data, encoding: .utf8) else { return }
            web.evaluateJavaScript("window.__head(\(json))")
        }
    }
}
