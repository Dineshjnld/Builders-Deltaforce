package org.deltaforce.fieldos

import android.app.Activity
import android.app.Instrumentation
import android.os.Bundle
import kotlinx.coroutines.runBlocking

class ModelSmoke : Instrumentation() {
    override fun onCreate(arguments: Bundle?) {
        super.onCreate(arguments)
        start()
    }

    override fun onStart() {
        val results = mutableListOf<String>()
        runBlocking {
            DesertAntModels(targetContext).prepare { progress ->
                if (!progress.endsWith("Preparing")) results.add(progress)
                sendStatus(0, Bundle().apply { putString("stream", progress + "\n") })
            }
        }
        val success = results.size == 4 && results.all { it.endsWith(" · Ready") }
        finish(if (success) Activity.RESULT_OK else Activity.RESULT_CANCELED, Bundle().apply {
            putString("stream", results.joinToString("\n", "\n", "\n"))
        })
    }
}