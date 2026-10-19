package io.github.juanbonastre.boni

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import org.json.JSONArray
import org.json.JSONObject

/**
 * Home-screen shortcuts (pinned by the user from the app) and the menu of the app's icon. Generic, like the page's
 * shortcuts: each entry only says what it opens ("shortcut:<id>", "chart:<id>"); the page decides what that means.
 */
object Launcher {
    const val EXTRA_TARGET = "target"
    private const val PREFIX = "boni:"
    private val TARGET = Regex("^(shortcut|chart):[A-Za-z0-9_.-]{1,80}$")

    /** A target the page may ask for (the launcher hands it back to the app as is). */
    fun valid(target: String): Boolean = TARGET.matches(target)

    /** The launcher's id of an entry, and back. */
    fun idOf(target: String) = PREFIX + target
    fun targetOf(id: String): String? = id.removePrefix(PREFIX).takeIf { id.startsWith(PREFIX) && valid(it) }

    /** The letter on an entry's icon: the first letter or digit of its name. */
    fun initial(label: String): String =
        label.firstOrNull { it.isLetterOrDigit() }?.uppercaseChar()?.toString() ?: "B"

    private fun info(context: Context, entry: JSONObject, rank: Int = 0): ShortcutInfoCompat? {
        val target = entry.optString("target")
        if (!valid(target)) return null
        val label = entry.optString("label").trim().ifEmpty { "Boni" }.take(40)
        val color = entry.optString("color").takeIf { !entry.isNull("color") && it.matches(Regex("^#[0-9a-fA-F]{6}$")) }
        val intent = Intent(context, MainActivity::class.java)
            .setAction(Intent.ACTION_VIEW)
            .putExtra(EXTRA_TARGET, target)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        return ShortcutInfoCompat.Builder(context, idOf(target))
            .setShortLabel(label)
            .setLongLabel(label)
            .setIcon(IconCompat.createWithAdaptiveBitmap(icon(label, color, target.startsWith("chart:"))))
            .setIntent(intent)
            .setRank(rank)
            .build()
    }

    /** Asks the launcher to pin an entry; false when it cannot (the user still confirms in the launcher). */
    fun pin(context: Context, entry: JSONObject): Boolean {
        if (!ShortcutManagerCompat.isRequestPinShortcutSupported(context)) return false
        val info = info(context, entry) ?: return false
        return ShortcutManagerCompat.requestPinShortcut(context, info, null)
    }

    /**
     * Every shortcut and chart: pinned entries get their current name and icon, those whose target is gone are
     * disabled (the launcher greys them out), and the first `menu` show when the app's icon is held.
     */
    fun setTargets(context: Context, entries: JSONArray, menu: Int) {
        val infos = (0 until entries.length()).mapNotNull { i -> entries.optJSONObject(i)?.let { info(context, it, i) } }
        val ids = infos.map { it.id }.toSet()
        val max = ShortcutManagerCompat.getMaxShortcutCountPerActivity(context)
        ShortcutManagerCompat.setDynamicShortcuts(context, infos.take(minOf(menu, max)))
        val pinned = ShortcutManagerCompat.getShortcuts(context, ShortcutManagerCompat.FLAG_MATCH_PINNED)
        val pinnedIds = pinned.map { it.id }.toSet()
        infos.filter { it.id in pinnedIds }.takeIf { it.isNotEmpty() }?.let { ShortcutManagerCompat.updateShortcuts(context, it) }
        val gone = pinned.map { it.id }.filter { it.startsWith(PREFIX) && it !in ids }
        if (gone.isNotEmpty()) ShortcutManagerCompat.disableShortcuts(context, gone, "Ya no existe")
        // A target that comes back (Undo after a deletion) works again.
        infos.filter { it.id in pinnedIds }.map { it.id }.takeIf { it.isNotEmpty() }?.let {
            ShortcutManagerCompat.enableShortcuts(context, infos.filter { s -> s.id in it })
        }
    }

    /** A round icon in the entry's colour with its initial (charts get a small bar mark under it). */
    private fun icon(label: String, color: String?, chart: Boolean): Bitmap {
        val size = 216 // adaptive icon: 108 dp at 2x; the visible part is the middle 66 %
        val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        c.drawColor(Color.parseColor(color ?: "#7B8CFF"))
        val text = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            this.color = Color.WHITE
            textAlign = Paint.Align.CENTER
            textSize = size * 0.30f
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        }
        val y = size / 2f - (text.descent() + text.ascent()) / 2 - if (chart) size * 0.04f else 0f
        c.drawText(initial(label), size / 2f, y, text)
        if (chart) {
            val bar = Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = Color.WHITE }
            val base = size * 0.70f
            val w = size * 0.035f
            listOf(0.05f, 0.09f, 0.065f).forEachIndexed { i, h ->
                val x = size / 2f + (i - 1) * w * 2.2f
                c.drawRoundRect(x - w / 2, base - size * h, x + w / 2, base, w / 2, w / 2, bar)
            }
        }
        return bmp
    }
}
