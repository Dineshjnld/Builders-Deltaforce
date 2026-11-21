package org.deltaforce.fieldos

import android.app.Activity
import android.app.Instrumentation
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.speech.RecognitionSupport
import android.speech.RecognitionSupportCallback
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class VoiceSmoke : Instrumentation() {
    override fun onCreate(arguments: Bundle?) {
        super.onCreate(arguments)
        start()
    }

    override fun onStart() {
        val lines = mutableListOf<String>()
        val done = CountDownLatch(1)
        val context = targetContext
        runOnMainSync {
            val local = Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(context)
            lines += "On-device service: " + local
            lines += "System service: " + SpeechRecognizer.isRecognitionAvailable(context)
            if (local && Build.VERSION.SDK_INT >= 33) {
                val engine = SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
                engine.checkRecognitionSupport(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                    .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM),
                    context.mainExecutor, object : RecognitionSupportCallback {
                    override fun onSupportResult(support: RecognitionSupport) {
                        lines += "Installed offline: " + support.installedOnDeviceLanguages
                        lines += "Available offline downloads: " + support.supportedOnDeviceLanguages
                        lines += "Pending offline downloads: " + support.pendingOnDeviceLanguages
                        engine.destroy()
                        done.countDown()
                    }

                    override fun onError(error: Int) {
                        lines += "Offline support query error: " + error
                        engine.destroy()
                        done.countDown()
                    }
                })
            } else done.countDown()
        }
        val answered = done.await(12, TimeUnit.SECONDS)
        finish(if (answered) Activity.RESULT_OK else Activity.RESULT_CANCELED, Bundle().apply {
            putString("stream", lines.joinToString("\n", "\n", "\n"))
        })
    }
}