// Draws Cue's app icon (1024 px PNG): a glassy blue-violet squircle with a white sparkle.
import AppKit
let size = 1024.0, inset = 100.0
let image = NSImage(size: NSSize(width: size, height: size))
image.lockFocus()
let rect = NSRect(x: inset, y: inset, width: size - 2 * inset, height: size - 2 * inset)
let shape = NSBezierPath(roundedRect: rect, xRadius: 185, yRadius: 185)
NSGraphicsContext.current?.saveGraphicsState()
let shadow = NSShadow(); shadow.shadowColor = .black.withAlphaComponent(0.3); shadow.shadowBlurRadius = 28; shadow.shadowOffset = NSSize(width: 0, height: -12); shadow.set()
NSGradient(colors: [NSColor(red: 0.20, green: 0.42, blue: 1.0, alpha: 1), NSColor(red: 0.55, green: 0.30, blue: 0.98, alpha: 1)])!.draw(in: shape, angle: -60)
NSGraphicsContext.current?.restoreGraphicsState()
shape.addClip()
NSGradient(colors: [.white.withAlphaComponent(0.45), .white.withAlphaComponent(0.0)])!.draw(in: NSRect(x: inset, y: size / 2, width: size - 2 * inset, height: size / 2 - inset), angle: -90) // glass sheen
NSColor.white.withAlphaComponent(0.5).setStroke(); let rim = NSBezierPath(roundedRect: rect.insetBy(dx: 3, dy: 3), xRadius: 182, yRadius: 182); rim.lineWidth = 6; rim.stroke()
let symbol = NSImage(systemSymbolName: "sparkles", accessibilityDescription: nil)!.withSymbolConfiguration(.init(pointSize: 420, weight: .semibold))!
let tinted = NSImage(size: symbol.size, flipped: false) { r in symbol.draw(in: r); NSColor.white.set(); r.fill(using: .sourceAtop); return true }
tinted.draw(in: NSRect(x: (size - symbol.size.width) / 2, y: (size - symbol.size.height) / 2, width: symbol.size.width, height: symbol.size.height))
image.unlockFocus()
let png = NSBitmapImageRep(data: image.tiffRepresentation!)!.representation(using: .png, properties: [:])!
try! png.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
