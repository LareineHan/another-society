import SwiftUI
import ASKit

struct SettingsView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var mini = MiniDefinition.starter
    @State private var editingMini = false
    @State private var confirmDelete = false
    @State private var deleteText = ""
    @State private var server = AppConfig.overrideValue

    var body: some View {
        NavigationStack {
            Form {
                Section("You") {
                    HStack(spacing: 14) {
                        MiniFigure(definition: mini).frame(width: 56, height: 56)
                        VStack(alignment: .leading) {
                            TextField("Name", text: $name).font(.headline).onSubmit { Task { await saveName() } }
                            if let tag = app.resident?.publicTag { Text(tag).font(.caption.monospaced()).foregroundStyle(.secondary) }
                        }
                    }
                    Button("Change your Mini") { editingMini = true }
                }
                Section {
                    Link("Contact support", destination: URL(string: "mailto:\(AppConfig.supportEmail)")!)
                } footer: {
                    Text("No chat, no followers, no rankings. Presence, places and objects are how people meet here.")
                }
                Section {
                    Button("Sign out") { Task { await app.signOut(); dismiss() } }
                    Button("Delete account", role: .destructive) { confirmDelete = true }
                }
                #if DEBUG
                Section("Developer") {
                    TextField("API base URL (blank = default)", text: $server)
                        .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                    Text("Current: \(AppConfig.apiBaseURL.absoluteString)").font(.caption).foregroundStyle(.secondary)
                    Button("Use this server") { Task { await app.switchServer(to: server.isEmpty ? nil : server); dismiss() } }
                }
                #endif
            }
            .navigationTitle("You")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { Task { await saveName(); dismiss() } } } }
            .sheet(isPresented: $editingMini) {
                NavigationStack {
                    ScrollView { MiniEditorView(mini: $mini).padding() }
                        .navigationTitle("Your Mini")
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbar {
                            ToolbarItem(placement: .confirmationAction) {
                                Button("Save") {
                                    Task {
                                        if await app.attempt({ try await app.api.updateMini(mini) }) != nil { await app.refreshMe() }
                                        editingMini = false
                                    }
                                }
                            }
                        }
                }
            }
            .alert("Delete your account?", isPresented: $confirmDelete) {
                TextField("Type DELETE", text: $deleteText)
                Button("Delete", role: .destructive) {
                    guard deleteText == "DELETE" else { return }
                    Task { if await app.deleteAccount() { dismiss() } }
                }
                Button("Cancel", role: .cancel) { deleteText = "" }
            } message: {
                Text("Your home returns to the city, your name and Mini are removed, and you are signed out everywhere. This can't be undone.")
            }
        }
        .onAppear {
            name = app.resident?.displayName ?? ""
            if let m = app.resident?.miniDefinition { mini = m.resolved }
        }
    }

    private func saveName() async {
        let n = name.trimmingCharacters(in: .whitespaces)
        guard !n.isEmpty, n != app.resident?.displayName else { return }
        if await app.attempt({ try await app.api.updateDisplayName(n) }) != nil { await app.refreshMe() }
    }
}
