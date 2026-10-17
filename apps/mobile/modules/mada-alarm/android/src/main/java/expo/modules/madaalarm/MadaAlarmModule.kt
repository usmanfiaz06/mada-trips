package expo.modules.madaalarm

import android.content.ActivityNotFoundException
import android.content.Intent
import android.provider.AlarmClock
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/*
 * The wake-up alarm before a flight, on Android: a real alarm in the person's Clock app through the AlarmClock
 * intents. EXTRA_HOUR and EXTRA_MINUTES must be Ints (the Clock app reads getIntExtra), which is why this is native
 * rather than a JS intent launcher, where numbers cross the bridge as doubles. EXTRA_SKIP_UI is false: the Clock app
 * shows the alarm and the person confirms it. We can't read back whether they did, or change it later.
 */
class MadaAlarmModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MadaAlarm")

    Function("isAlarmKitAvailable") { false }
    AsyncFunction("authorizationState") { "unavailable" }
    AsyncFunction("requestAuthorization") { "unavailable" }

    /** Opens the Clock app's new-alarm screen filled in: true when a Clock app took it. */
    AsyncFunction("setClockAlarm") { hour: Int, minute: Int, label: String, skipUi: Boolean ->
      launch(
        Intent(AlarmClock.ACTION_SET_ALARM)
          .putExtra(AlarmClock.EXTRA_HOUR, hour)
          .putExtra(AlarmClock.EXTRA_MINUTES, minute)
          .putExtra(AlarmClock.EXTRA_MESSAGE, label)
          .putExtra(AlarmClock.EXTRA_VIBRATE, true)
          .putExtra(AlarmClock.EXTRA_SKIP_UI, skipUi)
      )
    }

    /**
     * Asks the Clock app to dismiss the alarm with this label (API 23+). Clock apps differ: some dismiss it, some only
     * show their list. False when no Clock app handles it.
     */
    AsyncFunction("dismissClockAlarm") { label: String ->
      launch(
        Intent(AlarmClock.ACTION_DISMISS_ALARM)
          .putExtra(AlarmClock.EXTRA_ALARM_SEARCH_MODE, AlarmClock.ALARM_SEARCH_MODE_LABEL)
          .putExtra(AlarmClock.EXTRA_MESSAGE, label)
      )
    }

    /** The Clock app's list of alarms. */
    AsyncFunction("showClockAlarms") { launch(Intent(AlarmClock.ACTION_SHOW_ALARMS)) }

    AsyncFunction("schedule") { _: String, _: Double, _: String, _: String -> "" }
    AsyncFunction("cancel") { _: String -> }
  }

  private fun launch(intent: Intent): Boolean {
    val activity = appContext.currentActivity
    return try {
      if (activity != null) {
        activity.startActivity(intent)
      } else {
        val context = appContext.reactContext ?: return false
        context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      }
      true
    } catch (e: ActivityNotFoundException) {
      false
    } catch (e: SecurityException) {
      false
    }
  }
}
