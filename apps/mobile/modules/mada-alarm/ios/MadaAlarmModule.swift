import ExpoModulesCore
import SwiftUI
#if canImport(AlarmKit)
import AlarmKit
#endif

/*
 * The wake-up alarm before a flight, through AlarmKit (iOS 26+): a real alarm that rings through silent mode and
 * Focus once the person allows it (NSAlarmKitUsageDescription). One-time, fixed date, alert only: no countdown, so no
 * widget extension is needed (Apple: "AlarmKit expects a widget extension if an app supports a countdown
 * presentation"). Everything is behind availability checks; on older iOS every call reports "unavailable".
 */

#if canImport(AlarmKit)
@available(iOS 26.0, *)
struct MadaWakeMetadata: AlarmMetadata {}
#endif

/// Mada's green (#1e352d), the tint AlarmKit uses to tell our alarm from other apps'.
private let madaGreen = Color(red: 30 / 255, green: 53 / 255, blue: 45 / 255)

public class MadaAlarmModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MadaAlarm")

    /// True on iOS 26+ built with an SDK that has AlarmKit.
    Function("isAlarmKitAvailable") { () -> Bool in
      #if canImport(AlarmKit)
      if #available(iOS 26.0, *) { return true }
      #endif
      return false
    }

    /// "authorized", "denied", "notDetermined", or "unavailable" (older iOS).
    AsyncFunction("authorizationState") { () -> String in
      #if canImport(AlarmKit)
      if #available(iOS 26.0, *) { return MadaAlarmModule.label(AlarmManager.shared.authorizationState) }
      #endif
      return "unavailable"
    }

    /// Asks once (the system prompt shows NSAlarmKitUsageDescription); afterwards returns the saved answer.
    AsyncFunction("requestAuthorization") { () async throws -> String in
      #if canImport(AlarmKit)
      if #available(iOS 26.0, *) {
        let state = try await AlarmManager.shared.requestAuthorization()
        return MadaAlarmModule.label(state)
      }
      #endif
      return "unavailable"
    }

    /// Schedules a one-time alarm at epochMs with the given title; returns the alarm id (a UUID string).
    AsyncFunction("schedule") { (id: String, epochMs: Double, title: String, stopLabel: String) async throws -> String in
      #if canImport(AlarmKit)
      if #available(iOS 26.0, *) {
        let alarmId = UUID(uuidString: id) ?? UUID()
        let alert: AlarmPresentation.Alert
        if #available(iOS 26.1, *) {
          // 26.1+: the system draws the stop control itself.
          alert = AlarmPresentation.Alert(title: LocalizedStringResource(stringLiteral: title))
        } else {
          alert = AlarmPresentation.Alert(
            title: LocalizedStringResource(stringLiteral: title),
            stopButton: AlarmButton(text: LocalizedStringResource(stringLiteral: stopLabel), textColor: .white, systemImageName: "stop.circle")
          )
        }
        let attributes = AlarmAttributes<MadaWakeMetadata>(presentation: AlarmPresentation(alert: alert), metadata: MadaWakeMetadata(), tintColor: madaGreen)
        let configuration = AlarmManager.AlarmConfiguration<MadaWakeMetadata>.alarm(
          schedule: .fixed(Date(timeIntervalSince1970: epochMs / 1000)),
          attributes: attributes
        )
        _ = try await AlarmManager.shared.schedule(id: alarmId, configuration: configuration)
        return alarmId.uuidString
      }
      #endif
      throw AlarmUnavailableException()
    }

    /// Cancels the alarm; quietly does nothing when it already rang or was never set.
    AsyncFunction("cancel") { (id: String) in
      #if canImport(AlarmKit)
      if #available(iOS 26.0, *), let alarmId = UUID(uuidString: id) {
        try? AlarmManager.shared.cancel(id: alarmId)
      }
      #endif
    }

    /// Android only; here so the JS side can call the same names everywhere.
    AsyncFunction("setClockAlarm") { (_: Int, _: Int, _: String, _: Bool) -> Bool in false }
    AsyncFunction("dismissClockAlarm") { (_: String) -> Bool in false }
    AsyncFunction("showClockAlarms") { () -> Bool in false }
  }

  #if canImport(AlarmKit)
  @available(iOS 26.0, *)
  private static func label(_ state: AlarmManager.AuthorizationState) -> String {
    switch state {
    case .authorized: return "authorized"
    case .denied: return "denied"
    case .notDetermined: return "notDetermined"
    @unknown default: return "denied"
    }
  }
  #endif
}

internal final class AlarmUnavailableException: Exception {
  override var reason: String { "AlarmKit needs iOS 26 or later" }
}
