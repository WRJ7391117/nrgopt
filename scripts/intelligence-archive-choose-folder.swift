import AppKit

let app = NSApplication.shared
app.setActivationPolicy(.regular)
app.activate(ignoringOtherApps: true)

let panel = NSOpenPanel()
panel.message = "选择 NRGOPT 原文归档目录"
panel.canChooseFiles = false
panel.canChooseDirectories = true
panel.canCreateDirectories = true
panel.allowsMultipleSelection = false

if panel.runModal() == .OK, let url = panel.url {
    print(url.path)
}

app.terminate(nil)
