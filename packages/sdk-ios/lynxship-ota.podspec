Pod::Spec.new do |s|
  s.name = 'LynxShipOta'
  s.version = '0.1.0'
  s.summary = 'Native iOS OTA client for LynxShip hosts.'
  s.license = { :type => 'MIT' }
  s.author = { 'LynxShip' => 'opensource@lynxship.dev' }
  s.source = { :path => '.' }
  s.source_files = 'Sources/**/*.{h,m,mm,swift}'
  s.platform = :ios, '15.0'
  s.swift_version = '5.9'
end
