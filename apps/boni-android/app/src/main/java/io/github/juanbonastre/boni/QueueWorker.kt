package io.github.juanbonastre.boni

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.util.Log
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequest
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.PeriodicWorkRequest
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import org.json.JSONArray
import java.util.concurrent.TimeUnit

/**
 * Sends what the page left for later when the network is there, also with the app closed (WorkManager keeps the job
 * across restarts): the offline queue (`queue.json`, captures), with the page's queue rules (QueueLogic), a capture
 * held for its Undo going when its time comes; and what was typed and has no answer yet (`unsent.json`, task 109),
 * with the desktop's rules (UnsentLogic). While the app is in front the page sends both itself, so the job waits.
 *
 * Task 121: as the app hides, the job is expedited (the system runs it at once, not minutes later), and it waits for
 * what the page keeps just after `onStop` itself; a server not reached is tried again a few times inside the same run;
 * and while anything is kept, a periodic job stays behind them all, never replaced, in case the system dropped the
 * others.
 */
class QueueWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        // The backstop keeps its 15 minutes whatever a run finds (a retry would put it on a growing backoff instead).
        val periodic = inputData.getBoolean(PERIODIC, false)
        val later = if (periodic) Result.success() else Result.retry()
        if (Shell.foreground) return later
        val shell = Shell.get(applicationContext)
        // What the page keeps as it hides comes just after onStop: an expedited job cannot be delayed, so it waits here.
        if (!pause(UnsentLogic.waitFor(inputData.getLong(NOT_BEFORE, 0L), System.currentTimeMillis(), HIDDEN_MS))) {
            return later
        }
        // One run at a time (the hidden job, the one behind it and the backstop): nothing is sent twice at once.
        synchronized(SEND_LOCK) {
            var attempt = 0
            while (true) {
                // What was typed first: it is what is not anywhere else.
                val unsentLeft = shell.sendUnsent(stopped = { isStopped })
                val now = System.currentTimeMillis()
                val left = flushQueue(shell, now)
                if (!unsentLeft && QueueLogic.pendingCount(left, now) == 0) {
                    // Behind this one, never in its place: the app is hidden (task 109).
                    QueueLogic.nextHold(left, now)?.let { behind(applicationContext, it - now) }
                    settled(applicationContext, shell)
                    return Result.success()
                }
                // No server yet: again soon in this run, then later, as WorkManager's backoff says.
                val wait = UnsentLogic.againIn(attempt++, stopped = Shell.foreground || isStopped || shell.sessionEnded)
                    ?: return later
                Log.i(MainActivity.TAG, "queue: again in ${wait / 1000} s")
                if (!pause(wait)) return later
            }
        }
    }

    /** A wait the app's return or the system's stop cuts short: false when it was. */
    private fun pause(ms: Long): Boolean {
        val end = System.currentTimeMillis() + ms
        while (System.currentTimeMillis() < end) {
            if (Shell.foreground || isStopped) return false
            Thread.sleep(minOf(200L, end - System.currentTimeMillis()).coerceAtLeast(1L))
        }
        return !(Shell.foreground || isStopped)
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

    /**
     * Below Android 12 an expedited job runs as a foreground service, which shows a notification while it sends; from
     * 12 on the system runs it as an expedited job, with none.
     */
    override fun getForegroundInfo(): ForegroundInfo {
        val ctx = applicationContext
        val nm = ctx.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL, ctx.getString(R.string.sending_channel), NotificationManager.IMPORTANCE_MIN),
            )
        }
        val n = Notification.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_notice)
            .setContentText(ctx.getString(R.string.sending))
            .setOngoing(true)
            .build()
        return ForegroundInfo(FOREGROUND_ID, n)
    }

    companion object {
        private const val NAME = "boni-queue"

        /** The periodic job that stays while anything is kept (task 121). */
        private const val BACKSTOP = "boni-queue-backstop"

        /** The moment (epoch ms) an expedited job reads what was kept, at the earliest. */
        internal const val NOT_BEFORE = "notBefore"

        /** Set on the backstop's runs. */
        internal const val PERIODIC = "periodic"

        private const val CHANNEL = "boni-sending"
        private const val FOREGROUND_ID = 121

        /** The worker's runs never overlap inside the process. */
        private val SEND_LOCK = Any()

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

        private val network = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

        /** A job in `delayMs`: delayed by WorkManager, or (`expedite`) run at once and waiting itself until then. */
        internal fun request(delayMs: Long, expedite: Boolean = false, now: Long = System.currentTimeMillis()): OneTimeWorkRequest {
            val b = OneTimeWorkRequestBuilder<QueueWorker>()
                .setConstraints(network)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            if (expedite) {
                // An expedited job cannot be delayed; out of the system's quota for them, an ordinary one at once.
                b.setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
                    .setInputData(workDataOf(NOT_BEFORE to now + maxOf(0L, delayMs)))
            } else {
                b.setInitialDelay(maxOf(0L, delayMs) + 500, TimeUnit.MILLISECONDS)
            }
            return b.build()
        }

        /** The backstop: every 15 minutes (Android's least) with the network, while anything is kept. */
        internal fun backstopRequest(): PeriodicWorkRequest = PeriodicWorkRequestBuilder<QueueWorker>(15, TimeUnit.MINUTES)
            .setConstraints(network)
            .setInputData(workDataOf(PERIODIC to true))
            .build()

        /**
         * The job, in `delayMs`, in place of the one there. WorkManager takes out the job it had (REPLACE) before it
         * schedules the new one, so with the app hidden only `onStop` does this, with `wait`, expedited: it returns
         * once the new one is scheduled, and the system ends an app only once `onStop` has returned (task 109).
         */
        fun schedule(context: Context, delayMs: Long, wait: Boolean = false) {
            val done = WorkManager.getInstance(context)
                .enqueueUniqueWork(NAME, ExistingWorkPolicy.REPLACE, request(delayMs, expedite = wait))
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
         * was kept. One due now is expedited (task 121).
         */
        fun behind(context: Context, delayMs: Long = 0) {
            WorkManager.getInstance(context)
                .enqueueUniqueWork(NAME, ExistingWorkPolicy.APPEND_OR_REPLACE, request(delayMs, expedite = delayMs <= 0))
        }

        /**
         * The backstop, kept: KEEP never takes out the one there. Called under the lock of the file just written, so
         * a worker that finds nothing left (`settled`) cannot take it out after this.
         */
        fun backstop(context: Context) {
            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(BACKSTOP, ExistingPeriodicWorkPolicy.KEEP, backstopRequest())
        }

        /** Nothing kept and nothing queued: the backstop goes. Under both files' locks, as their writers take them. */
        private fun settled(context: Context, shell: Shell) {
            synchronized(Shell.QUEUE_LOCK) {
                synchronized(Shell.UNSENT_LOCK) {
                    if (shell.storeFile(Shell.UNSENT_FILE).exists()) return
                    val queue = shell.storeFile(Shell.QUEUE_FILE).takeIf { it.exists() }?.readText()
                    if (QueueLogic.waiting(queue)) return
                    WorkManager.getInstance(context).cancelUniqueWork(BACKSTOP)
                }
            }
        }

        /**
         * WorkManager's database opened while the app is in front, so the job `onStop` asks for is scheduled within
         * its wait (task 121: the one kill with no job left was the first after signing in).
         */
        fun warm(context: Context) {
            WorkManager.getInstance(context).getWorkInfosForUniqueWork(NAME)
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
