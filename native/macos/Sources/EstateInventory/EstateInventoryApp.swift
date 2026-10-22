import AppKit
import WebKit

@main
struct EstateInventoryApp {
    @MainActor static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.setActivationPolicy(.regular)
        app.delegate = delegate
        withExtendedLifetime(delegate) { app.run() }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private let status = NSTextField(labelWithString: "Opening your inventory…")
    private var downloads: [ObjectIdentifier: URL] = [:]
    private var downloadNames: [ObjectIdentifier: String] = [:]
    private var verificationFinished = false
    private var verifyDirectory: URL? {
        let args = ProcessInfo.processInfo.arguments
        guard let index = args.firstIndex(of: "--verify-output"), index + 1 < args.count else { return nil }
        return URL(fileURLWithPath: args[index + 1], isDirectory: true)
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.limitsNavigationsToAppBoundDomains = true
        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1200, height: 850), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Estate Inventory"
        window.minSize = NSSize(width: 620, height: 600)
        let home = NSButton(title: "Home", target: self, action: #selector(goHome))
        let back = NSButton(title: "Back", target: self, action: #selector(goBack))
        let reload = NSButton(title: "Reload", target: self, action: #selector(reloadPage))
        reload.keyEquivalent = "r"
        let browser = NSButton(title: "Open in browser", target: self, action: #selector(openBrowser))
        status.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        let toolbar = NSStackView(views: [back, home, reload, status, browser])
        toolbar.spacing = 12
        toolbar.edgeInsets = NSEdgeInsets(top: 8, left: 12, bottom: 8, right: 12)
        let content = NSView()
        let views: [NSView] = [toolbar, webView]
        for view in views { view.translatesAutoresizingMaskIntoConstraints = false; content.addSubview(view) }
        NSLayoutConstraint.activate([
            toolbar.leadingAnchor.constraint(equalTo: content.leadingAnchor), toolbar.trailingAnchor.constraint(equalTo: content.trailingAnchor), toolbar.topAnchor.constraint(equalTo: content.topAnchor),
            webView.leadingAnchor.constraint(equalTo: content.leadingAnchor), webView.trailingAnchor.constraint(equalTo: content.trailingAnchor), webView.topAnchor.constraint(equalTo: toolbar.bottomAnchor), webView.bottomAnchor.constraint(equalTo: content.bottomAnchor)
        ])
        window.contentView = content
        let menu = NSMenu()
        let appItem = NSMenuItem(); let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About Estate Inventory", action: #selector(showAbout), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit Estate Inventory", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu; menu.addItem(appItem)
        let editItem = NSMenuItem(); let editMenu = NSMenu(title: "Edit")
        for (title, action, key) in [("Undo", "undo:", "z"), ("Cut", "cut:", "x"), ("Copy", "copy:", "c"), ("Paste", "paste:", "v"), ("Select all", "selectAll:", "a")] {
            editMenu.addItem(withTitle: title, action: Selector(action), keyEquivalent: key)
        }
        editItem.submenu = editMenu; menu.addItem(editItem); NSApp.mainMenu = menu
        window.center(); window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
        goHome()
        if verifyDirectory != nil {
            DispatchQueue.main.asyncAfter(deadline: .now() + 60) { [weak self] in self?.finishVerification(error: "Timed out opening the inventory.") }
        }
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    @objc private func goHome() { webView.load(URLRequest(url: NavigationPolicy.home)) }
    @objc private func goBack() { if webView.canGoBack { webView.goBack() } }
    @objc private func reloadPage() { webView.reload() }
    @objc private func openBrowser() {
        let alert = NSAlert()
        alert.messageText = "Open your inventory in the browser?"
        alert.informativeText = "The browser has its own sign-in and local storage. Let pending changes sync before switching."
        alert.addButton(withTitle: "Open browser"); alert.addButton(withTitle: "Cancel")
        if alert.runModal() == .alertFirstButtonReturn { NSWorkspace.shared.open(webView.url.flatMap { NavigationPolicy.isAppURL($0) ? $0 : nil } ?? NavigationPolicy.home) }
    }
    @objc private func showAbout() {
        let info = Bundle.main.infoDictionary ?? [:]
        let alert = NSAlert(); alert.messageText = "Estate Inventory"
        alert.informativeText = "Mac app \(info["CFBundleShortVersionString"] as? String ?? "development")\n\(info["EstateReleaseID"] as? String ?? "Development build")\n\nThe inventory updates from the live website. Its version appears in Family and settings. First launch needs internet. This app keeps its own sign-in and local inventory."
        alert.runModal()
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if NavigationPolicy.isAppURL(url) || (NavigationPolicy.isDownload(url) && webView.url.map(NavigationPolicy.isAppURL) == true) {
            if navigationAction.shouldPerformDownload { decisionHandler(.download) }
            else if navigationAction.targetFrame == nil { webView.load(navigationAction.request); decisionHandler(.cancel) }
            else { decisionHandler(.allow) }
        } else {
            if navigationAction.navigationType == .linkActivated && ["https", "mailto"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
            decisionHandler(.cancel)
        }
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
    }
    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { status.stringValue = "Opening your inventory…" }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        status.stringValue = "Your inventory"
        guard verifyDirectory != nil else { return }
        webView.evaluateJavaScript("document.title + '\\n' + document.body.innerText") { [weak self] result, error in
            guard let self else { return }
            if error != nil || !(result as? String ?? "").contains("Estate Inventory") { self.finishVerification(error: "Inventory content was missing."); return }
            self.webView.takeSnapshot(with: nil) { image, error in
                guard let image, let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff), let png = bitmap.representation(using: .png, properties: [:]), let directory = self.verifyDirectory else { self.finishVerification(error: "Could not capture the app window."); return }
                do { try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true); try png.write(to: directory.appendingPathComponent("macos.png")); self.finishVerification(error: error?.localizedDescription) }
                catch { self.finishVerification(error: "Could not write verification image.") }
            }
        }
    }
    private func finishVerification(error: String?) {
        guard !verificationFinished, let directory = verifyDirectory else { return }
        verificationFinished = true
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let result: [String: Any] = ["ok": error == nil, "message": error ?? "Inventory rendered in the native web view."]
        if let data = try? JSONSerialization.data(withJSONObject: result, options: .prettyPrinted) { try? data.write(to: directory.appendingPathComponent("verification.json")) }
        NSApp.terminate(nil)
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code == NSURLErrorCancelled { return }
        status.stringValue = "Could not open inventory. Check your connection, then Reload."
        finishVerification(error: "Could not open inventory.")
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { status.stringValue = "Could not open inventory. Try Reload."; finishVerification(error: "Navigation failed.") }
    private func trusted(_ frame: WKFrameInfo) -> Bool { frame.securityOrigin.protocol == "https" && frame.securityOrigin.host == NavigationPolicy.home.host && frame.isMainFrame }
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        guard trusted(frame) else { completionHandler(nil); return }
        let panel = NSOpenPanel(); panel.allowsMultipleSelection = parameters.allowsMultipleSelection; panel.canChooseDirectories = false
        panel.beginSheetModal(for: window) { response in completionHandler(response == .OK ? panel.urls : nil) }
    }
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) { decisionHandler(trusted(frame) && origin.host == NavigationPolicy.home.host ? .prompt : .deny) }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        guard trusted(frame) else { completionHandler(); return }
        let alert = NSAlert(); alert.messageText = message; alert.beginSheetModal(for: window) { _ in completionHandler() }
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        guard trusted(frame) else { completionHandler(false); return }
        let alert = NSAlert(); alert.messageText = message; alert.addButton(withTitle: "Continue"); alert.addButton(withTitle: "Cancel")
        alert.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn) }
    }
    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        guard trusted(frame) else { completionHandler(nil); return }
        let field = NSTextField(string: defaultText ?? ""); field.frame = NSRect(x: 0, y: 0, width: 350, height: 28)
        let alert = NSAlert(); alert.messageText = prompt; alert.accessoryView = field; alert.addButton(withTitle: "Save"); alert.addButton(withTitle: "Cancel")
        alert.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn ? field.stringValue : nil) }
    }
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let key = ObjectIdentifier(download)
        let path = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        downloads[key] = path; downloadNames[key] = URL(fileURLWithPath: suggestedFilename).lastPathComponent; completionHandler(path)
    }
    func downloadDidFinish(_ download: WKDownload) {
        let key = ObjectIdentifier(download)
        guard let path = downloads.removeValue(forKey: key) else { return }
        let panel = NSSavePanel(); panel.nameFieldStringValue = downloadNames.removeValue(forKey: key) ?? "Inventory export"
        panel.beginSheetModal(for: window) { [weak self] response in
            defer { try? FileManager.default.removeItem(at: path) }
            guard response == .OK, let destination = panel.url else { return }
            do {
                if FileManager.default.fileExists(atPath: destination.path) { _ = try FileManager.default.replaceItemAt(destination, withItemAt: path) }
                else { try FileManager.default.moveItem(at: path, to: destination) }
                self?.status.stringValue = "File saved."
            } catch { self?.status.stringValue = "File could not be saved. Export it again to retry." }
        }
    }
    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        let key = ObjectIdentifier(download)
        if let path = downloads.removeValue(forKey: key) { try? FileManager.default.removeItem(at: path) }
        downloadNames.removeValue(forKey: key); status.stringValue = "Download failed. Export it again to retry."
    }
}
