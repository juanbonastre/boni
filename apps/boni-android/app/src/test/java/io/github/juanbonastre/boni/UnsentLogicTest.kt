package io.github.juanbonastre.boni

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * What was typed and kept unsent, as the app keeps and sends it (task 109): the same cases as the desktop's
 * (apps/boni-desktop/unsent.test.cjs), and the worker's resend with the app closed.
 */
class UnsentLogicTest {
    private val ID = "e_01kaaaaaaaaaaaaaaaaaaaaaaa"
    private val REAL = "e_01kbbbbbbbbbbbbbbbbbbbbbbb"

    private fun page(id: String, at: Long, title: String) = JSONObject()
        .put("path", "api/pages/$id").put("at", at).put("id", id).put("kind", "page")
        .put("patch", JSONObject().put("title", title))

    private fun row(id: String, at: Long, values: JSONObject, body: String? = null) = JSONObject()
        .put("path", "api/data/rows/$id").put("at", at).put("id", id).put("kind", "row").put("values", values)
        .also { if (body != null) it.put("body", body) }

    private fun newPage(id: String, at: Long) = JSONObject()
        .put("path", "api/pages#$id").put("at", at).put("id", id).put("kind", "new-page").put("parent", JSONObject.NULL)

    private fun pageAnswer(id: String) = """{"page":{"id":"$id","title":""}}"""

    /** The same lists, entry by entry, whatever the order of their keys (org.json's on the JVM keeps none). */
    private fun assertSameList(expected: List<JSONObject>, actual: List<JSONObject>) {
        assertEquals(expected.map { it.toString() }.toString(), expected.size, actual.size)
        expected.indices.forEach { assertTrue("$it: ${actual[it]}", expected[it].similar(actual[it])) }
    }

    private fun assertBody(expected: String, actual: JSONObject) = assertTrue("$actual", JSONObject(expected).similar(actual))

    /** A server that answers each request as `answer` says, recording what it was sent. */
    private class Server(val answer: (UnsentLogic.Request) -> HttpAnswer?) {
        val sent = mutableListOf<UnsentLogic.Request>()
        fun send(r: UnsentLogic.Request): HttpAnswer? {
            sent.add(r)
            return answer(r)
        }
    }

    private fun ok(r: UnsentLogic.Request) =
        if (r.method == "POST") HttpAnswer(201, pageAnswer(r.body.getString("id"))) else HttpAnswer(200, "{}")

    @Test
    fun onlyAPagesOrARowsWriteIsKeptUntilAnswered() {
        val book = UnsentLogic.Book { 10 }
        val t = book.sending("PUT", "api/pages/p1", JSONObject().put("title", "Uno"))!!
        assertEquals("api/pages/p1", t.path)
        assertEquals(listOf("patch.title"), t.fields)
        assertEquals(10L, t.at)
        assertTrue(book.sending("PUT", "api/data/rows/r1", null) != null)
        assertNull(book.sending("GET", "api/pages/p1", null))
        assertNull(book.sending("PUT", "api/data/rows/r1/type", null))
        assertNull(book.sending("POST", "api/pages", null)) // a create from elsewhere, with no id of its own
        assertEquals(ID, book.sending("POST", "api/pages", JSONObject().put("id", ID).put("title", ""))!!.made)
    }

    @Test
    fun anAnswerTakesOutOnlyTheFieldsItsRequestCarriedAndOnlyWhatWasTypedBeforeItLeft() {
        var now = 50L
        val book = UnsentLogic.Book { now }
        val values = JSONObject().put("amount", 5).put("note", "Ejemplo")
        val list = listOf(row("r1", 40, values, "Texto"), page("p1", 60, "Plan"))
        // Another part of the app wrote the row's amount only (D-68): its note and text stay.
        val t = book.sending("PUT", "api/data/rows/r1", JSONObject().put("values", JSONObject().put("amount", 5)))
        assertTrue(book.answered(t, true, "{}"))
        val left = book.left(list)
        assertEquals(2, left.size)
        assertEquals(listOf("values.note", "body"), UnsentLogic.fieldsOf(left[0]))
        // The page's title typed after its request left (60 > 55) stays: the server has the earlier one.
        now = 55
        assertTrue(book.answered(book.sending("PUT", "api/pages/p1", JSONObject().put("title", "Pl")), true, "{}"))
        assertSame(list[1], book.left(list)[1])
        // A request that did not reach the server takes nothing out.
        now = 70
        assertFalse(book.answered(book.sending("PUT", "api/pages/p1", JSONObject().put("title", "Plan")), false, ""))
        assertEquals(2, book.left(list).size)
    }

    @Test
    fun theListComesBackAsTheSameObjectsWhenNothingWasAnswered() {
        val book = UnsentLogic.Book { 10 }
        val list = listOf(newPage(ID, 1), page(ID, 2, "Plan"), row("r1", 3, JSONObject().put("a", 1)))
        val left = book.left(list)
        assertTrue(UnsentLogic.same(list, left))
        book.answered(book.sending("PUT", "api/data/rows/r1", JSONObject().put("values", JSONObject().put("a", 1))), true, "{}")
        assertFalse(UnsentLogic.same(list, book.left(list)))
    }

    @Test
    fun aPageMadeHereIsKeptUntilAnAnswerWithThePage() {
        val book = UnsentLogic.Book { 50 }
        val list = listOf(newPage(ID, 40), page(ID, 45, "Plan"))
        val create = JSONObject().put("id", ID).put("title", "").put("parent", JSONObject.NULL)
        // No answer, or one without the page (the session gone, too many requests): it stays.
        assertFalse(book.answered(book.sending("POST", "api/pages", create), false, ""))
        assertFalse(book.answered(book.sending("POST", "api/pages", create), true, """{"error":"unauthorized"}"""))
        assertSameList(list, book.left(list))
        // The server made it: what was typed in it is left, to it.
        assertTrue(book.answered(book.sending("POST", "api/pages", create), true, pageAnswer(ID)))
        assertTrue(book.isMade(ID))
        assertSameList(listOf(page(ID, 45, "Plan")), book.left(list))
        // A list kept before the page saw the answer does not bring the create back.
        assertSameList(listOf(page(ID, 60, "Plan de ejemplo")), book.left(listOf(newPage(ID, 40), page(ID, 60, "Plan de ejemplo"))))
    }

    @Test
    fun aServerBeforeTask109GaveThePageAnIdOfItsOwnAndWhatWasTypedInItMovesThere() {
        val book = UnsentLogic.Book { 50 }
        book.answered(book.sending("POST", "api/pages", JSONObject().put("id", ID).put("title", "")), true, pageAnswer(REAL))
        val left = book.left(listOf(newPage(ID, 40), page(ID, 45, "Plan"), page(REAL, 30, "Pl")))
        assertEquals(1, left.size)
        assertEquals("api/pages/$REAL", left[0].getString("path"))
        assertEquals(REAL, left[0].getString("id"))
        assertEquals("Plan", left[0].getJSONObject("patch").getString("title")) // the later write wins
    }

    @Test
    fun theWorkerSendsThePagesMadeHereFirstThenWhatWasTyped() {
        val book = UnsentLogic.Book { 100 }
        val list = listOf(row("r1", 1, JSONObject().put("a", 1), "Texto"), page(ID, 2, "Plan"), newPage(ID, 3))
        val server = Server(::ok)
        var answers = 0
        val out = UnsentLogic.flush(list, book, { false }, server::send) { answers++ }
        assertEquals(UnsentLogic.Flushed(3, false), out)
        assertEquals(3, answers)
        assertEquals(listOf("POST api/pages", "PUT api/data/rows/r1", "PUT api/pages/$ID"), server.sent.map { "${it.method} ${it.path}" })
        assertBody("""{"id":"$ID","title":"","parent":null}""", server.sent[0].body)
        assertBody("""{"values":{"a":1},"body":"Texto"}""", server.sent[1].body)
        assertBody("""{"title":"Plan"}""", server.sent[2].body)
        assertEquals(0, book.left(list).size)
    }

    @Test
    fun whatWasTypedInAPageTheServerHasNotMadeWaitsForIt() {
        val book = UnsentLogic.Book { 100 }
        val list = listOf(newPage(ID, 1), page(ID, 2, "Plan"), page("p2", 3, "Otra"))
        // The create fails (the server restarting): the page's write waits; another page's goes.
        val server = Server { r -> if (r.method == "POST") HttpAnswer(503, "") else ok(r) }
        val out = UnsentLogic.flush(list, book, { false }, server::send)
        assertEquals(UnsentLogic.Flushed(1, true), out)
        assertEquals(listOf("POST api/pages", "PUT api/pages/p2"), server.sent.map { "${it.method} ${it.path}" })
        assertSameList(list.take(2), book.left(list))
        // Refused (a bad id): it is not made and stays, for the page to say so; what was typed in it waits too.
        val refused = Server { r -> if (r.method == "POST") HttpAnswer(400, """{"error":"bad id"}""") else ok(r) }
        assertEquals(UnsentLogic.Flushed(1, false), UnsentLogic.flush(book.left(list), book, { false }, refused::send))
        assertEquals(1, refused.sent.size)
        assertSameList(list.take(2), book.left(list))
    }

    @Test
    fun noConnectionOrASessionGoneStopsItAllAndKeepsIt() {
        for (answer in listOf<HttpAnswer?>(null, HttpAnswer(401, """{"error":"unauthorized"}"""))) {
            val book = UnsentLogic.Book { 100 }
            val list = listOf(page("p1", 1, "Uno"), page("p2", 2, "Dos"))
            val server = Server { answer }
            assertEquals(UnsentLogic.Flushed(0, true), UnsentLogic.flush(list, book, { false }, server::send))
            assertEquals(1, server.sent.size)
            assertSameList(list, book.left(list))
        }
    }

    @Test
    fun aFailingServerATimeoutOrTooManyRequestsKeepThatOneAndTheOthersGo() {
        for (status in listOf(500, 503, 408, 429)) {
            val book = UnsentLogic.Book { 100 }
            val list = listOf(page("p1", 1, "Uno"), page("p2", 2, "Dos"))
            val server = Server { r -> if (r.path == "api/pages/p1") HttpAnswer(status, "") else ok(r) }
            assertEquals(UnsentLogic.Flushed(1, true), UnsentLogic.flush(list, book, { false }, server::send))
            assertSameList(list.take(1), book.left(list))
        }
    }

    @Test
    fun aRefusedWriteGoesAsThePageLetsIt() {
        // Sent again it would be refused again (a note deleted elsewhere): the page takes it out too.
        val book = UnsentLogic.Book { 100 }
        val list = listOf(page("p1", 1, "Uno"))
        val out = UnsentLogic.flush(list, book, { false }, Server { HttpAnswer(404, """{"error":"not_found"}""") }::send)
        assertEquals(UnsentLogic.Flushed(1, false), out)
        assertEquals(0, book.left(list).size)
    }

    @Test
    fun theWorkerStopsWhenThePageIsBack() {
        val book = UnsentLogic.Book { 100 }
        val list = listOf(page("p1", 1, "Uno"), page("p2", 2, "Dos"))
        val server = Server(::ok)
        var back = false
        val out = UnsentLogic.flush(list, book, { back }, { r -> server.send(r).also { back = true } })
        assertEquals(UnsentLogic.Flushed(1, true), out)
        assertEquals(1, server.sent.size)
        assertSameList(list.drop(1), book.left(list))
    }

    @Test
    fun whatThePageHadInFlightAndWasAnsweredIsNotSentAgain() {
        var now = 100L
        val book = UnsentLogic.Book { now }
        // The app hid with the page's write in flight; its answer came once the list was kept.
        val list = listOf(page("p1", 50, "Uno"), page("p2", 60, "Dos"))
        val t = book.sending("PUT", "api/pages/p1", JSONObject().put("title", "Uno"))
        book.answered(t, true, "{}")
        now = 200
        val server = Server(::ok)
        assertEquals(UnsentLogic.Flushed(1, false), UnsentLogic.flush(list, book, { false }, server::send))
        assertEquals(listOf("api/pages/p2"), server.sent.map { it.path })
    }

    @Test
    fun withTheAppHiddenAWriteAsksForAJobBehindTheOneThereNeverInItsPlace() {
        // On a phone, a job asked for in place of the one onStop left, as the app was ended, left none.
        assertEquals(UnsentLogic.Ask.BEHIND, UnsentLogic.ask(foreground = false, due = true))
        assertEquals(UnsentLogic.Ask.IN_PLACE, UnsentLogic.ask(foreground = true, due = true))
        assertEquals(UnsentLogic.Ask.NONE, UnsentLogic.ask(foreground = false, due = false))
        assertEquals(UnsentLogic.Ask.NONE, UnsentLogic.ask(foreground = true, due = false))
    }

    @Test
    fun onlyAKeptWritesShapeIsSent() {
        assertNull(UnsentLogic.requestOf(JSONObject().put("path", "api/pages/p1").put("id", "p1").put("kind", "page")))
        assertNull(UnsentLogic.requestOf(page("p1", 1, "Uno").put("path", "api/settings")))
        assertNull(UnsentLogic.requestOf(page("p1", 1, "Uno").put("kind", "other")))
        assertNull(UnsentLogic.requestOf(newPage(ID, 1).put("parent", 5)))
        assertBody("""{"id":"$ID","title":"","parent":"p0"}""", UnsentLogic.requestOf(newPage(ID, 1).put("parent", "p0"))!!.body)
        assertEquals(emptyList<JSONObject>(), UnsentLogic.parse("no es una lista"))
        assertEquals(1, UnsentLogic.parse("""[{"path":"api/pages/p1"},{"no":"path"},3]""").size)
    }
}
