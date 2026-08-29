import { LynxLibraryProvider, LynxLibraryRegistry } from '@lynx/lynx';
import { LynxShipPermissionsModule } from './src/main/ets/LynxShipPermissionsModule';

export class LynxLibraryProviderImpl implements LynxLibraryProvider {
  register(registry: LynxLibraryRegistry): void {
    registry.registerModule('LynxShipPermissions', { moduleClass: LynxShipPermissionsModule });
  }
}
