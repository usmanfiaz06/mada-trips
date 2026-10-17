import SwiftUI
import WidgetKit

// Everything this extension draws: the next trip on the home screen, and the flight on the lock screen.
@main
struct MadaWidgets: WidgetBundle {
  var body: some Widget {
    NextTripWidget()
    MadaLiveActivity()
  }
}
