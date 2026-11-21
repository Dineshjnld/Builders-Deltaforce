package org.deltaforce.fieldos

import android.annotation.SuppressLint
import android.content.res.AssetManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import com.k2fsa.sherpa.onnx.FeatureConfig
import com.k2fsa.sherpa.onnx.OfflineModelConfig
import com.k2fsa.sherpa.onnx.OfflineNemoEncDecCtcModelConfig
import com.k2fsa.sherpa.onnx.OfflineRecognizer
import com.k2fsa.sherpa.onnx.OfflineRecognizerConfig
import com.k2fsa.sherpa.onnx.OfflineWhisperModelConfig
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.abs

internal const val VOICE_SAMPLE_RATE = 16_000
private const val CAPTURE_LIMIT_SECONDS = 20

internal class RegionalVoiceCapture {
    private val stopped = AtomicBoolean(false)

    fun stop() { stopped.set(true) }

    @SuppressLint("MissingPermission")
    fun record(): ShortArray {
        val minimum = AudioRecord.getMinBufferSize(VOICE_SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        check(minimum > 0) { "Microphone format is unavailable." }
        val recorder = AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, VOICE_SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(minimum * 2, 6400))
        try {
            check(recorder.state == AudioRecord.STATE_INITIALIZED) { "Microphone is unavailable." }
            val samples = ShortArray(VOICE_SAMPLE_RATE * CAPTURE_LIMIT_SECONDS)
            var size = 0
            recorder.startRecording()
            check(recorder.recordingState == AudioRecord.RECORDSTATE_RECORDING) { "Could not start microphone." }
            while (!stopped.get() && size < samples.size) {
                val count = recorder.read(samples, size, minOf(1600, samples.size - size))
                check(count > 0) { "Microphone recording was interrupted." }
                size += count
            }
            return samples.copyOf(size)
        } finally {
            if (recorder.recordingState == AudioRecord.RECORDSTATE_RECORDING) recorder.stop()
            recorder.release()
        }
    }
}

internal data class RegionalTranscript(val text: String, val detectedLanguages: List<RegionalLanguage>)

internal class RegionalSpeech(private val assets: AssetManager, private val hindiPack: HindiSpeechPack) {
    private data class Chunk(val text: String, val language: RegionalLanguage?)

    fun transcribe(samples: ShortArray, selectedLanguage: RegionalLanguage?): RegionalTranscript {
        val segments = if (selectedLanguage == null) speechSegments(samples) else {
            listOf(samples).filter(::containsSpeech)
        }
        if (segments.isEmpty()) return RegionalTranscript("", emptyList())
        val chunks = decode(segments, selectedLanguage).toMutableList()
        if (selectedLanguage == null) {
            val refinements = listOf(RegionalLanguage.Telugu) +
                if (hindiPack.isReady()) listOf(RegionalLanguage.Hindi) else emptyList()
            for (language in refinements) {
                val indices = chunks.indices.filter { chunks[it].language == language }
                if (indices.isNotEmpty()) {
                    val corrected = decode(indices.map { segments[it] }, language)
                    indices.zip(corrected).forEach { (index, chunk) ->
                        if (chunk.text.isNotBlank()) chunks[index] = chunks[index].copy(text = chunk.text)
                    }
                }
            }
        }
        return RegionalTranscript(
            chunks.map { it.text }.filter(String::isNotBlank).joinToString("\n"),
            if (selectedLanguage == null) chunks.mapNotNull { it.language }.distinct() else emptyList()
        )
    }

    private fun decode(segments: List<ShortArray>, selectedLanguage: RegionalLanguage?): List<Chunk> {
        val telugu = selectedLanguage == RegionalLanguage.Telugu
        val prefix = if (telugu) "asr/telugu/" else "asr/tiny-"
        val useHindiPack = selectedLanguage == RegionalLanguage.Hindi && hindiPack.isReady()
        val model = if (useHindiPack) {
            OfflineModelConfig(nemo = OfflineNemoEncDecCtcModelConfig(model = hindiPack.model.absolutePath),
                tokens = hindiPack.tokens.absolutePath, numThreads = 2)
        } else {
            OfflineModelConfig(
                whisper = OfflineWhisperModelConfig(
                    encoder = prefix + "encoder.int8.onnx",
                    decoder = prefix + "decoder.int8.onnx",
                    language = selectedLanguage?.tag.orEmpty(),
                    task = "transcribe"
                ),
                tokens = prefix + "tokens.txt", numThreads = 2
            )
        }
        val recognizer = OfflineRecognizer(if (useHindiPack) null else assets, OfflineRecognizerConfig(
            featConfig = FeatureConfig(sampleRate = VOICE_SAMPLE_RATE, featureDim = 80),
            modelConfig = model
        ))
        try {
            return segments.map { segment ->
                val stream = recognizer.createStream()
                try {
                    if (selectedLanguage == null) stream.setOption("language_candidates", "en,te,hi")
                    stream.acceptWaveform(FloatArray(segment.size) { segment[it] / 32768f }, VOICE_SAMPLE_RATE)
                    recognizer.decode(stream)
                    val result = recognizer.getResult(stream)
                    Chunk(result.text.trim(), RegionalLanguage.forTag(result.lang.trim('<', '|', '>')))
                } finally {
                    stream.release()
                }
            }
        } finally {
            recognizer.release()
        }
    }
}

private fun containsSpeech(samples: ShortArray): Boolean =
    samples.size >= VOICE_SAMPLE_RATE / 3 && samples.any { abs(it.toInt()) >= 350 }

private fun speechSegments(samples: ShortArray): List<ShortArray> {
    val frame = VOICE_SAMPLE_RATE / 50
    val result = mutableListOf<ShortArray>()
    var start = 0
    var quietFrames = 0
    for (position in 0 until samples.size step frame) {
        val end = minOf(position + frame, samples.size)
        val mean = (position until end).sumOf { abs(samples[it].toInt()) } / (end - position)
        quietFrames = if (mean < 220) quietFrames + 1 else 0
        val length = end - start
        if ((quietFrames >= 17 && length >= VOICE_SAMPLE_RATE) || length >= VOICE_SAMPLE_RATE * 8) {
            samples.copyOfRange(start, end).takeIf(::containsSpeech)?.let(result::add)
            start = end
            quietFrames = 0
        }
    }
    if (start < samples.size) samples.copyOfRange(start, samples.size).takeIf(::containsSpeech)?.let(result::add)
    return result
}

internal fun voiceWav(samples: ShortArray): ByteArray {
    val bytes = samples.size * 2
    val buffer = ByteBuffer.allocate(44 + bytes).order(ByteOrder.LITTLE_ENDIAN)
    buffer.put("RIFF".toByteArray()).putInt(36 + bytes).put("WAVEfmt ".toByteArray())
    buffer.putInt(16).putShort(1).putShort(1).putInt(VOICE_SAMPLE_RATE)
    buffer.putInt(VOICE_SAMPLE_RATE * 2).putShort(2).putShort(16).put("data".toByteArray()).putInt(bytes)
    samples.forEach(buffer::putShort)
    return buffer.array()
}
