package io.github.juanbonastre.boni

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.os.Bundle
import android.view.View
import android.widget.RemoteViews

/**
 * A home-screen widget: the picture of one chart, the same card as in the app (drawn by the web page off screen,
 * WidgetRenderer). A tap opens that chart in Boni. Refreshed when the app comes to the front, when the server says
 * the data changed while it is open, after the offline queue was sent, and every 30 minutes (WidgetWorker).
 */
class ChartWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        WidgetWorker.refresh(context)
    }

    override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, options: Bundle) {
        WidgetWorker.refresh(context) // a new size: a new picture
    }

    override fun onEnabled(context: Context) {
        WidgetWorker.schedulePeriodic(context)
    }

    override fun onDisabled(context: Context) {
        WidgetWorker.cancelPeriodic(context)
    }

    override fun onDeleted(context: Context, ids: IntArray) {
        val edit = prefs(context).edit()
        for (id in ids) edit.remove("chart_$id")
        edit.apply()
    }

    companion object {
        fun prefs(context: Context) = context.getSharedPreferences("widgets", Context.MODE_PRIVATE)

        fun chartOf(context: Context, id: Int): String? = prefs(context).getString("chart_$id", null)

        fun setChart(context: Context, id: Int, chartId: String) {
            prefs(context).edit().putString("chart_$id", chartId).apply()
        }

        fun ids(context: Context): IntArray =
            AppWidgetManager.getInstance(context).getAppWidgetIds(ComponentName(context, ChartWidget::class.java))

        /** The widget's size in pixels (portrait: the minimum width, the maximum height, as launchers report). */
        fun sizePx(context: Context, id: Int): Pair<Int, Int> {
            val o = AppWidgetManager.getInstance(context).getAppWidgetOptions(id)
            val d = context.resources.displayMetrics.density
            val w = o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 250).coerceAtLeast(110)
            val h = o.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 180).coerceAtLeast(80)
            return (w * d).toInt() to (h * d).toInt()
        }

        /** Shows a picture (or a short text while there is none) and opens the chart on a tap. */
        fun show(context: Context, id: Int, chartId: String?, picture: Bitmap?, text: String?) {
            val views = RemoteViews(context.packageName, R.layout.widget_chart)
            if (picture != null) {
                views.setImageViewBitmap(R.id.widget_picture, picture)
                views.setViewVisibility(R.id.widget_picture, View.VISIBLE)
                views.setViewVisibility(R.id.widget_text, View.GONE)
            } else {
                views.setTextViewText(R.id.widget_text, text ?: context.getString(R.string.widget_loading))
                views.setViewVisibility(R.id.widget_picture, View.GONE)
                views.setViewVisibility(R.id.widget_text, View.VISIBLE)
            }
            val intent = Intent(context, MainActivity::class.java)
                .setAction("io.github.juanbonastre.boni.WIDGET_$id")
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            if (chartId != null) intent.putExtra(Launcher.EXTRA_TARGET, "chart:$chartId")
            views.setOnClickPendingIntent(
                R.id.widget_root,
                PendingIntent.getActivity(context, id, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE),
            )
            AppWidgetManager.getInstance(context).updateAppWidget(id, views)
        }
    }
}
