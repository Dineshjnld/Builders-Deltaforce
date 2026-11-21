package org.deltaforce.fieldos

import android.app.Activity
import android.app.Instrumentation
import android.os.Bundle
import android.os.SystemClock
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import java.nio.ByteBuffer
import java.nio.ByteOrder

class RegionalSmoke : Instrumentation() {
    private var test = "speech"

    override fun onCreate(arguments: Bundle?) {
        super.onCreate(arguments)
        test = arguments?.getString("test") ?: "speech"
        start()
    }

    override fun onStart() {
        var passed = false
        val start = SystemClock.elapsedRealtime()
        val result = runCatching {
            when (test) {
                "prepare-hindi" -> {
                    val pack = HindiSpeechPack(targetContext)
                    pack.prepare()
                    passed = pack.isReady()
                    "Hindi model downloaded and verified: " + passed
                }
                "translate" -> runBlocking {
                    withTimeout(140_000L) {
                        val source = "మార్కెట్ దగ్గర చెత్త ఉంది. नाली बंद है। Market entrance."
                        check(regionalRuns(source).mapNotNull { it.language }.distinct().size == 3)
                        val translator = RegionalTranslation()
                        val english = translator.translate(source, RegionalLanguage.English)
                        val telugu = translator.translate("The drain is blocked.", RegionalLanguage.Telugu)
                        val hindi = translator.translate("The drain is blocked.", RegionalLanguage.Hindi)
                        check(english.contains("Market entrance."))
                        check(regionalRuns(english).none { it.language == RegionalLanguage.Telugu || it.language == RegionalLanguage.Hindi })
                        check(regionalRuns(telugu).any { it.language == RegionalLanguage.Telugu })
                        check(regionalRuns(hindi).any { it.language == RegionalLanguage.Hindi })
                        passed = true
                        "Mixed text to English, English to Telugu, and English to Hindi passed."
                    }
                }
                "telugu" -> {
                    val result = RegionalSpeech(targetContext.assets, HindiSpeechPack(targetContext)).transcribe(samples("telugu-check.wav"), RegionalLanguage.Telugu)
                    passed = regionalRuns(result.text).any { it.language == RegionalLanguage.Telugu }
                    "Telugu transcription returned Telugu script=" + passed
                }
                "mixed" -> {
                    val audio = samples("dictation-check.wav") + ShortArray(8000) +
                        samples("telugu-check.wav").take(VOICE_SAMPLE_RATE * 7).toShortArray() + ShortArray(8000) +
                        samples("hindi-check.wav").take(VOICE_SAMPLE_RATE * 7).toShortArray()
                    val transcript = RegionalSpeech(targetContext.assets, HindiSpeechPack(targetContext)).transcribe(audio, null)
                    val scripts = regionalRuns(transcript.text).mapNotNull { it.language }.distinct()
                    passed = transcript.detectedLanguages.containsAll(RegionalLanguage.entries) && scripts.containsAll(RegionalLanguage.entries)
                    "Mixed audio detections: " + transcript.detectedLanguages.joinToString() + "; transcript scripts=" + scripts.joinToString()
                }
                else -> {
                    val transcript = RegionalSpeech(targetContext.assets, HindiSpeechPack(targetContext)).transcribe(samples("dictation-check.wav"), null)
                    passed = transcript.text.contains("market", ignoreCase = true) &&
                        RegionalLanguage.English in transcript.detectedLanguages
                    "English audio keyword check=" + transcript.text.contains("market", ignoreCase = true) +
                        "; detected=" + transcript.detectedLanguages.joinToString()
                }
            }
        }.getOrElse { it.javaClass.simpleName + ": " + it.message }
        finish(if (passed) Activity.RESULT_OK else Activity.RESULT_CANCELED, Bundle().apply {
            putString("stream", "\n" + result + " Elapsed " + (SystemClock.elapsedRealtime() - start) + " ms.\n")
        })
    }

    private fun samples(name: String): ShortArray {
        val bytes = targetContext.assets.open(name).use { it.readBytes() }
        val buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        check(buffer.getShort(22).toInt() == 1 && buffer.getInt(24) == VOICE_SAMPLE_RATE)
        val width = buffer.getShort(34).toInt() / 8
        val floatingPoint = buffer.getShort(20).toInt() == 3
        check(width == 2 || width == 3 || (width == 4 && floatingPoint))
        var offset = 12
        while (offset + 8 <= bytes.size) {
            val size = buffer.getInt(offset + 4)
            val begin = offset + 8
            check(size >= 0 && begin + size <= bytes.size)
            if (String(bytes, offset, 4, Charsets.US_ASCII) == "data") {
                return ShortArray(size / width) { index ->
                    val position = begin + index * width
                    if (floatingPoint) (buffer.getFloat(position).coerceIn(-1f, 1f) * 32767).toInt().toShort()
                    else buffer.getShort(position + width - 2)
                }
            }
            offset = begin + size + (size and 1)
        }
        error("Missing WAV audio data")
    }
}
