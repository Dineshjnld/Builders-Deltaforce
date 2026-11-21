package org.deltaforce.fieldos

import com.google.android.gms.tasks.Task
import com.google.mlkit.common.model.DownloadConditions
import com.google.mlkit.nl.translate.Translation
import com.google.mlkit.nl.translate.Translator
import com.google.mlkit.nl.translate.TranslatorOptions
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

internal enum class RegionalLanguage(val tag: String, val label: String) {
    English("en", "English"),
    Telugu("te", "తెలుగు"),
    Hindi("hi", "हिन्दी");

    val speechTag: String get() = tag + "-IN"

    companion object {
        fun forTag(tag: String) = entries.firstOrNull { it.tag == tag.substringBefore('-') }
    }
}

internal data class LanguageRun(val language: RegionalLanguage?, val text: String)

/** Segment native-script text without guessing a language for numbers or punctuation. */
internal fun regionalRuns(input: String): List<LanguageRun> {
    val result = mutableListOf<LanguageRun>()
    val buffer = StringBuilder()
    var language: RegionalLanguage? = null
    var index = 0
    while (index < input.length) {
        val character = input.codePointAt(index)
        val script = when (Character.UnicodeScript.of(character)) {
            Character.UnicodeScript.TELUGU -> RegionalLanguage.Telugu
            Character.UnicodeScript.DEVANAGARI -> RegionalLanguage.Hindi
            Character.UnicodeScript.LATIN -> RegionalLanguage.English
            else -> null
        }
        if (script != null && language != null && script != language) {
            result.add(LanguageRun(language, buffer.toString()))
            buffer.clear()
        }
        language = script ?: language
        buffer.appendCodePoint(character)
        index += Character.charCount(character)
    }
    if (buffer.isNotEmpty()) result.add(LanguageRun(language, buffer.toString()))
    return result
}

internal class RegionalTranslation {
    suspend fun translate(input: String, target: RegionalLanguage, source: RegionalLanguage? = null): String {
        val runs = if (source == null) regionalRuns(input) else listOf(LanguageRun(source, input))
        val clients = mutableMapOf<RegionalLanguage, Translator>()
        try {
            val output = StringBuilder()
            for ((language, text) in runs) {
                if (language == null || language == target || text.isBlank()) {
                    output.append(text)
                    continue
                }
                val client = clients[language] ?: Translation.getClient(
                    TranslatorOptions.Builder().setSourceLanguage(language.tag).setTargetLanguage(target.tag).build()
                ).also {
                    clients[language] = it
                    it.downloadModelIfNeeded(DownloadConditions.Builder().build()).awaitResult()
                }
                val translated = client.translate(text.trim()).awaitResult()
                output.append(text.takeWhile(Char::isWhitespace))
                output.append(translated.trim())
                output.append(text.takeLastWhile(Char::isWhitespace))
            }
            return output.toString()
        } finally {
            clients.values.forEach(Translator::close)
        }
    }
}

private suspend fun <T> Task<T>.awaitResult(): T = suspendCancellableCoroutine { continuation ->
    addOnCompleteListener { result ->
        when {
            result.isSuccessful -> continuation.resume(result.result)
            result.isCanceled -> continuation.cancel()
            else -> continuation.resumeWithException(result.exception ?: IllegalStateException("Translation failed."))
        }
    }
}
