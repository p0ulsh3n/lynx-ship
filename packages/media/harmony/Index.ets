import { LynxLibraryProvider, LynxLibraryRegistry } from '@lynx/lynx';
import { LynxShipMediaModule } from './src/main/ets/LynxShipMediaModule';

export class LynxLibraryProviderImpl implements LynxLibraryProvider {
  register(registry: LynxLibraryRegistry): void {
    registry.registerModule('LynxShipMedia', { moduleClass: LynxShipMediaModule });
  }
}
