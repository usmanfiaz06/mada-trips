import SwiftUI
import WidgetKit

/*
 * The next trip on the home screen (small and medium). The app writes it into the App Group whenever the trips load
 * (lib/live-activity.ts › widgetData), already in the traveller's language; nothing here goes to the network.
 */

struct NextTrip: Codable {
  var city: String
  var when: String
  var flight: String?
  var route: String?
  var line: String?
  var gate: String?
  var seat: String?
  var labels: [String: String]?
}

struct NextTripEntry: TimelineEntry {
  let date: Date
  let trip: NextTrip?
}

private func readTrip() -> NextTrip? {
  let group = (Bundle.main.object(forInfoDictionaryKey: "MadaAppGroup") as? String) ?? "group.sa.madatrips.app"
  guard let json = UserDefaults(suiteName: group)?.string(forKey: "mada.nextTrip"), let data = json.data(using: .utf8) else { return nil }
  return try? JSONDecoder().decode(NextTrip.self, from: data)
}

struct NextTripProvider: TimelineProvider {
  func placeholder(in context: Context) -> NextTripEntry {
    NextTripEntry(date: Date(), trip: NextTrip(city: "Istanbul", when: "Tue 9 Mar · 09:40", flight: "SV263", route: "RUH → IST", line: nil, gate: "B12", seat: "14A", labels: nil))
  }
  func getSnapshot(in context: Context, completion: @escaping (NextTripEntry) -> Void) {
    completion(NextTripEntry(date: Date(), trip: readTrip() ?? placeholder(in: context).trip))
  }
  func getTimeline(in context: Context, completion: @escaping (Timeline<NextTripEntry>) -> Void) {
    // The app reloads the timeline when the trip changes; this is only the fallback.
    completion(Timeline(entries: [NextTripEntry(date: Date(), trip: readTrip())], policy: .after(Date().addingTimeInterval(3600))))
  }
}

private let paper = Color(red: 1, green: 0.992, blue: 0.976)
private let arabic = Locale.preferredLanguages.first?.hasPrefix("ar") ?? false

private extension View {
  @ViewBuilder func madaBackground() -> some View {
    let green = Color(red: 0.118, green: 0.208, blue: 0.176)
    if #available(iOSApplicationExtension 17.0, *) { containerBackground(for: .widget) { green } } else { background(green) }
  }
}
private let gold = Color(red: 0.831, green: 0.745, blue: 0.549)

struct NextTripView: View {
  @Environment(\.widgetFamily) var family
  let entry: NextTripEntry
  var body: some View {
    Group {
      if let t = entry.trip {
        VStack(alignment: .leading, spacing: 4) {
          Text(t.city).font(.system(.title2, design: .serif).weight(.semibold)).foregroundStyle(paper).lineLimit(1).minimumScaleFactor(0.7)
          Text(t.when).font(.caption.weight(.medium)).foregroundStyle(gold).lineLimit(1)
          Spacer(minLength: 0)
          if let flight = t.flight {
            Text([flight, t.route].compactMap { $0 }.joined(separator: " · ")).font(.caption).monospacedDigit().foregroundStyle(paper.opacity(0.85)).lineLimit(1)
          }
          if family == .systemMedium {
            HStack(spacing: 14) {
              if let g = t.gate { Text("\(t.labels?["gate"] ?? (arabic ? "البوابة" : "Gate")) \(g)") }
              if let s = t.seat { Text("\(t.labels?["seat"] ?? (arabic ? "المقعد" : "Seat")) \(s)") }
            }
            .font(.caption.weight(.semibold)).foregroundStyle(paper)
            if let line = t.line { Text(line).font(.caption2).foregroundStyle(paper.opacity(0.75)).lineLimit(2) }
          }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
      } else {
        VStack(alignment: .leading, spacing: 4) {
          Text(verbatim: arabic ? "مادا" : "Mada").font(.system(.title2, design: .serif).weight(.semibold)).foregroundStyle(paper)
          Spacer(minLength: 0)
          Image(systemName: "airplane").foregroundStyle(gold)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
      }
    }
    .madaBackground()
    .widgetURL(URL(string: "madatrips://today"))
  }
}

struct NextTripWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "MadaNextTrip", provider: NextTripProvider()) { entry in
      NextTripView(entry: entry)
    }
    .configurationDisplayName(Text(verbatim: arabic ? "رحلتك الجاية" : "Next trip"))
    .description(Text(verbatim: arabic ? "رحلتك الجاية مع مادا، بنظرة." : "Your next trip with Mada, at a glance."))
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}
