require 'json'
package_version = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))['version']

Pod::Spec.new do |s|
  s.name = 'LynxShipMedia'
  s.version = package_version
  s.summary = 'System media picker bridge for Lynx applications.'
  s.license = { :type => 'MIT' }
  s.source = { :path => '.' }
  s.source_files = '**/*.{h,m,mm,swift}'
  s.platform = :ios, '15.0'
  s.requires_arc = true
  s.dependency 'Lynx', :subspecs => ['Framework']
  s.frameworks = 'AVFoundation', 'PhotosUI', 'UIKit'
end
