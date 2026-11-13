package io.github.juanbonastre.boni

/**
 * Whether Boni's window is one of Android's bubbles: Boni's circle on the phone (task 115, F9; Juan, 2026-11-13:
 * «A, la burbuja»). Android 17 floats any app as a bubble from its icon (touch and hold, then the bubble) and gives
 * no API to ask about it, so the window says it. On Juan's phone (2026-11-13) a bubble is a multi-window task that
 * is narrower and shorter than the screen (997 × 1794 of 1080 × 2424, inset on every side) and not kept on top; a
 * split screen is multi-window too but always takes the screen's whole width or whole height, and a desktop window
 * or a picture-in-picture have modes of their own. A multi-window task kept always on top, or Android's own flag for
 * an activity a bubble started (`isLaunchedFromBubble`), count too.
 */
object Bubble {
    /** [config] is the activity's configuration as Android writes it (its `winConfig={…}` part tells the window). */
    fun isBubble(launchedFromBubble: Boolean, config: String): Boolean {
        if (launchedFromBubble) return true
        val window = config.substringAfter("winConfig=", "")
        if (!window.contains("mWindowingMode=multi-window")) return false
        if (window.contains("mAlwaysOnTop=on")) return true
        val bounds = size(window, "mBounds") ?: return false
        val screen = size(window, "mMaxBounds") ?: return false
        return bounds.first in 1 until screen.first && bounds.second in 1 until screen.second
    }

    /** The width and height of the rectangle [name] (`mBounds`, `mMaxBounds`: neither is part of another's name). */
    private fun size(window: String, name: String): Pair<Int, Int>? {
        val m = Regex("""$name=Rect\((-?\d+), (-?\d+) - (-?\d+), (-?\d+)\)""").find(window) ?: return null
        val (left, top, right, bottom) = m.destructured
        return Pair(right.toInt() - left.toInt(), bottom.toInt() - top.toInt())
    }
}
