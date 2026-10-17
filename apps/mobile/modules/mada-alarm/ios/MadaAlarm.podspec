Pod::Spec.new do |s|
  s.name           = 'MadaAlarm'
  s.version        = '0.1.0'
  s.summary        = 'The wake-up alarm before a flight: AlarmKit on iOS 26+, nothing on older iOS.'
  s.description    = 'A small local Expo module for Mada Trips. Schedules and cancels one-time alarms with AlarmKit.'
  s.license        = 'UNLICENSED'
  s.author         = 'Mada Trips'
  s.homepage       = 'https://madatrips.sa'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # Weak, so the app still launches on iOS before 26 where AlarmKit does not exist.
  s.weak_frameworks = 'AlarmKit'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
