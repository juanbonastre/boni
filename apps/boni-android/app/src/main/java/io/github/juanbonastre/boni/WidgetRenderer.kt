package io.github.juanbonastre.boni

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.view.View
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat

/**
 * Draws one chart as a picture: the app's own page (`?picture=<chart id>`) in a WebView that is never shown, sized to
 * the widget. The page draws the card from the device's last copy and then the server's, and says when it is ready
 * (`pictureReady`); a time limit takes the picture anyway. Main thread only.
 */
class WidgetRenderer(private val context: Context) {
    private val main = Handler(Looper.getMainLooper())

    @SuppressLint("SetJavaScriptEnabled")
    fun render(chartId: String, width: Int, height: Int, done: (Bitmap?) -> Unit) {
        val web = WebView(context)
        var finished = false
        val finish = Runnable {
            if (!finished) {
                finished = true
                val bmp = try {
                    Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888).also { web.draw(Canvas(it)) }
                } catch (e: Exception) {
                    null
                }
                web.destroy()
                done(bmp)
            }
        }
        val assets = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context))
            .build()
        web.setLayerType(View.LAYER_TYPE_SOFTWARE, null)
        web.setBackgroundColor(Color.TRANSPARENT)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
        }
        web.webViewClient = object : WebViewClientCompat() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                assets.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = true
        }
        web.addJavascriptInterface(
            AndroidBridge(context, web, Shell.get(context), null) { main.postDelayed(finish, 150) },
            "boniAndroid",
        )
        web.measure(
            View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY),
        )
        web.layout(0, 0, width, height)
        val id = java.net.URLEncoder.encode(chartId, "UTF-8")
        web.loadUrl("https://appassets.androidplatform.net/assets/web/index.html?picture=$id&still")
        main.postDelayed(finish, TIME_LIMIT_MS)
    }

    companion object {
        const val TIME_LIMIT_MS = 25_000L
    }
}
