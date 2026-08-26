import ExpoModulesCore

public class LynxShipExpoModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LynxShip")
    View(LynxShipExpoView.self) {
      Events("onReady", "onError", "onUpdate")
      Prop("bundle") { (view: LynxShipExpoView, value: String?) in
        view.bundleName = value ?? "main.lynx.bundle"
      }
      Prop("initialData") { (view: LynxShipExpoView, value: String?) in
        view.initialData = value ?? ""
      }
      Prop("reloadOnUpdate") { (view: LynxShipExpoView, value: Bool?) in
        view.reloadOnUpdate = value ?? true
      }
      AsyncFunction("reload") { (view: LynxShipExpoView) in
        try view.reload()
      }
    }
  }
}
