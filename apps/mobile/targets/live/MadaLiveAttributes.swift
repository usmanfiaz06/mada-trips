import Foundation
#if canImport(ActivityKit)
import ActivityKit

// The lock-screen flight's data. KEEP IN STEP with modules/mada-live/ios/MadaLiveAttributes.swift (the app's copy: ActivityKit
// pairs the app's activity with the widget's view by this type's name) and with LiveFlightState in
// packages/shared/src/schemas/boarding.ts (the server pushes exactly these keys as "content-state").
@available(iOS 16.1, *)
public struct MadaLiveAttributes: ActivityAttributes {
  public struct Labels: Codable, Hashable {
    public var gate: String
    public var seat: String
    public var boards: String
    public var departs: String
  }

  public struct ContentState: Codable, Hashable {
    public var flight: String
    public var from: String
    public var to: String
    public var gate: String?
    public var seat: String?
    public var boards: String
    public var departs: String
    /// Seconds since 1970.
    public var departEpoch: Double
    public var arriveEpoch: Double
    /// on_time | delayed | boarding | gate_changed | departed | landed | cancelled
    public var status: String
    public var statusText: String
    public var delayMin: Int
    public var leave: String?
    public var leaveText: String?
    public var labels: Labels
    public var updatedEpoch: Double
  }

  public var tripId: String
  public var segmentId: String
  public var airline: String
  /// The airline's colour, "#0b6b52".
  public var brand: String
}
#endif
