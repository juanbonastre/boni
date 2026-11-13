package io.github.juanbonastre.boni

import java.io.File
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Boni's circle on the phone is Android's bubble (task 115, I-38; Juan, 2026-11-13: «A, la burbuja»). */
class BubbleTest {
    private val screen = "Rect(0, 0 - 1080, 2424)"

    private fun config(mode: String, onTop: String, bounds: String = screen, max: String = screen) =
        "{1.0 ?mcc0mnc [es_ES] ldltr sw411dp w411dp h842dp 420dpi nrml long port finger -keyb/v/h -nav/h " +
            "winConfig={ mBounds=$bounds mAppBounds=$bounds mMaxBounds=$max mDisplayRotation=ROTATION_0 " +
            "mWindowingMode=$mode mActivityType=standard mAlwaysOnTop=$onTop mRotation=ROTATION_0} s.6 " +
            "fontWeightAdjustment=0}"

    @Test
    fun aBubbleIsAMultiWindowTaskSmallerThanTheScreenEveryWay() {
        // As Juan's phone wrote it (2026-11-13): a bubble opened from Boni's icon, not kept on top.
        assertTrue(Bubble.isBubble(false, config("multi-window", "undefined", "Rect(42, 385 - 1039, 2179)")))
        assertTrue(Bubble.isBubble(false, config("multi-window", "on")))
        assertTrue(Bubble.isBubble(true, config("fullscreen", "undefined")))
    }

    @Test
    fun theFullScreenASplitScreenADesktopWindowAndAPictureInPictureAreNot() {
        assertFalse(Bubble.isBubble(false, config("fullscreen", "undefined")))
        assertFalse(Bubble.isBubble(false, config("undefined", "undefined", "Rect(42, 385 - 1039, 2179)")))
        // A split screen takes the whole width (upright) or the whole height (on its side).
        assertFalse(Bubble.isBubble(false, config("multi-window", "undefined", "Rect(0, 0 - 1080, 1194)")))
        assertFalse(Bubble.isBubble(false, config("multi-window", "undefined", "Rect(0, 1230 - 1080, 2424)")))
        assertFalse(
            Bubble.isBubble(
                false,
                config("multi-window", "undefined", "Rect(0, 0 - 1194, 1080)", "Rect(0, 0 - 2424, 1080)"),
            ),
        )
        assertFalse(Bubble.isBubble(false, config("multi-window", "off")))
        assertFalse(Bubble.isBubble(false, config("freeform", "off", "Rect(42, 385 - 1039, 2179)")))
        assertFalse(Bubble.isBubble(false, config("pinned", "on", "Rect(600, 1800 - 1040, 2100)")))
        assertFalse(Bubble.isBubble(false, "{1.0 ?mcc0mnc [es_ES] sw411dp}"))
    }

    /** I-38: the circle asks for no permission to draw over other apps and keeps no notification of its own. */
    @Test
    fun theCircleNeedsNoOverlayNorAForegroundService() {
        val manifest = File("src/main/AndroidManifest.xml").readText()
        assertFalse(manifest.contains("SYSTEM_ALERT_WINDOW"))
        assertFalse(manifest.contains("FOREGROUND_SERVICE"))
        // A bubble is a resizable window: the activity must never refuse it.
        assertFalse(manifest.contains("resizeableActivity=\"false\""))
    }
}
