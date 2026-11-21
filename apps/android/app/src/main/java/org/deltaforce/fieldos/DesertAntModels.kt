package org.deltaforce.fieldos

import android.content.Context
import ai.desertant.clear.Clear
import ai.desertant.gist.Gist
import ai.desertant.redact.Redact
import ai.desertant.tongue.Tongue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

internal class DesertAntModels(private val context: Context) {
    private val state = context.getSharedPreferences("desert-ant-checks", Context.MODE_PRIVATE)
    fun checked(name: String): Boolean = state.getBoolean(name, false)
    private val tongue by lazy { Tongue.bundled(context) }

    fun language(text: String): String? = tongue.detect(text).let {
        if (it.isTooCloseToCall) null else it.language
    }

    suspend fun topics(text: String): List<String> = Gist(context).use { gist ->
        gist.classify(text).map { it.name }
    }

    suspend fun redact(text: String): String = Redact(context).use { it.redaction(text).redactedText }

    suspend fun prepare(onResult: suspend (String) -> Unit) {
        val sample = "Email the municipal officer at officer@example.com about the sanitation inspection."
        val checks: List<Pair<String, suspend () -> Unit>> = listOf(
            "Tongue" to { check(language(sample) == "en") { "Unexpected language result." } },
            "Redact" to { check("officer@example.com" !in redact(sample)) { "Sample email was not masked." } },
            "Gist" to { topics(sample); Unit },
            "Clear" to {
                Clear(context).use { it.enhance(FloatArray(48_000), 48_000.0) }
                Unit
            }
        )
        for ((name, checkModel) in checks) {
            onResult("$name · Preparing")
            val status = try {
                withContext(Dispatchers.IO) { checkModel() }
                "Ready"
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Exception) {
                "Unavailable · " + (error.message ?: error.javaClass.simpleName)
            } catch (error: LinkageError) {
                "Unavailable · " + (error.message ?: error.javaClass.simpleName)
            }
            withContext(Dispatchers.IO) { state.edit().putBoolean(name, status == "Ready").commit() }
            onResult("$name · $status")
        }
    }
}