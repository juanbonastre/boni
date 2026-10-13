package io.github.juanbonastre.boni.desktop

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.ImageComposeScene
import androidx.compose.ui.unit.Density
import io.github.juanbonastre.boni.ui.charts.LocalAnimateCharts
import org.jetbrains.skia.EncodedImageFormat
import java.io.File

/**
 * Renders composable content to a PNG without a window ([width] x [height] in dp, at 2x), charts in their final state.
 * The background stays transparent where nothing is drawn (rounded card corners). Used by the screenshots and by the
 * Cinnamon desklet export.
 */
object Png {
    fun render(file: File, width: Int, height: Int, content: @Composable () -> Unit) {
        val scene = ImageComposeScene(width * 2, height * 2, density = Density(2f)) {
            CompositionLocalProvider(LocalAnimateCharts provides false) { content() }
        }
        try {
            scene.render(0)
            val image = scene.render(1_000_000_000L)
            val bytes = requireNotNull(image.encodeToData(EncodedImageFormat.PNG)).bytes
            file.parentFile?.mkdirs()
            // Write then rename: the desklet never reads a half-written picture.
            val tmp = File(file.parentFile, ".${file.name}.tmp")
            tmp.writeBytes(bytes)
            if (!tmp.renameTo(file)) {
                file.delete()
                tmp.renameTo(file)
            }
        } finally {
            scene.close()
        }
    }
}
