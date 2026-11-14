package io.github.juanbonastre.boni

import androidx.work.NetworkType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The jobs the queue worker asks for (task 121): their shape, built without a phone. */
class QueueWorkerTest {
    @Test
    fun asTheAppHidesTheJobIsExpeditedAndWaitsItselfForWhatThePageKeepsJustAfter() {
        // Once, a delayed job was there and the system had not run it three minutes after the kill.
        val r = QueueWorker.request(QueueWorker.HIDDEN_MS, expedite = true, now = 1_000).workSpec
        assertTrue(r.expedited)
        assertEquals(0L, r.initialDelay)
        assertEquals(2_500L, r.input.getLong(QueueWorker.NOT_BEFORE, 0))
        assertEquals(NetworkType.CONNECTED, r.constraints.requiredNetworkType)
        assertFalse(r.input.getBoolean(QueueWorker.PERIODIC, false))
    }

    @Test
    fun aJobForLaterIsDelayedByWorkManagerNotExpedited() {
        // A capture held for its Undo goes when its time comes.
        val r = QueueWorker.request(60_000).workSpec
        assertFalse(r.expedited)
        assertEquals(60_500L, r.initialDelay)
        assertEquals(NetworkType.CONNECTED, r.constraints.requiredNetworkType)
    }

    @Test
    fun theRunAfterOneThatSentNothingIsDelayedAndCountsTheRounds() {
        // Task 121's phone run: asked for by the run itself, not left to WorkManager's retry.
        val first = QueueWorker.againRequest(0).workSpec
        assertFalse(first.expedited)
        assertEquals(30_000L, first.initialDelay)
        assertEquals(1, first.input.getInt(QueueWorker.ROUND, 0))
        assertEquals(NetworkType.CONNECTED, first.constraints.requiredNetworkType)
        assertEquals(60_000L, QueueWorker.againRequest(1).workSpec.initialDelay)
    }

    @Test
    fun theBackstopRunsEveryFifteenMinutesWithTheNetworkAndKeepsItsPeriod() {
        val r = QueueWorker.backstopRequest().workSpec
        assertTrue(r.isPeriodic)
        assertEquals(15 * 60_000L, r.intervalDuration)
        assertEquals(NetworkType.CONNECTED, r.constraints.requiredNetworkType)
        assertTrue(r.input.getBoolean(QueueWorker.PERIODIC, false))
    }
}
