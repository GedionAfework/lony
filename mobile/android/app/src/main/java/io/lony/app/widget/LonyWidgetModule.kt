package io.lony.app.widget

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule

@ReactModule(name = LonyWidgetModule.NAME)
class LonyWidgetModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = NAME

  @ReactMethod
  fun updateSnapshot(netWorth: String, spent: String, currency: String, promise: Promise) {
    try {
      WidgetStore.save(reactApplicationContext, netWorth, spent, currency)
      LonyWidgetProvider.refreshAll(reactApplicationContext)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("WIDGET_UPDATE", e)
    }
  }

  companion object {
    const val NAME = "LonyWidget"
  }
}
