package com.lynxship.expo

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class LynxShipExpoModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("LynxShip")

        View(LynxShipExpoView::class) {
            Events("onReady", "onLoadStart", "onResourceFetchStart", "onLoadSuccess", "onError", "onUpdate", "onShow", "onHide")

            Prop("bundle") { view: LynxShipExpoView, value: String? ->
                view.setBundleName(value ?: "main.lynx.bundle")
            }

            Prop("initialData") { view: LynxShipExpoView, value: String? ->
                view.setInitialData(value ?: "")
            }

            Prop("globalProps") { view: LynxShipExpoView, value: Map<String, Any?>? ->
                view.updateGlobalProps(value ?: emptyMap())
            }

            Prop("autoGlobalProps") { view: LynxShipExpoView, value: Boolean? ->
                view.autoGlobalProps = value ?: true
            }

            Prop("reloadOnUpdate") { view: LynxShipExpoView, value: Boolean? ->
                view.reloadOnUpdate = value ?: true
            }

            AsyncFunction("reload") { view: LynxShipExpoView ->
                view.reload()
            }

            AsyncFunction("getContainerId") { view: LynxShipExpoView ->
                view.getContainerId()
            }

            AsyncFunction("getLoadState") { view: LynxShipExpoView ->
                view.getLoadState()
            }

            AsyncFunction("isLoadSuccess") { view: LynxShipExpoView ->
                view.isLoadSuccess()
            }

            AsyncFunction("updateData") { view: LynxShipExpoView, data: String, processorName: String? ->
                view.updateData(data, processorName)
            }

            AsyncFunction("updateGlobalProps") { view: LynxShipExpoView, props: Map<String, Any?> ->
                view.updateGlobalProps(props)
            }

            AsyncFunction("updateGlobalPropsByIncrement") { view: LynxShipExpoView, props: Map<String, Any?> ->
                view.updateGlobalPropsByIncrement(props)
            }

            AsyncFunction("sendGlobalEvent") { view: LynxShipExpoView, eventName: String, params: List<Any?> ->
                view.sendGlobalEvent(eventName, params)
            }

            AsyncFunction("show") { view: LynxShipExpoView -> view.show() }

            AsyncFunction("hide") { view: LynxShipExpoView -> view.hide() }

            AsyncFunction("updateViewport") { view: LynxShipExpoView, viewport: Map<String, Double> ->
                view.updateViewport(viewport["width"] ?: 0.0, viewport["height"] ?: 0.0)
            }

            OnViewDestroys { view: LynxShipExpoView ->
                view.release()
            }
        }
    }
}
