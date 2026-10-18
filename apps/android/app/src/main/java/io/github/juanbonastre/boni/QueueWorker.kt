package io.github.juanbonastre.boni

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONArray
import java.util.concurrent.TimeUnit

/**
 * Sends the offline queue when the network is back, also with the app closed (WorkManager keeps the job across
 * restarts). While the app is in front the page sends it itself, so the job waits. Same rules as the page's
 * queue (QueueLogic); a capture held for its Undo goes when its time comes.
 */
class QueueWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        if (Shell.foreground) return Result.retry()
        val shell = Shell.get(applicationContext)
        val now = System.currentTimeMillis()
        val left: JSONArray = synchronized(Shell.QUEUE_LOCK) {
            val file = shell.storeFile(Shell.QUEUE_FILE)
            if (!file.exists()) return Result.success()
            val items = try {
                JSONArray(file.readText())
            } catch (e: Exception) {
                return Result.success() // not a queue: leave it to the page
            }
            val (remaining, delivered) = QueueLogic.flush(items, now) { shell.sendAction(it) }
            if (delivered > 0) WidgetWorker.refresh(applicationContext) // the widgets show the new numbers
            if (remaining.length() == 0) file.delete() else file.writeText(remaining.toString())
            remaining
        }
        if (QueueLogic.pendingCount(left, now) > 0) return Result.retry() // still no server: later
        QueueLogic.nextHold(left, now)?.let { schedule(applicationContext, it - now) }
        return Result.success()
    }

    companion object {
        private const val NAME = "boni-queue"

        /** After the page wrote the queue: a job for its next item, if any. */
        fun scheduleFor(context: Context, text: String) {
            val items = try {
                JSONArray(text)
            } catch (e: Exception) {
                return
            }
            val now = System.currentTimeMillis()
            when {
                QueueLogic.pendingCount(items, now) > 0 -> schedule(context, 0)
                else -> QueueLogic.nextHold(items, now)?.let { schedule(context, it - now) }
            }
        }

        fun schedule(context: Context, delayMs: Long) {
            val request = OneTimeWorkRequestBuilder<QueueWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setInitialDelay(maxOf(0L, delayMs) + 500, TimeUnit.MILLISECONDS)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(NAME, ExistingWorkPolicy.REPLACE, request)
        }
    }
}
