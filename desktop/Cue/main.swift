// Cue.app: a menu-bar app that shows the Cue web UI in a floating Liquid Glass panel.
// ⌘\ shows/hides it from anywhere. It starts the local server (and Ollama) itself, captions the mic with
// Apple's on-device speech recognition, and screenshots what's behind the panel when you ask.
// Build: desktop/build.sh
import AppKit
import AVFoundation
import Carbon.HIToolbox
import ScreenCaptureKit
import Speech
import ServiceManagement
import WebKit

let info = Bundle.main.infoDictionary ?? [:]
let webRoot = (Bundle.main.resourcePath ?? ".") + "/web" // server + built app, copied in by build.sh (so Cue never reads ~/Documents)
let settingsURL = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Cue/cue.env")
let port = 8787
let logURL = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/Cue.log")

/// One line in ~/Library/Logs/Cue.log (status only, never what anyone said).
func log(_ msg: String) {
    guard let h = try? FileHandle(forWritingTo: logURL) else { return }
    h.seekToEndOfFile(); h.write(Data("\(Date()) Cue: \(msg)\n".utf8)); try? h.close()
}

func jsString(_ s: String) -> String {
    String(data: (try? JSONSerialization.data(withJSONObject: s, options: .fragmentsAllowed)) ?? Data("\"\"".utf8), encoding: .utf8)!
}

func portIsOpen(_ port: Int) -> Bool {
    let sock = socket(AF_INET, SOCK_STREAM, 0)
    defer { close(sock) }
    var addr = sockaddr_in()
    addr.sin_family = sa_family_t(AF_INET)
    addr.sin_port = in_port_t(UInt16(port).bigEndian)
    addr.sin_addr.s_addr = inet_addr("127.0.0.1")
    return withUnsafePointer(to: &addr) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(sock, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) == 0 } }
}

// Settings: local Ollama by default; ~/Library/Application Support/Cue/cue.env (KEY=VALUE lines) overrides, e.g. to use Akamai Cloud Inference.
func serverEnv() -> [String: String] {
    var env = ["AI_BASE_URL": "http://127.0.0.1:11434/v1", "AI_API_KEY": "ollama", "AI_MODEL": "gemma3:4b", "AI_VISION": "1", "PORT": String(port)]
    if let text = try? String(contentsOf: settingsURL, encoding: .utf8) {
        for line in text.split(separator: "\n") where !line.hasPrefix("#") {
            let kv = line.split(separator: "=", maxSplits: 1).map { $0.trimmingCharacters(in: .whitespaces) }
            if kv.count == 2, !kv[0].isEmpty { env[kv[0]] = kv[1].components(separatedBy: " #").first ?? kv[1] }
        }
    }
    return env
}

final class GlassPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

/// Transparent strip over the page's grab handle: drag the panel by it.
final class DragStrip: NSView {
    override func mouseDown(with event: NSEvent) { window?.performDrag(with: event) }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

enum HotKey {
    static var action: (() -> Void)?
    static var ref: EventHotKeyRef?
    static func register(_ action: @escaping () -> Void) {
        self.action = action
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, _, _ in HotKey.action?(); return noErr }, 1, &spec, nil, nil)
        RegisterEventHotKey(UInt32(kVK_ANSI_Backslash), UInt32(cmdKey), EventHotKeyID(signature: OSType(0x4355_4521), id: 1), GetApplicationEventTarget(), 0, &ref) // ⌘\
    }
}

struct CueError: LocalizedError { let errorDescription: String? ; init(_ m: String) { errorDescription = m } }

/// Your mic, through AVAudioEngine.
final class Mic {
    private let engine = AVAudioEngine()
    func start(_ feed: @escaping (AVAudioPCMBuffer) -> Void) async throws {
        guard await AVCaptureDevice.requestAccess(for: .audio) else { throw CueError("Allow the Microphone for Cue in System Settings → Privacy & Security, then try again.") }
        let input = engine.inputNode
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { buf, _ in feed(buf) }
        engine.prepare()
        do { try engine.start() } catch { throw CueError("Couldn't start the microphone: \(error.localizedDescription)") }
    }
    func stop() { engine.stop(); engine.inputNode.removeTap(onBus: 0) }
}

/// Everything your Mac plays (the other people on a call), through ScreenCaptureKit. Cue's own sounds are left out.
final class SystemAudio: NSObject, SCStreamOutput, SCStreamDelegate {
    private var stream: SCStream?
    private var feed: ((CMSampleBuffer) -> Void)?
    private let queue = DispatchQueue(label: "cue.system-audio")
    var onStop: ((String) -> Void)?

    func start(_ feed: @escaping (CMSampleBuffer) -> Void) async throws {
        let content: SCShareableContent
        do { content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true) }
        catch { throw CueError("To hear the other people on a call, allow Screen & System Audio Recording for Cue in System Settings → Privacy & Security, then reopen Cue.") }
        guard let display = content.displays.first else { throw CueError("No display found for system audio.") }
        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.excludesCurrentProcessAudio = true
        config.sampleRate = 48_000
        config.channelCount = 1
        config.width = 2; config.height = 2 // audio only; keep the video side as small as it goes
        config.minimumFrameInterval = CMTime(value: 1, timescale: 1)
        let s = SCStream(filter: SCContentFilter(display: display, excludingApplications: [], exceptingWindows: []), configuration: config, delegate: self)
        try s.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue)
        self.feed = feed
        try await s.startCapture()
        stream = s
    }
    func stop() { stream?.stopCapture(); stream = nil; feed = nil }
    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        if type == .audio, sampleBuffer.isValid { feed?(sampleBuffer) }
    }
    func stream(_ stream: SCStream, didStopWithError error: Error) {
        DispatchQueue.main.async { self.stream = nil; self.onStop?("System audio stopped: \(error.localizedDescription)") }
    }
}

/// Live captions for one speaker ("you" = mic, "them" = system audio) with Apple's speech recognizer,
/// on-device when available. A pause of 1.4 s ends a line.
final class Captions {
    let who: String
    var send: ((String) -> Void)?
    var request: SFSpeechAudioBufferRecognitionRequest? // the audio source feeds this
    private let startSource: (Captions) async throws -> Void
    private let stopSource: () -> Void
    private let recognizer = SFSpeechRecognizer(locale: Locale.current) ?? SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    private var task: SFSpeechRecognitionTask?
    private var running = false
    private var generation = 0
    private var partial = ""
    private var commit: DispatchWorkItem?

    init(who: String, start: @escaping (Captions) async throws -> Void, stop: @escaping () -> Void) {
        self.who = who; startSource = start; stopSource = stop
    }

    func start() {
        guard !running else { return }
        SFSpeechRecognizer.requestAuthorization { auth in
            DispatchQueue.main.async {
                guard auth == .authorized else { return self.fail("Allow Speech Recognition for Cue in System Settings → Privacy & Security, then try again.") }
                Task { @MainActor in
                    do {
                        try await self.startSource(self)
                        log("captions on: \(self.who)")
                        self.running = true
                        self.begin()
                    } catch { self.fail(error.localizedDescription) }
                }
            }
        }
    }

    func stop() {
        guard running else { return }
        running = false
        stopSource()
        finishLine()
        log("captions off: \(who)")
    }

    private func begin() {
        guard running, let recognizer, recognizer.isAvailable else { return fail("Speech recognition isn't available right now.") }
        generation += 1
        let gen = generation
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        req.addsPunctuation = true
        if recognizer.supportsOnDeviceRecognition { req.requiresOnDeviceRecognition = true }
        request = req
        task = recognizer.recognitionTask(with: req) { [weak self] result, err in
            DispatchQueue.main.async {
                guard let self, gen == self.generation else { return } // ignore the task we just replaced
                if let result {
                    self.partial = result.bestTranscription.formattedString
                    self.emit(final: "", interim: self.partial)
                    self.commit?.cancel()
                    let work = DispatchWorkItem { [weak self] in self?.finishLine(); self?.begin() }
                    self.commit = work
                    DispatchQueue.main.asyncAfter(deadline: .now() + (result.isFinal ? 0 : 1.4), execute: work)
                } else if err != nil, self.running {
                    self.finishLine()
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self.begin() } // timed out or silence; keep listening
                }
            }
        }
    }

    private func finishLine() {
        commit?.cancel()
        generation += 1
        task?.cancel(); request?.endAudio()
        task = nil; request = nil
        let text = partial.trimmingCharacters(in: .whitespaces)
        partial = ""
        emit(final: text, interim: "")
    }

    private func emit(final: String, interim: String) { send?("window.__cue && window.__cue.caption(\(jsString(who)), \(jsString(final)), \(jsString(interim)))") }
    func fail(_ msg: String) {
        log("captions failed (\(who)): \(msg)")
        if running { running = false; stopSource(); finishLine() }
        send?("window.__cue && (window.__cue.stopped(\(jsString(who))), window.__cue.error(\(jsString(msg))))")
    }
}

/// A screenshot of the main display, leaving Cue's own panel out. JPEG data URL, ~1440 px wide.
enum Screen {
    static func capture() async throws -> String {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let display = content.displays.first(where: { $0.displayID == CGMainDisplayID() }) ?? content.displays.first else { throw CocoaError(.featureUnsupported) }
        let me = content.applications.filter { $0.processID == getpid() }
        let config = SCStreamConfiguration()
        config.width = 1440
        config.height = Int(1440 * Double(display.height) / Double(display.width))
        config.showsCursor = false
        let image = try await SCScreenshotManager.captureImage(contentFilter: SCContentFilter(display: display, excludingApplications: me, exceptingWindows: []), configuration: config)
        guard let jpeg = NSBitmapImageRep(cgImage: image).representation(using: .jpeg, properties: [.compressionFactor: 0.7]) else { throw CocoaError(.coderInvalidValue) }
        return "data:image/jpeg;base64," + jpeg.base64EncodedString()
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate {
    var panel: GlassPanel!
    var web: WKWebView!
    var statusItem: NSStatusItem!
    var children: [Process] = []
    let mic = Mic()
    let system = SystemAudio()
    lazy var captions: [String: Captions] = [
        "you": Captions(who: "you", start: { [mic] c in try await mic.start { c.request?.append($0) } }, stop: { [mic] in mic.stop() }),
        "them": Captions(who: "them", start: { [system] c in try await system.start { c.request?.appendAudioSampleBuffer($0) } }, stop: { [system] in system.stop() }),
    ]

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory) // menu bar only, no Dock icon
        buildPanel()
        buildMenuBar()
        for c in captions.values { c.send = { [weak self] js in self?.web.evaluateJavaScript(js) } }
        system.onStop = { [weak self] msg in self?.captions["them"]?.fail(msg) }
        HotKey.register { [weak self] in self?.toggle() }
        if !UserDefaults.standard.bool(forKey: "loginItemOffered") { // on by default once; the menu toggle is the user's choice after that
            UserDefaults.standard.set(true, forKey: "loginItemOffered")
            try? SMAppService.mainApp.register()
        }
        startBackendThenLoad()
        show()
    }

    func applicationWillTerminate(_ notification: Notification) {
        captions.values.forEach { $0.stop() }
        children.forEach { $0.terminate() }
    }

    // MARK: backend

    func spawn(_ path: String, _ args: [String], env: [String: String] = [:]) {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: path)
        p.arguments = args
        p.currentDirectoryURL = URL(fileURLWithPath: webRoot)
        p.environment = ProcessInfo.processInfo.environment.merging(env) { $1 }
        if !FileManager.default.fileExists(atPath: logURL.path) { FileManager.default.createFile(atPath: logURL.path, contents: nil) }
        if let log = try? FileHandle(forWritingTo: logURL) { log.seekToEndOfFile(); p.standardOutput = log; p.standardError = log }
        do { try p.run(); children.append(p) } catch { NSLog("Cue: couldn't start \(path): \(error)") }
    }

    func startBackendThenLoad() {
        let env = serverEnv()
        if env["AI_BASE_URL"]?.contains(":11434") == true, !portIsOpen(11434), let ollama = info["CueOllama"] as? String, FileManager.default.fileExists(atPath: ollama) {
            spawn(ollama, ["serve"])
        }
        if !portIsOpen(port) { spawn(info["CueNode"] as? String ?? "/opt/homebrew/bin/node", ["server/index.ts"], env: env) }
        DispatchQueue.global().async {
            for _ in 0..<60 where !portIsOpen(port) { usleep(250_000) }
            DispatchQueue.main.async { self.web.load(URLRequest(url: URL(string: "http://127.0.0.1:\(port)/")!)) }
        }
    }

    // MARK: window

    func buildPanel() {
        let size = NSSize(width: 440, height: 640)
        let area = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let frame = NSRect(x: area.maxX - size.width - 20, y: area.maxY - size.height - 20, width: size.width, height: size.height)
        panel = GlassPanel(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.backgroundColor = .clear
        panel.isOpaque = false
        panel.hasShadow = true
        panel.hidesOnDeactivate = false
        panel.minSize = NSSize(width: 360, height: 420)
        panel.setFrameAutosaveName("CuePanel") // remembers where you dragged it
        applySharing()

        let glass = NSGlassEffectView(frame: NSRect(origin: .zero, size: size))
        glass.cornerRadius = 28
        glass.style = .regular
        glass.autoresizingMask = [.width, .height]

        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "cue")
        web = WKWebView(frame: glass.bounds, configuration: config)
        web.setValue(false, forKey: "drawsBackground") // let the glass show through the page
        web.underPageBackgroundColor = .clear
        web.navigationDelegate = self
        web.autoresizingMask = [.width, .height]

        let container = NSView(frame: glass.bounds)
        container.autoresizingMask = [.width, .height]
        container.addSubview(web)
        let strip = DragStrip(frame: NSRect(x: 0, y: size.height - 16, width: size.width, height: 16))
        strip.autoresizingMask = [.width, .minYMargin]
        container.addSubview(strip)
        glass.contentView = container
        panel.contentView = glass
    }

    func show() {
        panel.orderFrontRegardless()
        panel.makeKey()
        panel.makeFirstResponder(web)
        panel.invalidateShadow()
        web.evaluateJavaScript("window.__cueFocus && window.__cueFocus()")
    }
    func hide() { panel.orderOut(nil) }
    @objc func toggle() { panel.isVisible && panel.isKeyWindow ? hide() : show() }
    @objc func reload() { web.reload() }
    /// Opt-in: ask screen sharing and recording apps to leave the panel out. Each capture app decides whether it honors this.
    var hideFromCapture: Bool {
        get { UserDefaults.standard.bool(forKey: "hideFromCapture") }
        set { UserDefaults.standard.set(newValue, forKey: "hideFromCapture"); applySharing() }
    }
    func applySharing() { panel.sharingType = hideFromCapture ? .none : .readOnly }
    @objc func toggleHide(_ item: NSMenuItem) {
        hideFromCapture.toggle()
        item.state = hideFromCapture ? .on : .off
        log("hide from screen sharing: \(hideFromCapture)")
    }

    @objc func toggleLogin(_ item: NSMenuItem) {
        let service = SMAppService.mainApp
        do { if service.status == .enabled { try service.unregister() } else { try service.register() } } catch { NSLog("Cue: login item: \(error)") }
        item.state = service.status == .enabled ? .on : .off
    }

    func buildMenuBar() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem.button?.image = NSImage(systemSymbolName: "sparkles", accessibilityDescription: "Cue")
        let menu = NSMenu()
        let showItem = NSMenuItem(title: "Show / Hide Cue", action: #selector(toggle), keyEquivalent: "\\")
        showItem.keyEquivalentModifierMask = .command
        menu.addItem(showItem)
        menu.addItem(NSMenuItem(title: "Reload", action: #selector(reload), keyEquivalent: "r"))
        let hide = NSMenuItem(title: "Hide from Screen Sharing", action: #selector(toggleHide(_:)), keyEquivalent: "")
        hide.state = hideFromCapture ? .on : .off
        menu.addItem(hide)
        let login = NSMenuItem(title: "Open at Login", action: #selector(toggleLogin(_:)), keyEquivalent: "")
        login.state = SMAppService.mainApp.status == .enabled ? .on : .off
        menu.addItem(login)
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Quit Cue", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        menu.items.forEach { if $0.action != #selector(NSApplication.terminate(_:)) { $0.target = self } }
        statusItem.menu = menu
    }

    // MARK: page ↔ native

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "hide": hide()
        case "listen":
            guard let c = captions[body["source"] as? String ?? "you"] else { return }
            (body["on"] as? Bool ?? false) ? c.start() : c.stop()
        case "frame":
            let id = (body["id"] as? NSNumber)?.intValue ?? 0
            Task { @MainActor in
                do {
                    let url = try await Screen.capture()
                    _ = try? await self.web.evaluateJavaScript("window.__cue.frame(\(id), \(jsString(url)))")
                } catch {
                    _ = try? await self.web.evaluateJavaScript("window.__cue.frame(\(id), ''); window.__cue.error(\(jsString("Cue can't see your screen yet. Allow Screen Recording for Cue in System Settings → Privacy & Security, then reopen Cue.")))")
                }
            }
        default: break
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { showError(error) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { showError(error) }
    func showError(_ error: Error) {
        web.loadHTMLString("""
        <body style="font:14px -apple-system;color:#888;padding:40px 24px;text-align:center;background:transparent">
        <p>Cue's server didn't start.</p><p style="font-size:12px">Check ~/Library/Logs/Cue.log, then choose Reload from the ✨ menu.</p></body>
        """, baseURL: nil)
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
