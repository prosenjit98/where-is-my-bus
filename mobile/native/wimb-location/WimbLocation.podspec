require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name         = 'WimbLocation'
  s.version      = package['version']
  s.summary      = package['description']
  s.homepage     = 'https://example.com/where-is-my-bus'
  s.license      = { :type => 'UNLICENSED', :text => 'Private' }
  s.authors      = 'Where Is My Bus'
  s.platforms    = { :ios => '15.1' }
  s.source       = { :git => 'https://example.com/where-is-my-bus.git', :tag => s.version.to_s }
  s.source_files = 'ios/**/*.{h,m}'
  s.frameworks   = 'CoreLocation', 'UserNotifications', 'AudioToolbox'

  if respond_to?(:install_modules_dependencies, true)
    install_modules_dependencies(s)
  else
    s.dependency 'React-Core'
  end
end
