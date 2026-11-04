package io.lony.app

import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/** Runs the JavaScript task registered in index.ts for one incoming SMS. */
class SmsHeadlessTaskService : HeadlessJsTaskService() {
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
    val extras = intent?.extras ?: return null
    // 60s is enough to save one message; allowed while the app is open too.
    return HeadlessJsTaskConfig("LonySmsReceived", Arguments.fromBundle(extras), 60_000, true)
  }
}
