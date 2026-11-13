package io.github.juanbonastre.boni

/**
 * Whether Boni's window is one of Android's bubbles: Boni's circle on the phone (task 115, F9; Juan, 2026-11-13:
 * «A, la burbuja»). Android 17 floats any app as a bubble from its icon (touch and hold, then the bubble) and gives
 * no API to ask about it, so the window says it: a bubble's task is a multi-window one kept always on top, which a
 * split screen or a desktop window is not (a picture-in-picture is always on top but has its own mode). Android's
 * own flag for an activity a bubble started (`isLaunchedFromBubble`) counts too.
 */
object Bubble {
    /** [config] is the activity's configuration as Android writes it (its `winConfig={…}` part tells the window). */
    fun isBubble(launchedFromBubble: Boolean, config: String): Boolean {
        if (launchedFromBubble) return true
        val window = config.substringAfter("winConfig=", "")
        return window.contains("mWindowingMode=multi-window") && window.contains("mAlwaysOnTop=on")
    }
}
