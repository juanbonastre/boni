package io.github.juanbonastre.boni

import android.content.Context
import android.util.Log
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
 * Sends what the page left for later when the network is there, also with the app closed (WorkManager keeps the job
 * across restarts): the offline queue (`queue.json`, captures), with the page's queue rules (QueueLogic), a capture
 * held for its Undo going when its time comes; and what was typed and has no answer yet (`unsent.json`, task 109),
 * with the desktop's rules (UnsentLogic). While the app is in front the page sends both itself, so the job waits.
 */
class QueueWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        if (Shell.foreground) return Result.retry()
        val shell = Shell.get(applicationContext)
        // What was typed first: it is what is not anywhere else.
        val unsentLeft = shell.sendUnsent(stopped = { isStopped })
        val now = System.currentTimeMillis()
        val left = flushQueue(shell, now)
        if (unsentLeft || QueueLogic.pendingCount(left, now) > 0) return Result.retry() // still no server: later
        // Behind this one, never in its place: the app is hidden (task 109).
        QueueLogic.nextHold(left, now)?.let { behind(applicationContext, it - now) }
        return Result.success()
    }

    /** The captures' queue sent, and what is left of it. */
    private fun flushQueue(shell: Shell, now: Long): JSONArray {
        synchronized(Shell.QUEUE_LOCK) {
            val file = shell.storeFile(Shell.QUEUE_FILE)
            if (!file.exists()) return JSONArray()
            val items = try {
                JSONArray(file.readText())
            } catch (e: Exception) {
                return JSONArray() // not a queue: leave it to the page
            }
            val (remaining, delivered) = QueueLogic.flush(items, now) { shell.sendAction(it) }
            if (delivered > 0) WidgetWorker.refresh(applicationContext) // the widgets show the new numbers
            if (remaining.length() == 0) file.delete() else file.writeText(remaining.toString())
            return remaining
        }
    }

    companion object {
        private const val NAME = "boni-queue"

        /** After the page wrote the queue: a job for its next item, if any. */
        fun scheduleFor(context: Context, text: String, wait: Boolean = false) {
            val items = try {
                JSONArray(text)
            } catch (e: Exception) {
                return
            }
            val now = System.currentTimeMillis()
            when {
                QueueLogic.pendingCount(items, now) > 0 -> schedule(context, 0, wait)
                else -> QueueLogic.nextHold(items, now)?.let { schedule(context, it - now, wait) }
            }
        }

        /** As the app hides: the job a moment later, so what the page keeps as it hides, just after, is in it. */
        const val HIDDEN_MS = 1_500L

        private fun request(delayMs: Long) = OneTimeWorkRequestBuilder<QueueWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setInitialDelay(maxOf(0L, delayMs) + 500, TimeUnit.MILLISECONDS)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()

        /**
         * The job, in `delayMs`, in place of the one there. WorkManager takes out the job it had (REPLACE) before it
         * schedules the new one, so with the app hidden only `onStop` does this, with `wait`: it returns once the new
         * one is scheduled, and the system ends an app only once `onStop` has returned (task 109).
         */
        fun schedule(context: Context, delayMs: Long, wait: Boolean = false) {
            val done = WorkManager.getInstance(context).enqueueUniqueWork(NAME, ExistingWorkPolicy.REPLACE, request(delayMs))
            if (!wait) return
            try {
                done.result.get(2, TimeUnit.SECONDS)
            } catch (e: Exception) {
                Log.w(MainActivity.TAG, "the queue's job was not scheduled in time: ${e.message}")
            }
        }

        /**
         * With the app hidden: one more job, in `delayMs` after the one there ends, for what the page wrote after it
         * (APPEND_OR_REPLACE takes none out). Never in its place: the system may end the app at any moment, and on a
         * phone a kill between taking out the job `onStop` left and scheduling the new one left nothing to send what
         * was kept.
         */
        fun behind(context: Context, delayMs: Long = 0) {
            WorkManager.getInstance(context)
                .enqueueUniqueWork(NAME, ExistingWorkPolicy.APPEND_OR_REPLACE, request(delayMs))
        }

        /** A job for what the page wrote (the queue or the kept list), as `UnsentLogic.ask` says. */
        fun ask(context: Context, foreground: Boolean, due: Boolean, inPlace: () -> Unit) {
            when (UnsentLogic.ask(foreground, due)) {
                UnsentLogic.Ask.IN_PLACE -> inPlace()
                UnsentLogic.Ask.BEHIND -> behind(context)
                UnsentLogic.Ask.NONE -> {}
            }
        }
    }
}
