package io.lony.app.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews
import io.lony.app.MainActivity
import io.lony.app.R

class LonyWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
    appWidgetIds.forEach { id -> update(context, appWidgetManager, id) }
  }

  companion object {
    fun refreshAll(context: Context) {
      val mgr = AppWidgetManager.getInstance(context)
      val ids = mgr.getAppWidgetIds(ComponentName(context, LonyWidgetProvider::class.java))
      ids.forEach { update(context, mgr, it) }
    }

    fun update(context: Context, mgr: AppWidgetManager, id: Int) {
      val views = RemoteViews(context.packageName, R.layout.lony_widget)
      val net = WidgetStore.netWorth(context)
      val spent = WidgetStore.spent(context)
      views.setTextViewText(R.id.widget_net, net)
      views.setTextViewText(R.id.widget_spent, context.getString(R.string.widget_spent_fmt, spent))
      views.setOnClickPendingIntent(R.id.widget_net, openApp(context, 10))
      views.setOnClickPendingIntent(R.id.btn_expense, quickAdd(context, "expense", 11))
      views.setOnClickPendingIntent(R.id.btn_income, quickAdd(context, "income", 12))
      mgr.updateAppWidget(id, views)
    }

    private fun openApp(context: Context, requestCode: Int): PendingIntent {
      val intent = Intent(context, MainActivity::class.java).apply {
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
      }
      return PendingIntent.getActivity(
        context,
        requestCode,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }

    private fun quickAdd(context: Context, kind: String, requestCode: Int): PendingIntent {
      val intent = Intent(Intent.ACTION_VIEW, Uri.parse("lony://quick-add?kind=$kind")).apply {
        setClass(context, MainActivity::class.java)
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
      }
      return PendingIntent.getActivity(
        context,
        requestCode,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }
  }
}
