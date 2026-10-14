package io.lony.app.widget

import com.facebook.react.TurboReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class WidgetPackage : TurboReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? {
    return if (name == LonyWidgetModule.NAME) LonyWidgetModule(reactContext) else null
  }

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider {
    return ReactModuleInfoProvider {
      mapOf(
        LonyWidgetModule.NAME to ReactModuleInfo(
          LonyWidgetModule.NAME,
          LonyWidgetModule::class.java.name,
          false,
          false,
          false,
          false,
        ),
      )
    }
  }
}
