package io.github.juanbonastre.boni.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/**
 * Chart colors: the validated default data-viz palette (categorical slots 1-2, light and dark steps chosen for each
 * surface; checked with the palette validator: CVD and contrast pass in both modes). Each chart has one series, so the
 * hue is not identity: blue for spending, orange for eating out.
 */
@Immutable
data class BoniColors(
    val dark: Boolean,
    val page: Color,
    val surface: Color,
    val ink: Color,
    val inkSecondary: Color,
    val muted: Color,
    val grid: Color,
    val baseline: Color,
    val border: Color,
    val series1: Color,
    val series2: Color,
    /** Selected chips and toggles: a step of the blue ramp. */
    val selection: Color,
    val onSelection: Color,
    val good: Color,
    val critical: Color,
)

val LightColors = BoniColors(
    dark = false,
    page = Color(0xFFF9F9F7), surface = Color(0xFFFCFCFB), ink = Color(0xFF0B0B0B), inkSecondary = Color(0xFF52514E),
    muted = Color(0xFF898781), grid = Color(0xFFE1E0D9), baseline = Color(0xFFC3C2B7), border = Color(0x1A0B0B0B),
    series1 = Color(0xFF2A78D6), series2 = Color(0xFFEB6834),
    selection = Color(0xFFCDE2FB), onSelection = Color(0xFF0D366B), good = Color(0xFF006300), critical = Color(0xFFD03B3B),
)

val DarkColors = BoniColors(
    dark = true,
    page = Color(0xFF0D0D0D), surface = Color(0xFF1A1A19), ink = Color(0xFFF0EFEC), inkSecondary = Color(0xFFC3C2B7),
    muted = Color(0xFF898781), grid = Color(0xFF2C2C2A), baseline = Color(0xFF383835), border = Color(0x1AFFFFFF),
    series1 = Color(0xFF3987E5), series2 = Color(0xFFD95926),
    selection = Color(0xFF184F95), onSelection = Color(0xFFF0EFEC), good = Color(0xFF0CA30C), critical = Color(0xFFD03B3B),
)

val LocalBoniColors = staticCompositionLocalOf { LightColors }

/** Accent of a chart by id: stable per chart (color follows the entity, never its position). */
fun BoniColors.accentFor(chartId: String): Color = if (chartId == "eating-out") series2 else series1

@Composable
fun BoniTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    val c = if (dark) DarkColors else LightColors
    val scheme = if (dark) {
        darkColorScheme(
            primary = c.series1, onPrimary = Color.White, primaryContainer = c.selection, onPrimaryContainer = c.onSelection,
            secondary = c.series1, onSecondary = Color.White, secondaryContainer = c.selection, onSecondaryContainer = c.onSelection,
            tertiary = c.series2, surfaceTint = Color.Transparent, surfaceVariant = c.grid, background = c.page, surface = c.surface,
            onSurface = c.ink, onBackground = c.ink, onSurfaceVariant = c.inkSecondary,
            outline = c.baseline, error = c.critical,
        )
    } else {
        lightColorScheme(
            primary = c.series1, onPrimary = Color.White, primaryContainer = c.selection, onPrimaryContainer = c.onSelection,
            secondary = c.series1, onSecondary = Color.White, secondaryContainer = c.selection, onSecondaryContainer = c.onSelection,
            tertiary = c.series2, surfaceTint = Color.Transparent, surfaceVariant = c.grid, background = c.page, surface = c.surface,
            onSurface = c.ink, onBackground = c.ink, onSurfaceVariant = c.inkSecondary,
            outline = c.baseline, error = c.critical,
        )
    }
    CompositionLocalProvider(LocalBoniColors provides c) {
        MaterialTheme(colorScheme = scheme, content = content)
    }
}
