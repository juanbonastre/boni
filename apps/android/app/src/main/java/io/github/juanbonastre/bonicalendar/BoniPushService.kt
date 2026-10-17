package io.github.juanbonastre.bonicalendar

import org.unifiedpush.android.connector.FailedReason
import org.unifiedpush.android.connector.PushService
import org.unifiedpush.android.connector.data.PushEndpoint
import org.unifiedpush.android.connector.data.PushMessage

/**
 * UnifiedPush (phase 5): the distributor (the ntfy app) gives this device an address, which the server
 * learns; when the server posts there, the app asks it for its reminders again. The message itself
 * carries nothing (no event ever travels through the distributor).
 */
class BoniPushService : PushService() {
    override fun onNewEndpoint(endpoint: PushEndpoint, instance: String) = ServerSync.endpoint(this, endpoint.url)

    override fun onMessage(message: PushMessage, instance: String) = ServerSync.runAsync(this)

    override fun onRegistrationFailed(reason: FailedReason, instance: String) = ServerSync.endpoint(this, null)

    override fun onUnregistered(instance: String) = ServerSync.endpoint(this, null)
}
