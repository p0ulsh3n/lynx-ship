require 'json'

package_json_path = File.join(__dir__, '..', 'package.json')
raise 'LynxShip notifications package.json is missing' unless File.file?(package_json_path)

package_version = JSON.parse(File.read(package_json_path))['version']
raise 'LynxShip notifications package.json does not define a version' unless package_version

Pod::Spec.new do |s|
  s.name = 'LynxShipNotifications'
  s.version = package_version
  s.summary = 'Direct APNs notification bridge for pure Lynx applications.'
  s.license = { :type => 'MIT' }
  s.author = { 'LynxShip' => 'opensource@lynxship.dev' }
  s.source = { :path => '.' }
  s.source_files = '**/*.{h,m,mm,swift}'
  s.exclude_files = 'NotificationServiceExtension/**/*'
  s.platform = :ios, '15.0'
  s.requires_arc = true
  s.dependency 'Lynx', :subspecs => ['Framework']
  s.frameworks = 'UserNotifications'
end
