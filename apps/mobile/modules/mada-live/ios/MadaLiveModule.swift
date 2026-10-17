import ExpoModulesCore
import Foundation
import WidgetKit
#if canImport(ActivityKit)
import ActivityKit
#endif

/*
 * The lock-screen flight (docs/app/NATIVE.md): starts, updates and ends the Live Activity (lock screen and Dynamic
 * Island) drawn by the widget extension in targets/live, hands its ActivityKit push token to JS (which gives it to
 * the Core API so the server can push changes), and writes the next trip for the home-screen widget into the App
 * Group. iOS 16.2+; on older iOS every function says it isn't supported and JS falls back to notifications.
 */

final class LiveUnsupportedException: Exception {
  override var reason: String { "Live Activities need iOS 16.2 or later" }
}

final class LiveNotFoundException: Exception {
  override var reason: String { "That Live Activity has ended" }
}

private enum Coding {
  static func decode<T: Decodable>(_ type: T.Type, _ value: [String: Any]) throws -> T {
    let data = try JSONSerialization.data(withJSONObject: value, options: [])
    return try JSONDecoder().decode(type, from: data)
  }
}

private let staleAfter: TimeInterval = 30 * 60

public class MadaLiveModule: Module {
  private var watched = Set<String>()

  private var appGroup: String {
    (Bundle.main.object(forInfoDictionaryKey: "MadaAppGroup") as? String) ?? "group.sa.madatrips.app"
  }

  public func definition() -> ModuleDefinition {
    Name("MadaLive")

    Events("onPushToken", "onEnded")

    Function("isSupported") { () -> Bool in
      if #available(iOS 16.2, *) { return true }
      return false
    }

    Function("areActivitiesEnabled") { () -> Bool in
      if #available(iOS 16.2, *) { return ActivityAuthorizationInfo().areActivitiesEnabled }
      return false
    }

    /// Starts the activity for this flight, or updates the one already running for it. Resolves to its id.
    AsyncFunction("start") { (attributes: [String: Any], state: [String: Any]) async throws -> String in
      guard #available(iOS 16.2, *) else { throw LiveUnsupportedException() }
      let attrs = try Coding.decode(MadaLiveAttributes.self, attributes)
      let content = ActivityContent(state: try Coding.decode(MadaLiveAttributes.ContentState.self, state), staleDate: Date().addingTimeInterval(staleAfter))
      if let running = Activity<MadaLiveAttributes>.activities.first(where: { $0.attributes.segmentId == attrs.segmentId && $0.activityState == .active }) {
        await running.update(content)
        self.watch(running)
        return running.id
      }
      // pushType .token: iOS hands us a token for the server to push updates with (APNs, liveactivity).
      let activity = try Activity.request(attributes: attrs, content: content, pushType: .token)
      self.watch(activity)
      return activity.id
    }

    AsyncFunction("update") { (id: String, state: [String: Any]) async throws in
      guard #available(iOS 16.2, *) else { throw LiveUnsupportedException() }
      guard let a = Activity<MadaLiveAttributes>.activities.first(where: { $0.id == id }) else { throw LiveNotFoundException() }
      let s = try Coding.decode(MadaLiveAttributes.ContentState.self, state)
      await a.update(ActivityContent(state: s, staleDate: Date().addingTimeInterval(staleAfter)))
    }

    /// Ends it: with a last state (landed) it stays on the lock screen a little while; `now` takes it off at once.
    AsyncFunction("end") { (id: String, state: [String: Any]?, now: Bool) async throws in
      guard #available(iOS 16.2, *) else { throw LiveUnsupportedException() }
      guard let a = Activity<MadaLiveAttributes>.activities.first(where: { $0.id == id }) else { return }
      let last = try state.map { ActivityContent(state: try Coding.decode(MadaLiveAttributes.ContentState.self, $0), staleDate: nil) }
      await a.end(last, dismissalPolicy: now ? .immediate : .after(Date().addingTimeInterval(15 * 60)))
    }

    /// What's running now, with each one's push token (hex) once iOS has given it.
    Function("running") { () -> [[String: String]] in
      guard #available(iOS 16.2, *) else { return [] }
      return Activity<MadaLiveAttributes>.activities.filter { $0.activityState == .active }.map { a in
        self.watch(a)
        var row = ["activityId": a.id, "segmentId": a.attributes.segmentId, "tripId": a.attributes.tripId]
        if let t = a.pushToken { row["token"] = t.map { String(format: "%02x", $0) }.joined() }
        return row
      }
    }

    /// The next trip for the home-screen widget, as JSON the widget reads from the App Group.
    Function("setWidgetData") { (json: String?) in
      let defaults = UserDefaults(suiteName: self.appGroup)
      if let json = json { defaults?.set(json, forKey: "mada.nextTrip") } else { defaults?.removeObject(forKey: "mada.nextTrip") }
      WidgetCenter.shared.reloadAllTimelines()
    }
  }

  @available(iOS 16.2, *)
  private func watch(_ activity: Activity<MadaLiveAttributes>) {
    guard !watched.contains(activity.id) else { return }
    watched.insert(activity.id)
    Task { [weak self] in
      for await token in activity.pushTokenUpdates {
        let hex = token.map { String(format: "%02x", $0) }.joined()
        self?.sendEvent("onPushToken", ["activityId": activity.id, "segmentId": activity.attributes.segmentId, "tripId": activity.attributes.tripId, "token": hex])
      }
    }
    Task { [weak self] in
      for await s in activity.activityStateUpdates where s == .dismissed || s == .ended {
        self?.sendEvent("onEnded", ["activityId": activity.id, "segmentId": activity.attributes.segmentId, "dismissed": s == .dismissed])
      }
    }
  }
}
