import SwiftUI
import ASKit

/// Mini assembled only from approved parts (no free-form uploads; Blueprint §33).
struct MiniEditorView: View {
    @Binding var mini: MiniDefinition

    var body: some View {
        VStack(spacing: 16) {
            MiniFigure(definition: mini)
                .frame(height: 150)
                .padding(.top, 8)
            ForEach(MiniSlot.allCases) { slot in
                VStack(alignment: .leading, spacing: 6) {
                    Text(slot.title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink.opacity(0.8))
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(slot.parts, id: \.self) { part in
                                let selected = mini.resolved[slot] == part
                                Button {
                                    var m = mini.resolved
                                    m[slot] = part
                                    mini = m
                                } label: {
                                    Text(partName(part))
                                        .font(.footnote)
                                        .padding(.horizontal, 12).padding(.vertical, 8)
                                        .background(selected ? Theme.moss.opacity(0.25) : Color.white.opacity(0.6), in: Capsule())
                                        .overlay(Capsule().strokeBorder(selected ? Theme.moss : Theme.ink.opacity(0.1)))
                                }
                                .buttonStyle(.plain)
                                .accessibilityAddTraits(selected ? .isSelected : [])
                            }
                        }
                    }
                }
            }
        }
    }

    private func partName(_ id: String) -> String {
        let last = id.split(separator: ".").last.map(String.init) ?? id
        return last.count == 1 ? last.uppercased() : last.capitalized
    }
}
