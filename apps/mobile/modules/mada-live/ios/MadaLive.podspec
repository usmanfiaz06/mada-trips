Pod::Spec.new do |s|
  s.name           = 'MadaLive'
  s.version        = '1.0.0'
  s.summary        = 'The lock-screen flight for Mada Trips: ActivityKit and the home-screen widget data.'
  s.description    = s.summary
  s.author         = 'Mada Trips'
  s.homepage       = 'https://madatrips.sa'
  s.license        = { :type => 'UNLICENSED' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'SWIFT_COMPILATION_MODE' => 'wholemodule' }
  s.source_files = '**/*.{h,m,swift}'
end
