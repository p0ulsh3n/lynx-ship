import { LynxLibraryProvider, LynxLibraryRegistry } from '@lynx/lynx';
import { LynxShipNotificationsModule } from './LynxShipNotificationsModule';

/** Registers the HarmonyOS Push Kit module through Lynx Autolink. */
export class LynxLibraryProviderImpl implements LynxLibraryProvider {
  register(registry: LynxLibraryRegistry): void {
    registry.registerModule('LynxShipNotifications', {
      moduleClass: LynxShipNotificationsModule,
    });
  }
}
