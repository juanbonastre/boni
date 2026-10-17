package io.github.juanbonastre.bonicalendar

import android.content.Context
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.DocumentsContract.Document
import java.io.File

/** A request the calendar may not make, or a note that is not there. `code` is what the page sees. */
class VaultError(val code: String, message: String) : Exception(message)

/** Vault-relative paths the calendar may touch: the same rules as the desktop shell (vault-fs.cjs). */
object VaultPaths {
    private val deniedTop = setOf("private", "restricted")

    fun check(path: String, markdown: Boolean = true): String {
        if (path.isEmpty() || path.startsWith("/") || path.contains('\u0000')) {
            throw VaultError("bad-path", "Bad path: $path")
        }
        val parts = path.split('/', '\\').filter { it.isNotEmpty() }
        if (parts.any { it == ".." || it.startsWith(".") }) throw VaultError("bad-path", "Not allowed: $path")
        if (parts.firstOrNull() in deniedTop) throw VaultError("denied", "Not allowed: $path")
        if (markdown && !path.lowercase().endsWith(".md")) {
            throw VaultError("bad-path", "Only Markdown notes: $path")
        }
        return parts.joinToString("/")
    }

    fun parent(path: String): String = path.substringBeforeLast('/', "")
    fun name(path: String): String = path.substringAfterLast('/')
}

/**
 * The vault folder the user chose once (Storage Access Framework), read and written through the
 * documents provider of the phone's storage. Document ids of that provider are paths
 * ("primary:Folder/agenda/x.md"), so a note is reached directly from its vault-relative path.
 */
class VaultSaf(context: Context, private val tree: Uri) {
    private val resolver = context.contentResolver
    private val rootId: String = DocumentsContract.getTreeDocumentId(tree)

    data class Stat(val mtime: Long, val size: Long, val isDir: Boolean)
    data class Entry(val path: String, val mtime: Long, val size: Long)

    /** What Settings shows as the vault's folder ("Sync/Vault"). */
    val label: String get() = rootId.substringAfter(':', rootId).ifEmpty { rootId }

    /** The vault's folder name: Obsidian knows the vault by it. */
    val name: String get() = label.substringAfterLast('/')

    private fun docId(rel: String) = if (rel.isEmpty()) rootId else "$rootId/$rel"
    private fun uri(rel: String): Uri = DocumentsContract.buildDocumentUriUsingTree(tree, docId(rel))

    fun stat(rel: String): Stat? = try {
        resolver.query(
            uri(rel),
            arrayOf(Document.COLUMN_LAST_MODIFIED, Document.COLUMN_SIZE, Document.COLUMN_MIME_TYPE),
            null, null, null,
        )?.use { c -> if (c.moveToFirst()) Stat(c.getLong(0), c.getLong(1), c.getString(2) == Document.MIME_TYPE_DIR) else null }
    } catch (e: Exception) {
        null // the provider throws for a document that does not exist
    }

    private fun note(rel: String): Stat {
        val s = stat(rel)
        if (s == null || s.isDir) throw VaultError("not-found", "No such note: $rel")
        return s
    }

    /** Every `.md` below `dir` (no dot folders), with its modification time and size. */
    fun scan(dir: String): List<Entry> {
        val base = VaultPaths.check(dir.trimEnd('/'), markdown = false)
        val st = stat(base)
        if (st == null || !st.isDir) throw VaultError("not-found", "No such folder: $dir")
        val out = mutableListOf<Entry>()
        val pending = ArrayDeque(listOf(base))
        while (pending.isNotEmpty()) {
            val folder = pending.removeFirst()
            val children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, docId(folder))
            resolver.query(
                children,
                arrayOf(
                    Document.COLUMN_DISPLAY_NAME,
                    Document.COLUMN_MIME_TYPE,
                    Document.COLUMN_LAST_MODIFIED,
                    Document.COLUMN_SIZE,
                ),
                null, null, null,
            )?.use { c ->
                while (c.moveToNext()) {
                    val name = c.getString(0) ?: continue
                    if (name.startsWith(".")) continue
                    val rel = "$folder/$name"
                    if (c.getString(1) == Document.MIME_TYPE_DIR) pending.add(rel)
                    else if (name.lowercase().endsWith(".md")) out.add(Entry(rel, c.getLong(2), c.getLong(3)))
                }
            }
        }
        return out
    }

    fun read(path: String): Pair<String, Long> {
        val rel = VaultPaths.check(path)
        val st = note(rel)
        val text = resolver.openInputStream(uri(rel))?.use { it.readBytes().toString(Charsets.UTF_8) }
            ?: throw VaultError("not-found", "No such note: $path")
        return text to st.mtime
    }

    /** Replaces a note, unless it changed since `expected` (then nothing is written). */
    fun write(path: String, text: String, expected: Long?): Triple<Boolean, Long, Long> {
        val rel = VaultPaths.check(path)
        val before = note(rel)
        if (expected != null && kotlin.math.abs(before.mtime - expected) > 1) {
            return Triple(true, before.mtime, before.size)
        }
        resolver.openOutputStream(uri(rel), "wt")?.use { it.write(text.toByteArray(Charsets.UTF_8)) }
            ?: throw VaultError("failed", "Cannot write: $path")
        val after = note(rel)
        return Triple(false, after.mtime, after.size)
    }

    /** Creates the folders of `rel` that are missing. */
    private fun ensureDir(rel: String) {
        if (rel.isEmpty()) return
        var at = ""
        for (part in rel.split('/')) {
            val next = if (at.isEmpty()) part else "$at/$part"
            val st = stat(next)
            if (st == null) {
                DocumentsContract.createDocument(resolver, uri(at), Document.MIME_TYPE_DIR, part)
                    ?: throw VaultError("failed", "Cannot create folder: $next")
            } else if (!st.isDir) {
                throw VaultError("bad-path", "Not a folder: $next")
            }
            at = next
        }
    }

    /** Creates a note that must not exist yet; null when the name is taken. */
    fun create(path: String, text: String): Stat? {
        val rel = VaultPaths.check(path)
        if (stat(rel) != null) return null
        val parent = VaultPaths.parent(rel)
        ensureDir(parent)
        // A neutral type, so the provider keeps the name exactly as given (no extension added).
        val made = DocumentsContract.createDocument(resolver, uri(parent), "application/octet-stream", VaultPaths.name(rel))
            ?: throw VaultError("failed", "Cannot create: $path")
        resolver.openOutputStream(made, "wt")?.use { it.write(text.toByteArray(Charsets.UTF_8)) }
        return note(rel)
    }

    /** Moves a note to another path; null when the target is taken. */
    fun rename(from: String, to: String): Stat? {
        val src = VaultPaths.check(from)
        val dst = VaultPaths.check(to)
        note(src)
        if (stat(dst) != null) return null
        moveTo(src, dst)
        return note(dst)
    }

    private fun moveTo(src: String, dst: String) {
        val dstParent = VaultPaths.parent(dst)
        ensureDir(dstParent)
        var at = src
        if (VaultPaths.parent(src) != dstParent) {
            DocumentsContract.moveDocument(resolver, uri(src), uri(VaultPaths.parent(src)), uri(dstParent))
                ?: throw VaultError("failed", "Cannot move: $src")
            at = if (dstParent.isEmpty()) VaultPaths.name(src) else "$dstParent/${VaultPaths.name(src)}"
        }
        if (VaultPaths.name(at) != VaultPaths.name(dst)) {
            DocumentsContract.renameDocument(resolver, uri(at), VaultPaths.name(dst))
                ?: throw VaultError("failed", "Cannot rename: $at")
        }
    }

    /**
     * Moves a note to the vault's own `.trash` folder (what Obsidian does with its "vault trash"
     * setting): it is never deleted for good, and Undo writes it back.
     */
    fun trash(path: String) {
        val rel = VaultPaths.check(path)
        note(rel)
        val base = VaultPaths.name(rel).removeSuffix(".md")
        var target = ".trash/${VaultPaths.name(rel)}"
        var i = 2
        while (stat(target) != null) target = ".trash/$base ${i++}.md"
        moveTo(rel, target)
    }

    fun requireNote(path: String): String = VaultPaths.check(path).also { note(it) }

    companion object {
        /** The index of parsed notes lives in the app's own files: per device, never in the vault. */
        fun cacheFile(context: Context) = File(context.filesDir, "vault-index.json")
    }
}
