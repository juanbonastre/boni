package io.github.juanbonastre.boni

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

/**
 * A file attached from the phone (task 114, A-24): the same path and name as the page's and the desktop's
 * (uploads.test.ts, uploads.test.cjs), and sent a part at a time, never whole in memory.
 */
class UploadsTest {
    @Test
    fun theSamePathAsThePageAndTheDesktop() {
        // The same case as uploads.test.ts: everything but letters, digits and -_. escaped, as UTF-8.
        val p = Uploads.path("Factura FAC-2026-0142 (taller) ñ.pdf")
        assertEquals("api/data/files/upload?name=Factura%20FAC-2026-0142%20%28taller%29%20%C3%B1.pdf", p)
        assertTrue(Paths.apiRequest("POST", p!!))
        assertEquals("a%21%27%2A%7E.txt", Uploads.queryName("a!'*~.txt"))
        for (n in listOf("", "  ", "../x.pdf", "a/b.pdf", "a\\b.pdf", ".oculto", "x".repeat(201))) {
            assertNull(n, Uploads.path(n))
        }
    }

    @Test
    fun aNameTheServerCanTellTheTypeOf() {
        assertEquals("IMG_0042.jpg", Uploads.named("IMG_0042", "jpg"))
        assertEquals("Factura FAC-2026-0142.pdf", Uploads.named("Factura FAC-2026-0142.pdf", "pdf"))
        assertEquals("tique.jpeg", Uploads.named("tique.jpeg", "jpg"))
        assertEquals("notas", Uploads.named("notas", null))
        assertEquals("archivo.pdf", Uploads.named(null, "pdf"))
        assertEquals("archivo", Uploads.named("  ", "x/y"))
    }

    @Test
    fun copiesAPartAtATimeAndNeverMoreThanItSaid() {
        val size = 1_000_000L
        val reads = mutableListOf<Long>()
        var written = 0L
        val input = object : InputStream() {
            var at = 0L
            override fun read(): Int = throw AssertionError("one byte at a time")
            override fun read(b: ByteArray, off: Int, len: Int): Int {
                // Everything read before was written before this read: nothing is gathered in between.
                assertEquals(at, written)
                assertTrue(len <= Uploads.PART)
                reads.add(at)
                val n = len
                at += n
                return n
            }
        }
        val output = object : OutputStream() {
            override fun write(b: Int) = throw AssertionError("one byte at a time")
            override fun write(b: ByteArray, off: Int, len: Int) {
                written += len
            }
        }
        val seen = mutableListOf<Long>()
        Uploads.copy(input, output, size, seen::add)
        assertEquals(size, written)
        assertEquals((size + Uploads.PART - 1) / Uploads.PART, reads.size.toLong())
        assertEquals(size, seen.last())
        // Shorter than it said: the phone's file, not the network.
        try {
            Uploads.copy(ByteArrayInputStream(ByteArray(10)), OutputStream.nullOutputStream(), 11) {}
            fail("a short file was sent whole")
        } catch (e: Uploads.Unreadable) {
            // expected
        }
    }

    @Test
    fun theServerGetsItWhileItIsStillBeingRead() {
        val size = 48L * 1024 * 1024
        val received = AtomicLong()
        val arriving = CountDownLatch(1)
        val headers = ConcurrentHashMap<String, String>()
        // A server of one request (the JDK's own is not on Android's classpath): its head, then the body as it comes.
        val server = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))
        val serving = Thread serve@{
            server.accept().use { sock ->
                val input = sock.getInputStream()
                val head = StringBuilder()
                while (!head.endsWith("\r\n\r\n")) {
                    val c = input.read()
                    if (c < 0) return@serve
                    head.append(c.toChar())
                }
                val lines = head.split("\r\n")
                headers["query"] = lines[0].split(" ")[1].substringAfter('?')
                for (l in lines.drop(1).filter { it.contains(':') })
                    headers[l.substringBefore(':').trim().lowercase()] = l.substringAfter(':').trim()
                val buf = ByteArray(64 * 1024)
                val length = headers["content-length"]?.toLong() ?: 0L
                while (received.get() < length) {
                    val n = input.read(buf)
                    if (n < 0) break
                    if (received.addAndGet(n.toLong()) >= 1024 * 1024) arriving.countDown()
                }
                val answer = """{"id":"e_01ejemplo","name":"vídeo.mp4","state":"too-big"}""".toByteArray()
                val out = sock.getOutputStream()
                out.write(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${answer.size}\r\nConnection: close\r\n\r\n"
                        .toByteArray(),
                )
                out.write(answer)
                out.flush()
            }
        }
        serving.start()
        try {
            // A file made as it is read: past 8 MB it waits for the server to have some of it. A connection that
            // kept the body to send it whole would never send any, and this would wait in vain.
            var streamed = true
            val input = object : InputStream() {
                var at = 0L
                override fun read(): Int = throw AssertionError("one byte at a time")
                override fun read(b: ByteArray, off: Int, len: Int): Int {
                    if (at >= size) return -1
                    if (at >= 8L * 1024 * 1024 && arriving.count > 0 && !arriving.await(10, TimeUnit.SECONDS))
                        streamed = false
                    val n = minOf(len.toLong(), size - at).toInt()
                    b.fill(7, off, off + n)
                    at += n
                    return n
                }
            }
            val path = Uploads.path("vídeo.mp4")!!
            var last = 0L
            val r = Uploads.send(
                "http://127.0.0.1:${server.localPort}/$path", "token-inventado", size, input,
            ) { last = it }
            assertTrue("the body was kept whole before it went", streamed)
            assertEquals(200, r.status)
            assertTrue(r.body.contains("e_01ejemplo"))
            assertEquals(size, received.get())
            assertEquals(size, last)
            assertEquals("Bearer token-inventado", headers["authorization"])
            assertEquals("application/octet-stream", headers["content-type"])
            assertEquals(size.toString(), headers["content-length"])
            assertEquals("boni-android", headers["x-boni-client"])
            assertEquals("name=v%C3%ADdeo.mp4", headers["query"])
        } finally {
            server.close()
            serving.join(5_000)
        }
    }
}
