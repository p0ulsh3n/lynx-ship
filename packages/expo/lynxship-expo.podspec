Pod::Spec.new do |s|
  s.name = 'LynxShipExpo'
  s.version = '0.1.0'
  s.summary = 'Expo native LynxView integration for LynxShip.'
  s.license = { :type => 'MIT' }
  s.author = { 'LynxShip' => 'opensource@lynxship.dev' }
  s.source = { :path => '.' }
  s.source_files = 'ios/**/*.{h,m,mm,swift}'
  s.platform = :ios, '15.0'
  s.swift_version = '5.9'
  s.dependency 'ExpoModulesCore'
  s.dependency 'LynxShipOta'
  lynx_version = ENV['LYNXSHIP_LYNX_VERSION']
  if lynx_version && !lynx_version.empty? && lynx_version != 'auto' && lynx_version != 'latest'
    s.dependency 'Lynx', lynx_version, :subspecs => ['Framework']
    s.dependency 'PrimJS', lynx_version, :subspecs => ['quickjs', 'napi']
    s.dependency 'LynxService', lynx_version, :subspecs => ['Image', 'Log', 'Http']
  else
    s.dependency 'Lynx', :subspecs => ['Framework']
    s.dependency 'PrimJS', :subspecs => ['quickjs', 'napi']
    s.dependency 'LynxService', :subspecs => ['Image', 'Log', 'Http']
  end
  s.dependency 'SDWebImage', '5.15.5'
  s.dependency 'SDWebImageWebPCoder', '0.11.0'
end
