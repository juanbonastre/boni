package io.github.juanbonastre.boni

import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Draws every home-screen widget again (one at a time, on the main thread, waiting for each picture). */
class WidgetWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        val ctx = applicationContext
        val main = Handler(Looper.getMainLooper())
        for (id in ChartWidget.ids(ctx)) {
            val chartId = ChartWidget.chartOf(ctx, id)
            if (chartId == null) {
                ChartWidget.show(ctx, id, null, null, ctx.getString(R.string.widget_pick))
                continue
            }
            val (w, h) = ChartWidget.sizePx(ctx, id)
            val latch = CountDownLatch(1)
            main.post {
                WidgetRenderer(ctx).render(chartId, w, h) { bmp ->
                    ChartWidget.show(ctx, id, chartId, bmp, if (bmp == null) ctx.getString(R.string.widget_failed) else null)
                    latch.countDown()
                }
            }
            latch.await(WidgetRenderer.TIME_LIMIT_MS + 5_000, TimeUnit.MILLISECONDS)
        }
        return Result.success()
    }

    companion object {
        private const val NOW = "boni-widgets"
        private const val PERIODIC = "boni-widgets-periodic"

        /** All widgets again, soon (a few changes in a row draw once). */
        fun refresh(context: Context, delayMs: Long = 1_500) {
            if (ChartWidget.ids(context).isEmpty()) return
            val request = OneTimeWorkRequestBuilder<WidgetWorker>()
                .setInitialDelay(delayMs, TimeUnit.MILLISECONDS)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(NOW, ExistingWorkPolicy.REPLACE, request)
        }

        /** Every 30 minutes while there are widgets (with network: the picture shows the server's numbers). */
        fun schedulePeriodic(context: Context) {
            val request = PeriodicWorkRequestBuilder<WidgetWorker>(30, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, request)
        }

        fun cancelPeriodic(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(PERIODIC)
        }
    }
}
