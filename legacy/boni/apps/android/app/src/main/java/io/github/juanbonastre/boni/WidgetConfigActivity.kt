package io.github.juanbonastre.boni

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONObject

/**
 * Which chart a new widget shows (also when a placed widget is reconfigured): the charts the app keeps on the
 * phone, as rows with their colour, in the app's look (graphite, 16 sp, 56 dp rows).
 */
class WidgetConfigActivity : Activity() {
    private var widgetId = AppWidgetManager.INVALID_APPWIDGET_ID

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setResult(RESULT_CANCELED)
        widgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            finish()
            return
        }
        val list = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(24), dp(16), dp(24))
        }
        list.addView(text(getString(R.string.widget_pick_title), 20f, Color.parseColor("#E9EAED"), bold = true).apply {
            setPadding(0, 0, 0, dp(16))
        })
        val charts = charts()
        if (charts.isEmpty()) {
            list.addView(text(getString(R.string.widget_no_charts), 16f, Color.parseColor("#8B8F99")))
        }
        for ((id, title, color) in charts) {
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                minimumHeight = dp(56)
                setPadding(dp(16), 0, dp(16), 0)
                background = GradientDrawable().apply {
                    setColor(Color.parseColor("#1D1E22"))
                    cornerRadius = dp(12).toFloat()
                    setStroke(dp(1), Color.parseColor("#25262B"))
                }
                isClickable = true
                setOnClickListener { pick(id) }
            }
            row.addView(TextView(this).apply {
                background = GradientDrawable().apply {
                    shape = GradientDrawable.OVAL
                    setColor(Color.parseColor(color ?: "#7B8CFF"))
                }
                layoutParams = LinearLayout.LayoutParams(dp(12), dp(12)).apply { marginEnd = dp(14) }
            })
            row.addView(text(title, 16f, Color.parseColor("#E9EAED")).apply {
                maxLines = 1
                ellipsize = android.text.TextUtils.TruncateAt.END
            })
            list.addView(row, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { bottomMargin = dp(8) })
        }
        setContentView(ScrollView(this).apply {
            setBackgroundColor(Color.parseColor("#16171A"))
            fitsSystemWindows = true
            addView(list, MATCH_PARENT, WRAP_CONTENT)
        })
    }

    private fun pick(chartId: String) {
        ChartWidget.setChart(this, widgetId, chartId)
        ChartWidget.show(this, widgetId, chartId, null, null)
        WidgetWorker.schedulePeriodic(this)
        WidgetWorker.refresh(this, 0)
        setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
        finish()
    }

    /** (id, title, colour) of the charts the page keeps (`charts.json` in the app's store). */
    private fun charts(): List<Triple<String, String, String?>> = try {
        val json = Shell.get(this).storeRead("charts.json") ?: return emptyList()
        val arr = JSONObject(json).getJSONArray("charts")
        (0 until arr.length()).map { i ->
            val c = arr.getJSONObject(i)
            Triple(
                c.getString("id"),
                c.optString("title", c.getString("id")),
                c.optString("color").takeIf { !c.isNull("color") && it.startsWith("#") },
            )
        }
    } catch (e: Exception) {
        emptyList()
    }

    private fun text(s: String, sp: Float, color: Int, bold: Boolean = false) = TextView(this).apply {
        text = s
        setTextSize(TypedValue.COMPLEX_UNIT_SP, sp)
        setTextColor(color)
        if (bold) setTypeface(typeface, android.graphics.Typeface.BOLD)
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
}
