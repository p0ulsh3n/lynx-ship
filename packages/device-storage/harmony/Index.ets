import { LynxLibraryProvider, LynxLibraryRegistry } from '@lynx/lynx';
import { LynxShipDeviceStorageModule } from './src/main/ets/LynxShipDeviceStorageModule';

export class LynxLibraryProviderImpl implements LynxLibraryProvider {
  register(registry: LynxLibraryRegistry): void {
    registry.registerModule('LynxShipDeviceStorage', { moduleClass: LynxShipDeviceStorageModule });
  }
}
