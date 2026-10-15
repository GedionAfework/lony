package io.lony.app.widget

import android.content.Context

object WidgetStore {
  private const val PREFS = "lony_widget"
  private const val NET = "net_worth"
  private const val SPENT = "spent"
  private const val CUR = "currency"

  fun save(ctx: Context, netWorth: String, spent: String, currency: String) {
    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putString(NET, netWorth)
      .putString(SPENT, spent)
      .putString(CUR, currency)
      .apply()
  }

  fun netWorth(ctx: Context): String =
    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(NET, "—") ?: "—"

  fun spent(ctx: Context): String =
    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(SPENT, "—") ?: "—"

  fun currency(ctx: Context): String =
    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(CUR, "") ?: ""
}
