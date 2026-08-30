import ExpoModulesCore

public class LynxShipExpoModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LynxShip")
    View(LynxShipExpoView.self) {
      Events("onReady", "onLoadStart", "onResourceFetchStart", "onLoadSuccess", "onError", "onUpdate", "onShow", "onHide")
      Prop("bundle") { (view: LynxShipExpoView, value: String?) in
        view.setBundleName(value ?? "main.lynx.bundle")
      }
      Prop("initialData") { (view: LynxShipExpoView, value: String?) in
        view.setInitialData(value ?? "")
      }
      Prop("globalProps") { (view: LynxShipExpoView, value: [String: Any]?) in
        view.updateGlobalProps(value ?? [:])
      }
      Prop("autoGlobalProps") { (view: LynxShipExpoView, value: Bool?) in
        view.autoGlobalProps = value ?? true
      }
      Prop("reloadOnUpdate") { (view: LynxShipExpoView, value: Bool?) in
        view.reloadOnUpdate = value ?? true
      }
      AsyncFunction("reload") { (view: LynxShipExpoView) in
        try view.reload()
      }
      AsyncFunction("getContainerId") { (view: LynxShipExpoView) in
        view.getContainerId()
      }
      AsyncFunction("getLoadState") { (view: LynxShipExpoView) in
        view.getLoadState()
      }
      AsyncFunction("isLoadSuccess") { (view: LynxShipExpoView) in
        view.isLoadSuccess()
      }
      AsyncFunction("updateData") { (view: LynxShipExpoView, data: String, processorName: String?) in
        try view.updateData(data, processorName: processorName)
      }
      AsyncFunction("updateGlobalProps") { (view: LynxShipExpoView, props: [String: Any]) in
        view.updateGlobalProps(props)
      }
      AsyncFunction("updateGlobalPropsByIncrement") { (view: LynxShipExpoView, props: [String: Any]) in
        view.updateGlobalPropsByIncrement(props)
      }
      AsyncFunction("sendGlobalEvent") { (view: LynxShipExpoView, eventName: String, params: [Any]) in
        try view.sendGlobalEvent(eventName, params: params)
      }
      AsyncFunction("show") { (view: LynxShipExpoView) in
        view.show()
      }
      AsyncFunction("hide") { (view: LynxShipExpoView) in
        view.hide()
      }
      AsyncFunction("updateViewport") { (view: LynxShipExpoView, viewport: [String: Double]) in
        try view.updateViewport(viewport)
      }
    }
  }
}
