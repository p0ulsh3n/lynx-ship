require 'json'

package_json_path = File.join(__dir__, '..', 'package.json')
package_version = JSON.parse(File.read(package_json_path))['version']

Pod::Spec.new do |s|
  s.name = 'LynxShipBridge'
  s.version = package_version
  s.summary = 'Validated native bridge transport for Lynx applications.'
  s.license = { :type => 'MIT' }
  s.source = { :path => '.' }
  s.source_files = '**/*.{h,m,mm,swift}'
  s.platform = :ios, '15.0'
  s.requires_arc = true
  s.dependency 'Lynx', :subspecs => ['Framework']
end
