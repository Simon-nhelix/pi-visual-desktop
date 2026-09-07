import Foundation
import AppKit
import ScreenCaptureKit
import CoreGraphics
import Carbon
import Darwin

// The signal handler only sets a flag. Normal control flow releases held input.
private var interrupted: Int32 = 0
private let ttl: Double = 120_000
private let maxEdge = 1280
private struct Failure: Error { let message: String }
private func require(_ condition: Bool, _ message: String) throws {
    if !condition { throw Failure(message: message) }
}
private func checkCancellation() throws { try require(interrupted == 0, "Operation cancelled.") }
private func pause(_ milliseconds: Int) throws {
    for _ in 0..<milliseconds { try checkCancellation(); usleep(1000) }
}
private func number(_ object: [String: Any], _ key: String, _ min: Double, _ max: Double) throws -> Double {
    guard let n = object[key] as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else {
        throw Failure(message: "Invalid numeric action field.")
    }
    let value = n.doubleValue
    try require(value.isFinite && value.rounded() == value && value >= min && value <= max, "Action value outside range.")
    return value
}
private struct Geometry: Codable, Equatable {
    let displayID: UInt32
    let x: Double, y: Double, width: Double, height: Double
    let pixelWidth: Int, pixelHeight: Int
    let rotation: Double
    let pid: Int32
    let bundle: String
    let launched: Double
}
// ScreenCaptureKit sourceRect: display-local logical points, never global Quartz origin.
private struct CaptureView: Codable, Equatable {
    let x: Double, y: Double, width: Double, height: Double
    static func full(_ g: Geometry) -> CaptureView { CaptureView(x: 0, y: 0, width: g.width, height: g.height) }
}
private struct Frame: Codable {
    let ref: String
    let capturedAt: Double
    let width: Int, height: Int
    let geometry: Geometry
    let view: CaptureView
    let png: String
}
private struct Snapshot {
    let ref: String, capturedAt: Double, width: Int, height: Int, geometry: Geometry
    let view: CaptureView
}
private struct Health: Codable {
    let screenRecording: Bool, accessibility: Bool, secureInput: Bool
}
private struct Reply: Codable {
    var ok: Bool
    var capabilities: [String] = ["settleMs"]
    var error: String? = nil
    var outcome: String? = nil
    var health: Health? = nil
    var frame: Frame? = nil
}
private func health() -> Health {
    Health(screenRecording: CGPreflightScreenCaptureAccess(), accessibility: AXIsProcessTrusted(), secureInput: IsSecureEventInputEnabled())
}
@MainActor private func geometry() throws -> Geometry {
    let id = CGMainDisplayID(), bounds = CGDisplayBounds(CGMainDisplayID())
    guard let mode = CGDisplayCopyDisplayMode(id), let app = NSWorkspace.shared.frontmostApplication,
          let launched = app.launchDate else { throw Failure(message: "Main display or foreground identity unavailable.") }
    try require(bounds.width > 0 && bounds.height > 0 && !app.isTerminated, "Desktop geometry unavailable.")
    return Geometry(displayID: id, x: bounds.minX, y: bounds.minY, width: bounds.width, height: bounds.height,
                    pixelWidth: mode.pixelWidth, pixelHeight: mode.pixelHeight, rotation: CGDisplayRotation(id),
                    pid: app.processIdentifier, bundle: app.bundleIdentifier ?? "", launched: launched.timeIntervalSince1970)
}
private func imageSize(_ g: Geometry, _ view: CaptureView? = nil) -> (Int, Int) {
    let v = view ?? .full(g)
    // Native mode axes may be unrotated; Quartz bounds define displayed orientation.
    let nativeScale = min(Double(max(g.pixelWidth, g.pixelHeight)) / max(g.width, g.height),
                          Double(min(g.pixelWidth, g.pixelHeight)) / min(g.width, g.height))
    let scale = min(nativeScale, Double(maxEdge) / max(v.width, v.height))
    return (Int((v.width * scale).rounded(.down)), Int((v.height * scale).rounded(.down)))
}
private func captureConfiguration(_ g: Geometry, _ view: CaptureView? = nil) -> SCStreamConfiguration {
    let v = view ?? .full(g)
    let (width, height) = imageSize(g, v)
    let config = SCStreamConfiguration()
    config.width = width; config.height = height
    // SCStream.h sourceRect is in points in the display's logical coordinate system.
    config.sourceRect = CGRect(x: v.x, y: v.y, width: v.width, height: v.height)
    // Match point()'s independent-axis scaling after integer dimension rounding.
    config.preservesAspectRatio = false
    config.showsCursor = true
    return config
}
private func point(_ x: Double, _ y: Double, _ s: Snapshot) -> CGPoint {
    CGPoint(x: s.geometry.x + s.view.x + (x + 0.5) * s.view.width / Double(s.width),
            y: s.geometry.y + s.view.y + (y + 0.5) * s.view.height / Double(s.height))
}
private func zoomView(_ z: [String: Any], _ s: Snapshot) throws -> CaptureView {
    try require(Set(z.keys) == ["ref", "x", "y", "width", "height"] && z["ref"] as? String == s.ref,
                "Invalid zoom fields or foreign screenshot ref.")
    let x = try number(z, "x", 0, Double(s.width - 1)), y = try number(z, "y", 0, Double(s.height - 1))
    let width = try number(z, "width", 1, Double(s.width)), height = try number(z, "height", 1, Double(s.height))
    try require(x + width <= Double(s.width) && y + height <= Double(s.height), "Zoom region outside screenshot.")
    // Pixel-edge selection; repeated zoom is the same affine composition, not PNG resampling.
    let v = CaptureView(x: s.view.x + x * s.view.width / Double(s.width),
                        y: s.view.y + y * s.view.height / Double(s.height),
                        width: width * s.view.width / Double(s.width), height: height * s.view.height / Double(s.height))
    let (w, h) = imageSize(s.geometry, v)
    try require(w >= 1 && h >= 1, "Zoom region smaller than a native pixel.")
    return v
}

// A bounded, testable event plan. No input is posted while validating/building a plan.
private struct InputEvent {
    var kind: String
    var sequence: Int = 0
    var point: CGPoint = .zero
    var key: UInt16 = 0
    var flags: UInt64 = 0
    var unicode: [UniChar] = []
    var count: Int64 = 1
    var dx: Int32 = 0
    var dy: Int32 = 0
    var delay: Int = 0
    var release: InputEvent? { // Computed, not stored recursively.
        guard kind.hasSuffix("Down") else { return nil }
        var up = self
        up.kind = String(kind.dropLast(4)) + "Up"
        up.flags = 0
        up.delay = 0
        return up
    }
    var emergencyRelease: InputEvent? {
        if kind == "drag" { var up = self; up.kind = "leftUp"; up.delay = 0; return up }
        return release
    }
    func matches(_ up: InputEvent) -> Bool {
        release?.kind == up.kind && key == up.key
    }
}
private func plan(_ a: [String: Any], _ s: Snapshot) throws -> [InputEvent] {
    try buildPlan(a, s).enumerated().map { index, event in var result = event; result.sequence = index; return result }
}
// Physical ANSI key names; literal characters belong to the Unicode type primitive.
private let keyCodes: [String: UInt16] = [
    "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9,
    "b": 11, "q": 12, "w": 13, "e": 14, "r": 15, "y": 16, "t": 17,
    "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23, "equal": 24, "9": 25, "7": 26,
    "minus": 27, "8": 28, "0": 29, "right_bracket": 30, "o": 31, "u": 32, "left_bracket": 33,
    "i": 34, "p": 35, "return": 36, "l": 37, "j": 38, "quote": 39, "k": 40, "semicolon": 41,
    "backslash": 42, "comma": 43, "slash": 44, "n": 45, "m": 46, "period": 47, "tab": 48,
    "space": 49, "grave": 50, "backspace": 51, "escape": 53,
    "f1": 122, "f2": 120, "f3": 99, "f4": 118, "f5": 96, "f6": 97,
    "f7": 98, "f8": 100, "f9": 101, "f10": 109, "f11": 103, "f12": 111,
    "home": 115, "end": 119, "page_up": 116, "page_down": 121, "delete": 117,
    "left": 123, "right": 124, "down": 125, "up": 126
]
private func settleMilliseconds(_ a: [String: Any]) throws -> Int {
    a.keys.contains("settleMs") ? Int(try number(a, "settleMs", 0, 2000)) : 250
}
private func buildPlan(_ a: [String: Any], _ s: Snapshot) throws -> [InputEvent] {
    guard let action = a["action"] as? String, let ref = a["ref"] as? String else { throw Failure(message: "Missing action or ref.") }
    let fields: [String: Set<String>] = [
        "move": ["x", "y"], "click": ["x", "y"], "double_click": ["x", "y"], "right_click": ["x", "y"],
        "drag": ["x", "y", "toX", "toY"], "scroll": ["x", "y", "dx", "dy"],
        "type": ["text"], "key": ["key", "modifiers"]
    ]
    guard let required = fields[action] else { throw Failure(message: "Unknown action.") }
    let mandatory = required.union(["op", "action", "ref"])
    try require(mandatory.isSubset(of: Set(a.keys)) && Set(a.keys).isSubset(of: mandatory.union(["settleMs"])) && ref == s.ref,
                "Invalid fields or screenshot ref.")
    _ = try settleMilliseconds(a) // Validate before event construction and any input.
    var p = CGPoint.zero
    if required.contains("x") {
        p = point(try number(a, "x", 0, Double(s.width - 1)), try number(a, "y", 0, Double(s.height - 1)), s)
    }
    switch action {
    case "move":
        return [InputEvent(kind: "move", point: p, count: 0)]
    case "click", "double_click", "right_click":
        let button = action == "right_click" ? "right" : "left"
        var events: [InputEvent] = []
        for count in 1...(action == "double_click" ? 2 : 1) {
            events.append(InputEvent(kind: button + "Down", point: p, count: Int64(count)))
            events.append(InputEvent(kind: button + "Up", point: p, count: Int64(count), delay: 35))
        }
        return events
    case "drag":
        let end = point(try number(a, "toX", 0, Double(s.width - 1)), try number(a, "toY", 0, Double(s.height - 1)), s)
        var events = [InputEvent(kind: "leftDown", point: p)]
        for i in 1...20 {
            let t = Double(i) / 20
            events.append(InputEvent(kind: "drag", point: CGPoint(x: p.x + (end.x - p.x) * t, y: p.y + (end.y - p.y) * t), delay: 15))
        }
        events.append(InputEvent(kind: "leftUp", point: end))
        return events
    case "scroll":
        let dx = Int32(try number(a, "dx", -1000, 1000)), dy = Int32(try number(a, "dy", -1000, 1000))
        try require(dx != 0 || dy != 0, "Empty scroll rejected.")
        return [InputEvent(kind: "move", point: p), InputEvent(kind: "scroll", point: p, dx: -dx, dy: -dy)]
    case "type":
        guard let text = a["text"] as? String else { throw Failure(message: "Invalid literal text.") }
        try require(!text.isEmpty && text.utf16.count <= 2048, "Text must contain 1..2048 UTF-16 units.")
        return text.unicodeScalars.flatMap { scalar in
            let units = Array(String(scalar).utf16)
            return [InputEvent(kind: "keyDown", unicode: units), InputEvent(kind: "keyUp", unicode: units, delay: 1)]
        }
    case "key":
        guard let name = a["key"] as? String, let key = keyCodes[name] else { throw Failure(message: "Unknown physical key name.") }
        guard let mods = a["modifiers"] as? [String] else { throw Failure(message: "Explicit modifiers array required.") }
        let map: [String: (UInt16, CGEventFlags)] = ["command": (55, .maskCommand), "shift": (56, .maskShift), "option": (58, .maskAlternate), "control": (59, .maskControl)]
        try require(mods.count <= 4 && Set(mods).count == mods.count && mods.allSatisfy { map[$0] != nil }, "Invalid modifiers.")
        var events: [InputEvent] = [], flags: UInt64 = 0
        for mod in mods { let (code, flag) = map[mod]!; flags |= flag.rawValue; events.append(InputEvent(kind: "keyDown", key: code, flags: flags)) }
        events += [InputEvent(kind: "keyDown", key: key, flags: flags), InputEvent(kind: "keyUp", key: key, flags: flags)]
        for mod in mods.reversed() { let (code, flag) = map[mod]!; flags &= ~flag.rawValue; events.append(InputEvent(kind: "keyUp", key: code, flags: flags)) }
        return events
    default: throw Failure(message: "Unknown action.")
    }
}
private func runInput(_ events: [InputEvent], cancelled: () -> Bool, wait: (Int) throws -> Void,
                      emit: (InputEvent, Bool) throws -> Void) throws {
    var held: [InputEvent] = []
    defer { for event in held.reversed() { if let up = event.release { try? emit(up, true) } } }
    for event in events {
        try require(!cancelled(), "Operation cancelled.")
        try wait(event.delay)
        try require(!cancelled(), "Operation cancelled.")
        if event.release != nil { held.append(event) }
        if event.kind == "drag", let i = held.lastIndex(where: { $0.kind == "leftDown" }) {
            held[i].point = event.point; held[i].sequence = event.sequence
        }
        try emit(event, false)
        if let index = held.lastIndex(where: { $0.matches(event) }) { held.remove(at: index) }
    }
}
private func cgEvent(_ spec: InputEvent, source: CGEventSource) throws -> CGEvent {
    var event: CGEvent?
    switch spec.kind {
    case "leftDown", "leftUp", "rightDown", "rightUp", "move", "drag":
        let types: [String: CGEventType] = ["leftDown": .leftMouseDown, "leftUp": .leftMouseUp,
            "rightDown": .rightMouseDown, "rightUp": .rightMouseUp, "move": .mouseMoved, "drag": .leftMouseDragged]
        event = CGEvent(mouseEventSource: source, mouseType: types[spec.kind]!, mouseCursorPosition: spec.point,
                        mouseButton: spec.kind.hasPrefix("right") ? .right : .left)
        event?.setIntegerValueField(.mouseEventClickState, value: spec.count)
    case "scroll":
        event = CGEvent(scrollWheelEvent2Source: source, units: .pixel, wheelCount: 2, wheel1: spec.dy, wheel2: spec.dx, wheel3: 0)
        event?.location = spec.point
    case "keyDown", "keyUp":
        event = CGEvent(keyboardEventSource: source, virtualKey: spec.key, keyDown: spec.kind == "keyDown")
        if !spec.unicode.isEmpty {
            spec.unicode.withUnsafeBufferPointer { event?.keyboardSetUnicodeString(stringLength: $0.count, unicodeString: $0.baseAddress!) }
        }
    default: break
    }
    guard let result = event else { throw Failure(message: "Unable to allocate native input event.") }
    result.flags = CGEventFlags(rawValue: spec.flags)
    return result
}
private func validateSnapshot(_ s: Snapshot, current: Geometry, now: Double) throws {
    let age = now - s.capturedAt
    try require(age >= 0 && age < ttl, "Screenshot ref expired. Observe again.")
    try require(current == s.geometry, "Main display geometry or foreground application changed. Observe again.")
}
@MainActor private func preflight(_ s: Snapshot) throws {
    try checkCancellation()
    let h = health()
    try require(h.screenRecording && h.accessibility, "Permission missing: System Settings > Privacy & Security > Screen Recording and Accessibility. Restart Pi after manual setup.")
    try require(!h.secureInput, "Secure Input is active; disable it manually before desktop control.")
    try validateSnapshot(s, current: geometry(), now: Date().timeIntervalSince1970 * 1000)
    let flags = CGEventSource.flagsState(.combinedSessionState)
    try require(flags.intersection([.maskCommand, .maskShift, .maskAlternate, .maskControl, .maskSecondaryFn]).isEmpty,
                "Physical modifier held; release input and observe again.")
    for key in 0...127 { try require(!CGEventSource.keyState(.combinedSessionState, key: CGKeyCode(key)), "Physical key held; release input and observe again.") }
    for button in [CGMouseButton.left, .right, .center] {
        try require(!CGEventSource.buttonState(.combinedSessionState, button: button), "Physical mouse button held; release input and observe again.")
    }
}

@MainActor private final class Desktop {
    var snapshot: Snapshot?
    func capture(source: Snapshot? = nil, view: CaptureView? = nil) async throws -> Frame {
        snapshot = nil
        try checkCancellation()
        try require(CGPreflightScreenCaptureAccess(), "Screen Recording permission missing. Enable it manually in System Settings > Privacy & Security, then restart Pi.")
        let before = try geometry(), capturedAt = Date().timeIntervalSince1970 * 1000
        if let source { try validateSnapshot(source, current: before, now: capturedAt) }
        let v = view ?? .full(before)
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let display = content.displays.first(where: { $0.displayID == before.displayID }) else { throw Failure(message: "Main display unavailable to ScreenCaptureKit.") }
        let config = captureConfiguration(before, v)
        let width = config.width, height = config.height
        let filter = SCContentFilter(display: display, excludingWindows: [])
        if let source { try validateSnapshot(source, current: geometry(), now: Date().timeIntervalSince1970 * 1000) }
        let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
        try checkCancellation()
        try require(try geometry() == before, "Display or foreground changed during capture. Observe again.")
        if let source { try validateSnapshot(source, current: before, now: Date().timeIntervalSince1970 * 1000) }
        try require(image.width == width && image.height == height, "Capture dimensions differ from configured image; refusing coordinates.")
        guard let data = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else { throw Failure(message: "PNG encoding failed.") }
        if let source { try validateSnapshot(source, current: geometry(), now: Date().timeIntervalSince1970 * 1000) }
        let frame = Frame(ref: UUID().uuidString, capturedAt: capturedAt, width: width, height: height, geometry: before, view: v, png: data.base64EncodedString())
        snapshot = Snapshot(ref: frame.ref, capturedAt: capturedAt, width: width, height: height, geometry: before, view: v)
        return frame
    }
    func handle(_ request: [String: Any]) async -> Reply {
        var attempted = false
        do {
            guard let op = request["op"] as? String else { throw Failure(message: "Missing operation.") }
            switch op {
            case "health":
                try require(Set(request.keys) == ["op"], "Invalid health fields.")
                return Reply(ok: true, health: health())
            case "observe":
                try require(Set(request.keys).isSubset(of: ["op", "zoom"]), "Invalid observe fields.")
                if request.keys.contains("zoom") {
                    guard let z = request["zoom"] as? [String: Any], let source = snapshot else {
                        throw Failure(message: "No fresh screenshot ref or invalid zoom selection.")
                    }
                    snapshot = nil
                    try validateSnapshot(source, current: geometry(), now: Date().timeIntervalSince1970 * 1000)
                    let view = try zoomView(z, source)
                    return Reply(ok: true, frame: try await capture(source: source, view: view))
                }
                return Reply(ok: true, frame: try await capture())
            case "act":
                guard let s = snapshot else { throw Failure(message: "No fresh screenshot ref. Observe first.") }
                snapshot = nil
                let events = try plan(request, s)
                guard let source = CGEventSource(stateID: .privateState) else { throw Failure(message: "Unable to create input source.") }
                // Preallocate normal and emergency-release events before mutation.
                let prepared = try events.map { try cgEvent($0, source: source) }
                let releases = try events.map { try $0.emergencyRelease.map { try cgEvent($0, source: source) } }
                try preflight(s) // Last check immediately before the first mutation.
                attempted = true
                try runInput(events, cancelled: { interrupted != 0 }, wait: pause) { spec, cleanup in
                    // Sequence identity preserves the exact Unicode/key/button being released.
                    let event = cleanup ? releases[spec.sequence]! : prepared[spec.sequence]
                    event.post(tap: .cghidEventTap)
                }
                try await settle(settleMilliseconds(request))
                return Reply(ok: true, outcome: "dispatched_not_verified", frame: try await capture())
            default: throw Failure(message: "Unknown operation.")
            }
        } catch {
            snapshot = nil
            // Framework errors may contain sensitive information; never serialize them.
            let message = (error as? Failure)?.message ?? "Native capture/input failed. Check local permissions; no automatic retry."
            return Reply(ok: false, error: message, outcome: attempted ? "unknown" : "not_dispatched")
        }
    }
}

private func send(_ reply: Reply) {
    guard let data = try? JSONEncoder().encode(reply) else { return }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([10]))
}
private func acquireLock(path: String = "/tmp/pi-visual-desktop-\(getuid()).lock") throws -> Int32 {
    // Persistent inode, never unlink: flock is released by the kernel on crash/exit.
    let fd = open(path, O_CREAT | O_RDWR | O_NOFOLLOW | O_CLOEXEC, S_IRUSR | S_IWUSR)
    try require(fd >= 0, "Cannot open local desktop lock.")
    var st = stat()
    if fstat(fd, &st) != 0 || st.st_uid != getuid() || (st.st_mode & S_IFMT) != S_IFREG || (st.st_mode & 0o077) != 0 {
        close(fd); throw Failure(message: "Unsafe local desktop lock. Inspect /tmp/pi-visual-desktop-UID.lock manually.")
    }
    if flock(fd, LOCK_EX | LOCK_NB) != 0 {
        close(fd); throw Failure(message: "Another pi-visual-desktop session holds the desktop lock. Disable that session first.")
    }
    return fd
}
private func readRequestData(fd: Int32) throws -> Data? {
    var bytes: [UInt8] = []
    while interrupted == 0 {
        var descriptor = pollfd(fd: fd, events: Int16(POLLIN), revents: 0)
        let ready = poll(&descriptor, 1, 100)
        if ready < 0 { if errno == EINTR { continue }; throw Failure(message: "Input read failed.") }
        if ready == 0 { continue }
        var byte: UInt8 = 0
        let count = read(fd, &byte, 1)
        if count == 0 { return nil }
        if count < 0 { if errno == EINTR { continue }; throw Failure(message: "Input read failed.") }
        if byte == 10 { return Data(bytes) }
        bytes.append(byte)
        try require(bytes.count <= 32_767, "JSON request exceeds 32768-byte line limit.")
    }
    return nil
}

// Never block the main actor while idle: NSWorkspace foreground notifications must drain.
@MainActor private func nextRequest(fd: Int32 = STDIN_FILENO) async throws -> [String: Any]? {
    guard let data = try await Task.detached(operation: { try readRequestData(fd: fd) }).value else { return nil }
    // Only Sendable Data crosses the worker boundary; parse dynamic JSON on the actor.
    guard let request = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw Failure(message: "Invalid JSON request.") }
    return request
}
// Input has been released before settling. Yield so app/foreground changes can be observed.
@MainActor private func settle(_ milliseconds: Int) async throws {
    try checkCancellation()
    for start in stride(from: 0, to: milliseconds, by: 10) {
        try await Task.sleep(nanoseconds: UInt64(min(10, milliseconds - start)) * 1_000_000)
        try checkCancellation()
    }
}

@main private struct Main {
    @MainActor static func main() async {
        signal(SIGTERM) { _ in interrupted = 1 }
        signal(SIGINT) { _ in interrupted = 1 }
        signal(SIGPIPE, SIG_IGN)
        if CommandLine.arguments == [CommandLine.arguments[0], "--health"] { send(Reply(ok: true, health: health())); return }
        if CommandLine.arguments == [CommandLine.arguments[0], "--self-test"] {
            do { try selfTest(); try await responsivenessTest(); print("Native state-machine/coordinate/preflight/lock/responsiveness tests passed; no capture or input.") }
            catch { print("Native self-test failed: \((error as? Failure)?.message ?? "Test failed")"); exit(1) }
            return
        }
        guard CommandLine.arguments.count == 1 else { send(Reply(ok: false, error: "Unsupported helper argument.")); return }
        do {
            let fd = try acquireLock()
            defer { close(fd) }
            let desktop = Desktop()
            while let request = try await nextRequest() {
                send(await desktop.handle(request))
                if interrupted != 0 { break }
            }
        } catch { send(Reply(ok: false, error: (error as? Failure)?.message ?? "Helper failed.", outcome: "not_dispatched")) }
    }
}

// Test only: a pipe writer prevents hangs even when the main actor is blocked.
@MainActor private func responsivenessTest() async throws {
    let pipe = Pipe()
    defer { try? pipe.fileHandleForReading.close(); try? pipe.fileHandleForWriting.close() }
    var readTick = false
    let readerTick = Task { @MainActor in
        try await Task.sleep(nanoseconds: 10_000_000)
        readTick = true
    }
    let writer = pipe.fileHandleForWriting
    DispatchQueue.global().async {
        usleep(100_000)
        writer.write(Data("{\"op\":\"health\"}\n".utf8))
    }
    let reply = try await nextRequest(fd: pipe.fileHandleForReading.fileDescriptor)
    let responsiveRead = readTick
    try await readerTick.value
    var settleTick = false
    let waiterTick = Task { @MainActor in
        try await Task.sleep(nanoseconds: 10_000_000)
        settleTick = true
    }
    try await settle(80)
    let responsiveSettle = settleTick
    try await waiterTick.value
    try require(reply?["op"] as? String == "health", "Async reader corrupted request")
    try require(responsiveRead && responsiveSettle,
                "Main actor blocked: stdin=\(!responsiveRead), post-input settle=\(!responsiveSettle)")
    let cancelledWait = Task { @MainActor in try await settle(2000) }
    await Task.yield()
    cancelledWait.cancel()
    var taskCancelled = false
    do { try await cancelledWait.value } catch is CancellationError { taskCancelled = true }
    try require(taskCancelled, "Async settle must honor task cancellation")
    interrupted = 1
    defer { interrupted = 0 }
    var signalCancelled = false
    do { try await settle(0) } catch { signalCancelled = true }
    try require(signalCancelled, "Even zero settle must honor termination signal")
}

private func expectRejected(_ body: () throws -> Void) throws {
    var rejected = false
    do { try body() } catch { rejected = true }
    try require(rejected, "Expected rejection")
}
private func selfTest() throws {
    let directory = FileManager.default.currentDirectoryPath + "/build/helper-tests-" + UUID().uuidString
    try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    defer { try? FileManager.default.removeItem(atPath: directory) }
    let lockPath = directory + "/session.lock"
    let first = try acquireLock(path: lockPath)
    try expectRejected { let second = try acquireLock(path: lockPath); close(second) }
    close(first)
    let next = try acquireLock(path: lockPath); close(next)
    try FileManager.default.createSymbolicLink(atPath: directory + "/symlink", withDestinationPath: lockPath)
    try expectRejected { let fd = try acquireLock(path: directory + "/symlink"); close(fd) }
    try require(chmod(lockPath, 0o666) == 0, "Test lock permissions")
    try expectRejected { let fd = try acquireLock(path: lockPath); close(fd) }
    let g = Geometry(displayID: 1, x: -100, y: 20, width: 1440, height: 900, pixelWidth: 2880, pixelHeight: 1800, rotation: 0, pid: 1, bundle: "test", launched: 1)
    let s = Snapshot(ref: "test", capturedAt: 0, width: 1280, height: 800, geometry: g, view: .full(g))
    try validateSnapshot(s, current: g, now: ttl - 1)
    for age in [-1, ttl, ttl + 1] { try expectRejected { try validateSnapshot(s, current: g, now: age) } }
    let encoded = try JSONEncoder().encode(g)
    for field in ["displayID", "x", "y", "width", "height", "pixelWidth", "pixelHeight", "rotation", "pid", "launched"] {
        var object = try JSONSerialization.jsonObject(with: encoded) as! [String: Any]
        object[field] = (object[field] as! NSNumber).doubleValue + 1
        let changed = try JSONDecoder().decode(Geometry.self, from: JSONSerialization.data(withJSONObject: object))
        try expectRejected { try validateSnapshot(s, current: changed, now: 1) }
    }
    try require(imageSize(g) == (1280, 800), "Retina image size")
    try require(point(0, 0, s) == CGPoint(x: -99.4375, y: 20.5625), "Pixel center")
    let portrait = Geometry(displayID: 1, x: 0, y: 0, width: 900, height: 1440, pixelWidth: 2880, pixelHeight: 1800, rotation: 90, pid: 1, bundle: "test", launched: 1)
    try require(imageSize(portrait) == (800, 1280), "Rotated bounds preserve image aspect ratio")
    let fractional = Geometry(displayID: 1, x: 0, y: 0, width: 1512, height: 982, pixelWidth: 3024, pixelHeight: 1964, rotation: 0, pid: 1, bundle: "test", launched: 1)
    let config = captureConfiguration(fractional)
    try require(config.width == 1280 && config.height == 831, "Non-integral resize dimensions")
    try require(!config.preservesAspectRatio, "Capture must fill independently rounded dimensions without padding")
    let resized = Snapshot(ref: "test", capturedAt: 0, width: config.width, height: config.height, geometry: fractional, view: .full(fractional))
    for (x, y) in [(0.0, 0.0), (639.0, 415.0), (1279.0, 830.0)] {
        let mapped = point(x, y, resized)
        try require(abs(mapped.x - (x + 0.5) * 1512 / 1280) < 1e-10 &&
                    abs(mapped.y - (y + 0.5) * 982 / 831) < 1e-10, "Independent-axis pixel centers after non-integral resize")
    }
    // These are configuration/math/event-construction tests only; never capture or post.
    for g in [g, portrait, fractional] {
        let (w, h) = imageSize(g)
        let full = Snapshot(ref: "zoom-source", capturedAt: 0, width: w, height: h, geometry: g, view: .full(g))
        let selection: [String: Any] = ["ref": full.ref, "x": 100, "y": 50, "width": 300, "height": 200]
        let v = try zoomView(selection, full)
        let config = captureConfiguration(g, v)
        try require(config.sourceRect == CGRect(x: 100 * g.width / Double(w), y: 50 * g.height / Double(h),
                                                width: 300 * g.width / Double(w), height: 200 * g.height / Double(h)), "Display-local sourceRect uses source image edges")
        try require(!config.preservesAspectRatio && config.width > 300 && config.height > 200, "New capture detail without padding")
        let crop = Snapshot(ref: "nested-source", capturedAt: 0, width: config.width, height: config.height, geometry: g, view: v)
        let nested = try zoomView(["ref": crop.ref, "x": 3, "y": 7, "width": 20, "height": 30], crop)
        let (nw, nh) = imageSize(g, nested)
        let n = Snapshot(ref: "nested", capturedAt: 0, width: nw, height: nh, geometry: g, view: nested)
        let p = point(Double(nw - 1), Double(nh - 1), n)
        try require(abs(p.x - (g.x + v.x + (3 + (Double(nw) - 0.5) * 20 / Double(nw)) * v.width / Double(crop.width))) < 1e-9,
                    "Nested x composition includes nonzero global origin exactly once")
        try require(abs(p.y - (g.y + v.y + (7 + (Double(nh) - 0.5) * 30 / Double(nh)) * v.height / Double(crop.height))) < 1e-9,
                    "Nested y composition after fractional rounding")
        let nativeScale = min(Double(max(g.pixelWidth, g.pixelHeight)) / max(g.width, g.height),
                              Double(min(g.pixelWidth, g.pixelHeight)) / min(g.width, g.height))
        try require(Double(nw) <= nested.width * nativeScale && Double(nh) <= nested.height * nativeScale &&
                    max(config.width, config.height) <= maxEdge, "Output never exceeds native resolution or edge limit")
        try expectRejected { try validateSnapshot(crop, current: g, now: ttl) }
        for key in ["x", "y", "width", "height"] {
            for bad: Any in [-1, Double.nan, Double.infinity, true, 0.5, 1281] {
                var z = selection; z[key] = bad
                try expectRejected { _ = try zoomView(z, full) }
            }
        }
        for z: [String: Any] in [
            ["ref": "foreign", "x": 0, "y": 0, "width": 1, "height": 1],
            ["ref": full.ref, "x": 1, "y": 0, "width": w, "height": h],
            ["ref": full.ref, "x": 0, "y": 0, "width": 0, "height": 1],
            ["ref": full.ref, "x": 0, "y": 0, "width": 1, "height": 1, "extra": true]
        ] { try expectRejected { _ = try zoomView(z, full) } }
    }
    try require(try settleMilliseconds([:]) == 250, "Default post-input settle")
    for milliseconds in [0, 250, 800, 2000] {
        try require(try settleMilliseconds(["settleMs": milliseconds]) == milliseconds, "Explicit post-input settle")
        let adjusted = try plan(["op": "act", "action": "click", "ref": s.ref, "x": 0, "y": 0, "settleMs": milliseconds], s)
        try require(adjusted.count == 2 && adjusted.first?.kind == "leftDown", "Settle must not add input events")
    }
    for bad: Any in [-1, 2001, 0.5, true, "500", NSNull()] {
        try expectRejected { _ = try plan(["op": "act", "action": "click", "ref": s.ref, "x": 0, "y": 0, "settleMs": bad], s) }
    }
    let move = try plan(["op": "act", "action": "move", "ref": s.ref, "x": 4, "y": 9], s)
    try require(move.count == 1 && move[0].kind == "move" && move[0].point == point(4, 9, s) &&
                move[0].release == nil && move[0].emergencyRelease == nil && move[0].count == 0, "Hover is one no-button event, no held input")
    guard let eventSource = CGEventSource(stateID: .privateState) else { throw Failure(message: "Test event allocation failed") }
    let hoverEvent = try cgEvent(move[0], source: eventSource)
    try require(hoverEvent.type == .mouseMoved && hoverEvent.flags.isEmpty &&
                hoverEvent.getIntegerValueField(.mouseEventClickState) == 0, "Native hover construction never creates down/up")
    try expectRejected { _ = try plan(["op": "act", "action": "move", "ref": s.ref, "x": 0, "y": 0, "button": "left"], s) }
    let drag = try plan(["op": "act", "action": "drag", "ref": "test", "x": 0, "y": 0, "toX": 1279, "toY": 799], s)
    try require(drag.count == 22, "Bounded drag")
    for cut in 0...drag.count {
        var emitted: [InputEvent] = [], count = 0
        do { try runInput(drag, cancelled: { count >= cut }, wait: { _ in }, emit: { event, _ in emitted.append(event); count += 1 }) } catch {}
        if emitted.contains(where: { $0.kind == "leftDown" }) {
            try require(emitted.last?.kind == "leftUp", "Cancelled drag must release")
            let lastPoint = emitted.last(where: { $0.kind == "drag" || $0.kind == "leftDown" })!.point
            try require(emitted.last?.point == lastPoint, "Cancelled drag releases at last dispatched position")
        }
    }
    let chord = try plan(["op": "act", "action": "key", "ref": "test", "key": "a", "modifiers": ["command", "shift"]], s)
    for cut in 0...chord.count {
        var held = Set<UInt16>(), count = 0
        do { try runInput(chord, cancelled: { count >= cut }, wait: { _ in }, emit: { event, _ in
            if event.kind == "keyDown" { held.insert(event.key) } else { held.remove(event.key) }; count += 1
        }) } catch {}
        try require(held.isEmpty, "Cancelled chord must release")
    }
    for name in keyCodes.keys {
        let events = try plan(["op": "act", "action": "key", "ref": "test", "key": name, "modifiers": []], s)
        try require(events.count == 2 && events[0].key == keyCodes[name], "Key mapping")
    }
    for bad: [String: Any] in [
        ["op": "act", "action": "click", "ref": "foreign", "x": 0, "y": 0],
        ["op": "act", "action": "click", "ref": "test", "x": 0, "y": 0, "extra": true],
        ["op": "act", "action": "key", "ref": "test", "key": "caps_lock", "modifiers": []],
        ["op": "act", "action": "key", "ref": "test", "key": "a", "modifiers": ["command", "command"]]
    ] { try expectRejected { _ = try plan(bad, s) } }
    // Failure after posting down and cancellation during a delay must both release.
    var emitted: [InputEvent] = []
    do { try runInput(chord, cancelled: { false }, wait: { _ in }, emit: { event, cleanup in
        emitted.append(event); if !cleanup { throw Failure(message: "Mock sink failure") }
    }) } catch {}
    try require(emitted.map { $0.kind } == ["keyDown", "keyUp"], "Sink failure release")
    emitted = []
    do { try runInput(drag, cancelled: { false }, wait: { delay in
        if delay > 0 { throw Failure(message: "Mock wait cancellation") }
    }, emit: { event, _ in emitted.append(event) }) } catch {}
    try require(emitted.map { $0.kind } == ["leftDown", "leftUp"], "Wait cancellation release")
    let text = try plan(["op": "act", "action": "type", "ref": "test", "text": "한😀"], s)
    try require(text.count == 4 && text[2].unicode.count == 2, "Unicode surrogate pair preserved")
    for action in ["move", "click", "double_click", "right_click", "scroll", "type"] {
        var request: [String: Any] = ["op": "act", "action": action, "ref": "test"]
        if action == "type" { request["text"] = "한😀" }
        else { request["x"] = 0; request["y"] = 0 }
        if action == "scroll" { request["dx"] = 20; request["dy"] = -30 }
        let events = try plan(request, s)
        if action == "scroll" { try require(events.last?.dx == -20 && events.last?.dy == 30, "Scroll direction") }
        if action == "double_click" { try require(events.map { $0.count } == [1, 1, 2, 2], "Double-click count") }
        for cut in 0...events.count {
            var down: [InputEvent] = [], count = 0
            do { try runInput(events, cancelled: { count >= cut }, wait: { _ in }, emit: { event, _ in
                if event.release != nil { down.append(event) }
                else if let i = down.lastIndex(where: { $0.matches(event) }) {
                    try require(down[i].unicode == event.unicode, "Release preserves Unicode identity")
                    down.remove(at: i)
                }
                count += 1
            }) } catch {}
            try require(down.isEmpty, "All primitive cancellation boundaries release held input")
        }
    }
    for x: Any in [-1, 1280, Double.nan, true, "1"] {
        var rejected = false
        do { _ = try plan(["op": "act", "action": "click", "ref": "test", "x": x, "y": 0], s) } catch { rejected = true }
        try require(rejected, "Invalid coordinates rejected")
    }
}
