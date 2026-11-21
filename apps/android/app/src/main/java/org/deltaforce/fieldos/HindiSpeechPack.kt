package org.deltaforce.fieldos

import android.content.Context
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

internal class HindiSpeechPack(context: Context) {
    private val directory = File(context.filesDir, "speech/hi-7c3806fe")
    val model = File(directory, "model.int8.onnx")
    val tokens = File(directory, "tokens.txt")
    private val complete = File(directory, "verified")

    fun isReady(): Boolean = complete.isFile && model.length() == MODEL_BYTES && tokens.length() == TOKEN_BYTES

    fun prepare() = synchronized(lock) {
        if (!isReady()) {
            check(directory.isDirectory || directory.mkdirs()) { "Cannot save Hindi speech files." }
            fetch(model, MODEL_BYTES, "fc0c7db7c0e0c11d4ed540dc2cddca03a42fcba3568a0e0607c3631d87fa9f8a")
            fetch(tokens, TOKEN_BYTES, "ee60967630213f31951817ac8b402b92ec18cce80718a24a49b388e56672dfb2")
            complete.writeText("verified")
        }
    }

    private fun fetch(file: File, bytes: Long, sha256: String) {
        val temporary = File(file.parentFile, file.name + ".part")
        val connection = URL(BASE + file.name).openConnection() as HttpURLConnection
        connection.connectTimeout = 12_000
        connection.readTimeout = 30_000
        try {
            check(connection.responseCode == HttpURLConnection.HTTP_OK) { "Hindi speech download failed." }
            val digest = MessageDigest.getInstance("SHA-256")
            val buffer = ByteArray(64 * 1024)
            var total = 0L
            connection.inputStream.use { source ->
                temporary.outputStream().use { target ->
                    while (true) {
                        if (Thread.currentThread().isInterrupted) throw InterruptedException()
                        val count = source.read(buffer)
                        if (count < 0) break
                        total += count
                        check(total <= bytes) { "Unexpected Hindi model size." }
                        digest.update(buffer, 0, count)
                        target.write(buffer, 0, count)
                    }
                }
            }
            val actual = digest.digest().joinToString("") { "%02x".format(it.toInt() and 255) }
            check(total == bytes && actual == sha256) { "Hindi speech model verification failed." }
            check(temporary.renameTo(file)) { "Could not save the Hindi speech model." }
        } finally {
            connection.disconnect()
            temporary.delete()
        }
    }

    private companion object {
        val lock = Any()
        const val BASE = "https://huggingface.co/ngiftsun/indicconformer-hi-int8-sherpa/resolve/7c3806fe01eb9b50784f09fe22cfeabf642c218e/"
        const val MODEL_BYTES = 140_451_556L
        const val TOKEN_BYTES = 67_605L
    }
}
