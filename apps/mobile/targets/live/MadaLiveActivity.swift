import ActivityKit
import SwiftUI
import WidgetKit

/*
 * The lock-screen flight and the Dynamic Island (compact, expanded, minimal). Every word arrives already written in
 * the traveller's language (LiveFlightState in packages/shared/src/schemas/boarding.ts), so nothing is translated here.
 */

private extension Color {
  init(hex: String) {
    var v: UInt64 = 0
    Scanner(string: hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))).scanHexInt64(&v)
    self.init(red: Double((v >> 16) & 0xff) / 255, green: Double((v >> 8) & 0xff) / 255, blue: Double(v & 0xff) / 255)
  }
  static let madaPaper = Color(red: 1, green: 0.992, blue: 0.976)
  static let madaGold = Color(red: 0.831, green: 0.745, blue: 0.549)
  static let madaGreen = Color(red: 0.118, green: 0.208, blue: 0.176)
}

private func tone(_ status: String) -> Color {
  switch status {
  case "delayed", "gate_changed": return .madaGold
  case "cancelled": return Color(red: 0.95, green: 0.55, blue: 0.5)
  default: return Color(red: 0.62, green: 0.86, blue: 0.7)
  }
}

private struct Cell: View {
  let label: String
  let value: String
  var highlight = false
  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(label).font(.caption2).foregroundStyle(Color.madaPaper.opacity(0.7))
      Text(value).font(.system(.title3, design: .rounded).weight(.semibold)).monospacedDigit()
        .foregroundStyle(highlight ? Color.madaGold : Color.madaPaper)
        .lineLimit(1).minimumScaleFactor(0.7)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

private struct LockScreen: View {
  let attrs: MadaLiveAttributes
  let s: MadaLiveAttributes.ContentState
  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(alignment: .center) {
        Text("\(attrs.airline) · \(s.flight)").font(.footnote.weight(.medium)).foregroundStyle(Color.madaPaper.opacity(0.8))
        Spacer()
        Text(s.statusText).font(.footnote.weight(.semibold)).foregroundStyle(tone(s.status)).lineLimit(1)
      }
      HStack(alignment: .firstTextBaseline, spacing: 8) {
        Text(s.from).font(.system(.title, design: .rounded).weight(.bold))
        Image(systemName: "airplane").font(.headline).foregroundStyle(Color.madaGold)
        Text(s.to).font(.system(.title, design: .rounded).weight(.bold))
        Spacer()
        VStack(alignment: .trailing, spacing: 0) {
          Text(s.labels.departs).font(.caption2).foregroundStyle(Color.madaPaper.opacity(0.7))
          Text(s.departs).font(.system(.title2, design: .rounded).weight(.semibold)).monospacedDigit()
        }
      }
      .foregroundStyle(Color.madaPaper)
      HStack(spacing: 8) {
        Cell(label: s.labels.gate, value: s.gate ?? "–", highlight: s.status == "gate_changed")
        Cell(label: s.labels.seat, value: s.seat ?? "–")
        Cell(label: s.labels.boards, value: s.boards, highlight: s.status == "delayed")
      }
      if let leave = s.leaveText {
        Label(leave, systemImage: "car.fill").font(.footnote.weight(.semibold)).foregroundStyle(Color.madaGold).lineLimit(1)
      }
    }
    .padding(16)
  }
}

struct MadaLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: MadaLiveAttributes.self) { context in
      LockScreen(attrs: context.attributes, s: context.state)
        .activityBackgroundTint(Color.madaGreen)
        .activitySystemActionForegroundColor(Color.madaPaper)
        .widgetURL(URL(string: "madatrips://today"))
    } dynamicIsland: { context in
      let s = context.state
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          VStack(alignment: .leading, spacing: 2) {
            Text(s.from).font(.system(.title2, design: .rounded).weight(.bold))
            Text("\(s.labels.gate) \(s.gate ?? "–")").font(.caption).foregroundStyle(s.status == "gate_changed" ? Color.madaGold : .secondary)
          }
        }
        DynamicIslandExpandedRegion(.trailing) {
          VStack(alignment: .trailing, spacing: 2) {
            Text(s.to).font(.system(.title2, design: .rounded).weight(.bold))
            Text("\(s.labels.departs) \(s.departs)").font(.caption).monospacedDigit().foregroundStyle(.secondary)
          }
        }
        DynamicIslandExpandedRegion(.center) {
          Text("\(s.flight) · \(s.statusText)").font(.footnote.weight(.semibold)).foregroundStyle(tone(s.status)).lineLimit(1)
        }
        DynamicIslandExpandedRegion(.bottom) {
          HStack {
            Text("\(s.labels.seat) \(s.seat ?? "–")")
            Spacer()
            if let leave = s.leaveText { Label(leave, systemImage: "car.fill").foregroundStyle(Color.madaGold).lineLimit(1) }
            else { Text("\(s.labels.boards) \(s.boards)").monospacedDigit() }
          }
          .font(.footnote)
        }
      } compactLeading: {
        HStack(spacing: 4) {
          Image(systemName: "airplane").foregroundStyle(Color.madaGold)
          Text(s.gate ?? s.flight).font(.caption.weight(.semibold)).foregroundStyle(s.status == "gate_changed" ? Color.madaGold : .primary)
        }
      } compactTrailing: {
        Text(s.status == "delayed" ? "+\(s.delayMin)" : s.departs).font(.caption.weight(.semibold)).monospacedDigit().foregroundStyle(tone(s.status))
      } minimal: {
        Image(systemName: "airplane").foregroundStyle(tone(s.status))
      }
      .widgetURL(URL(string: "madatrips://today"))
      .keylineTint(Color(hex: context.attributes.brand))
    }
  }
}
