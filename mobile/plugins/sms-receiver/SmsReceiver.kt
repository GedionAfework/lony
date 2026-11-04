package io.lony.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import com.facebook.react.HeadlessJsTaskService

/**
 * Hands each incoming SMS to the app's JavaScript (task "LonySmsReceived"), so bank
 * transfers are saved and notified even when the app is closed. Long messages arrive in
 * parts; parts from the same sender are joined back into one message.
 */
class SmsReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
    val parts = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
    val bodies = LinkedHashMap<String, StringBuilder>()
    val dates = HashMap<String, Long>()
    for (part in parts) {
      if (part == null) continue
      val from = part.originatingAddress ?: ""
      bodies.getOrPut(from) { StringBuilder() }.append(part.messageBody ?: "")
      dates[from] = part.timestampMillis
    }
    for ((from, body) in bodies) {
      val task = Intent(context, SmsHeadlessTaskService::class.java).apply {
        putExtra("address", from)
        putExtra("body", body.toString())
        putExtra("date", (dates[from] ?: System.currentTimeMillis()).toString())
      }
      try {
        context.startService(task)
        HeadlessJsTaskService.acquireWakeLockNow(context)
      } catch (_: Exception) {
        // Background start refused: the next time the app opens, the inbox sync picks it up.
      }
    }
  }
}
