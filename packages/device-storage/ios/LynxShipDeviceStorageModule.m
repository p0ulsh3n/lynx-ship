#import "LynxShipDeviceStorageModule.h"

static NSString *const LynxShipDeviceStorageSuite = @"com.lynxship.device-storage";

@implementation LynxShipDeviceStorageModule

+ (NSString *)name { return @"LynxShipDeviceStorage"; }

+ (NSDictionary<NSString *, NSString *> *)methodLookup {
  return @{
    @"getItem": NSStringFromSelector(@selector(getItem:callback:)),
    @"setItem": NSStringFromSelector(@selector(setItem:value:callback:)),
    @"removeItem": NSStringFromSelector(@selector(removeItem:callback:)),
    @"clear": NSStringFromSelector(@selector(clear:)),
  };
}

- (void)getItem:(NSString *)key callback:(void (^)(NSString * _Nullable))callback {
  NSDictionary *domain = [[NSUserDefaults standardUserDefaults] persistentDomainForName:LynxShipDeviceStorageSuite];
  callback([domain[key] isKindOfClass:NSString.class] ? domain[key] : nil);
}

- (void)setItem:(NSString *)key value:(NSString *)value callback:(void (^)(BOOL))callback {
  NSUserDefaults *defaults = [NSUserDefaults standardUserDefaults];
  NSMutableDictionary *domain = [[[defaults persistentDomainForName:LynxShipDeviceStorageSuite] mutableCopy] ?: [NSMutableDictionary dictionary] mutableCopy];
  domain[key] = value;
  [defaults setPersistentDomain:domain forName:LynxShipDeviceStorageSuite];
  callback(YES);
}

- (void)removeItem:(NSString *)key callback:(void (^)(BOOL))callback {
  NSUserDefaults *defaults = [NSUserDefaults standardUserDefaults];
  NSMutableDictionary *domain = [[[defaults persistentDomainForName:LynxShipDeviceStorageSuite] mutableCopy] ?: [NSMutableDictionary dictionary] mutableCopy];
  [domain removeObjectForKey:key];
  [defaults setPersistentDomain:domain forName:LynxShipDeviceStorageSuite];
  callback(YES);
}

- (void)clear:(void (^)(BOOL))callback {
  [[NSUserDefaults standardUserDefaults] removePersistentDomainForName:LynxShipDeviceStorageSuite];
  callback(YES);
}

@end
