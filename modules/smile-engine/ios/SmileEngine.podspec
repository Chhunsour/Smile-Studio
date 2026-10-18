Pod::Spec.new do |s|
  s.name           = 'SmileEngine'
  s.version        = '1.0.0'
  s.summary        = 'Smile Studio native video helpers'
  s.description    = 'Native preview effects and video export for Smile Studio'
  s.author         = 'Smile Studio'
  s.homepage       = 'https://example.invalid/smile-studio'
  s.license        = { type: 'UNLICENSED' }
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
