import AppKit

// Local, disposable visual fixture. No persistence, network, clipboard or automation.
final class LocalTextView: NSTextView {
    override func copy(_ sender: Any?) {}
    override func cut(_ sender: Any?) {}
    override func paste(_ sender: Any?) {}
    override func pasteAsPlainText(_ sender: Any?) {}
    override func pasteAsRichText(_ sender: Any?) {}
    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool { false }
}
final class MousePad: NSView {
    var clicks = 0, doubles = 0, rights = 0, hovering = false
    override var isFlipped: Bool { true }
    override func updateTrackingAreas() {
        for area in trackingAreas { removeTrackingArea(area) }
        addTrackingArea(NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self))
        super.updateTrackingAreas()
    }
    override func mouseEntered(with event: NSEvent) { hovering = true; needsDisplay = true }
    override func mouseExited(with event: NSEvent) { hovering = false; needsDisplay = true }
    override func mouseDown(with event: NSEvent) {
        if event.clickCount == 2 { doubles += 1 } else { clicks += 1 }
        needsDisplay = true
    }
    override func rightMouseDown(with event: NSEvent) { rights += 1; needsDisplay = true }
    override func draw(_ dirtyRect: NSRect) {
        (hovering ? NSColor.systemGreen : NSColor.systemBlue).withAlphaComponent(0.25).setFill()
        bounds.fill()
        let text = "MOUSE PAD — hover: \(hovering ? "ON" : "OFF")\nLeft: \(clicks)   Double: \(doubles)   Right: \(rights)"
        (text as NSString).draw(in: bounds.insetBy(dx: 18, dy: 20), withAttributes: [.font: NSFont.systemFont(ofSize: 25), .foregroundColor: NSColor.labelColor])
    }
}
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    var window: NSWindow!
    let dragLabel = NSTextField(labelWithString: "Drag slider: 0")
    @objc func sliderChanged(_ sender: NSSlider) { dragLabel.stringValue = "Drag slider: \(sender.integerValue)" }
    func applicationDidFinishLaunching(_ notification: Notification) {
        let visible = NSScreen.screens.first!.visibleFrame
        let width = min(760, visible.width - 40), height = min(650, visible.height - 40)
        window = NSWindow(contentRect: NSRect(x: visible.midX - width / 2, y: visible.midY - height / 2, width: width, height: height),
                          styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "Pi Desktop Scratch — close window to quit"
        window.delegate = self
        let stack = NSStackView()
        stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        let root = window.contentView!
        root.addSubview(stack)
        NSLayoutConstraint.activate([stack.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -20),
            stack.topAnchor.constraint(equalTo: root.topAnchor, constant: 20),
            stack.bottomAnchor.constraint(equalTo: root.bottomAnchor, constant: -20)])
        let title = NSTextField(labelWithString: "Disposable test only • no save / clipboard / network")
        title.font = .systemFont(ofSize: 18)
        stack.addArrangedSubview(title)
        let pad = MousePad()
        stack.addArrangedSubview(pad)
        pad.heightAnchor.constraint(equalToConstant: 110).isActive = true
        pad.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
        stack.addArrangedSubview(NSTextField(labelWithString: "Type Korean / emoji below (double-click also includes first Left down):"))
        let textScroll = NSScrollView()
        textScroll.borderType = .bezelBorder; textScroll.hasVerticalScroller = true
        let text = LocalTextView(frame: NSRect(x: 0, y: 0, width: width - 40, height: 85))
        text.isRichText = false; text.allowsUndo = false; text.font = .systemFont(ofSize: 24)
        text.isAutomaticLinkDetectionEnabled = false; text.isAutomaticTextReplacementEnabled = false
        text.unregisterDraggedTypes()
        textScroll.documentView = text
        stack.addArrangedSubview(textScroll)
        textScroll.heightAnchor.constraint(equalToConstant: 90).isActive = true
        textScroll.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
        dragLabel.font = .monospacedDigitSystemFont(ofSize: 24, weight: .medium)
        stack.addArrangedSubview(dragLabel)
        let slider = NSSlider(value: 0, minValue: 0, maxValue: 100, target: self, action: #selector(sliderChanged(_:)))
        slider.isContinuous = true
        stack.addArrangedSubview(slider)
        slider.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
        let scroll = NSScrollView()
        scroll.hasVerticalScroller = true; scroll.hasHorizontalScroller = true; scroll.borderType = .bezelBorder
        let rows = NSTextField(labelWithString: (1...40).map { "Row \($0) — scroll here                              right edge marker \($0)" }.joined(separator: "\n"))
        rows.font = .monospacedSystemFont(ofSize: 22, weight: .regular)
        rows.frame = NSRect(x: 0, y: 0, width: 1100, height: 1200)
        scroll.documentView = rows
        stack.addArrangedSubview(scroll)
        scroll.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
        scroll.heightAnchor.constraint(greaterThanOrEqualToConstant: 60).isActive = true
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}
let app = NSApplication.shared
let delegate = AppDelegate()
app.setActivationPolicy(.regular)
app.delegate = delegate
let menu = NSMenu()
let item = NSMenuItem()
menu.addItem(item)
item.submenu = NSMenu(title: "Scratch")
item.submenu?.addItem(withTitle: "Quit Scratch", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
app.mainMenu = menu
app.run()
