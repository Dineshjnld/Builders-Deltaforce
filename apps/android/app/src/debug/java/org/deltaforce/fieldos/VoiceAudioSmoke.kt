package org.deltaforce.fieldos

import android.app.Activity
import android.app.Instrumentation
import android.content.Intent
import android.media.AudioFormat
import android.os.Build
import android.os.Bundle
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class VoiceAudioSmoke : Instrumentation() {
    override fun onCreate(arguments: Bundle?) {
        super.onCreate(arguments)
        start()
    }

    override fun onStart() {
        if (Build.VERSION.SDK_INT < 33 || !SpeechRecognizer.isOnDeviceRecognitionAvailable(targetContext)) {
            finish(Activity.RESULT_CANCELED, Bundle().apply { putString("stream", "Offline audio input is unavailable.\n") })
            return
        }
        val wave = targetContext.assets.open("dictation-check.wav").use { it.readBytes() }
        val header = ByteBuffer.wrap(wave).order(ByteOrder.LITTLE_ENDIAN)
        var offset = 12
        while (String(wave, offset, 4, Charsets.US_ASCII) != "data") {
            val chunkLength = header.getInt(offset + 4)
            offset += 8 + chunkLength + (chunkLength and 1)
        }
        val path = File.createTempFile("voice-smoke", ".pcm", targetContext.cacheDir)
        path.writeBytes(wave.copyOfRange(offset + 8, offset + 8 + header.getInt(offset + 4)))
        val descriptor = ParcelFileDescriptor.open(path, ParcelFileDescriptor.MODE_READ_ONLY)
        val done = CountDownLatch(1)
        var transcript = ""
        var error = 0
        var engine: SpeechRecognizer? = null
        val startTime = SystemClock.elapsedRealtime()
        try {
            runOnMainSync {
                engine = SpeechRecognizer.createOnDeviceSpeechRecognizer(targetContext).also { recognizer ->
                    recognizer.setRecognitionListener(object : RecognitionListener {
                        override fun onResults(results: Bundle?) {
                            append(results)
                            done.countDown()
                        }
                        override fun onSegmentResults(results: Bundle) { append(results) }
                        override fun onEndOfSegmentedSession() { done.countDown() }
                        override fun onError(errorCode: Int) { error = errorCode; done.countDown() }
                        override fun onReadyForSpeech(params: Bundle?) {}
                        override fun onBeginningOfSpeech() {}
                        override fun onEndOfSpeech() {}
                        override fun onRmsChanged(rmsdB: Float) {}
                        override fun onBufferReceived(buffer: ByteArray?) {}
                        override fun onPartialResults(partialResults: Bundle?) {}
                        override fun onEvent(eventType: Int, params: Bundle?) {}
                        private fun append(bundle: Bundle?) {
                            bundle?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.let {
                                transcript = (transcript + " " + it).trim()
                            }
                        }
                    })
                    recognizer.startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                        .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                        .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-IN")
                        .putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE, descriptor)
                        .putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_CHANNEL_COUNT, 1)
                        .putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_ENCODING, AudioFormat.ENCODING_PCM_16BIT)
                        .putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_SAMPLING_RATE, 16000)
                        .putExtra(RecognizerIntent.EXTRA_SEGMENTED_SESSION, RecognizerIntent.EXTRA_AUDIO_SOURCE))
                }
            }
            val answered = done.await(15, TimeUnit.SECONDS)
            val elapsed = SystemClock.elapsedRealtime() - startTime
            val matched = transcript.contains("waste", ignoreCase = true) && transcript.contains("market", ignoreCase = true)
            finish(if (matched) Activity.RESULT_OK else Activity.RESULT_CANCELED, Bundle().apply {
                putString("stream", "\nOffline English audio fixture: matched=" + matched + ", callback=" + answered +
                    ", errorCode=" + error + ", totalMs=" + elapsed + "\n")
            })
        } finally {
            runOnMainSync { engine?.destroy() }
            descriptor.close()
            path.delete()
        }
    }
}