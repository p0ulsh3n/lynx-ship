package com.lynxship.expo

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class LynxShipExpoModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("LynxShip")

        View(LynxShipExpoView::class) {
            Events("onReady", "onError", "onUpdate")

            Prop("bundle") { view: LynxShipExpoView, value: String? ->
                view.bundleName = value ?: "main.lynx.bundle"
            }

            Prop("initialData") { view: LynxShipExpoView, value: String? ->
                view.initialData = value ?: ""
            }

            Prop("reloadOnUpdate") { view: LynxShipExpoView, value: Boolean? ->
                view.reloadOnUpdate = value ?: true
            }

            AsyncFunction("reload") { view: LynxShipExpoView ->
                view.reload()
            }
        }
    }
}
