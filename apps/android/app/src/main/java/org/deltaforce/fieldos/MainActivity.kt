package org.deltaforce.fieldos

import android.Manifest
import android.content.Context
import android.content.res.Configuration
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.location.LocationManager
import android.media.MediaRecorder
import android.media.MediaDataSource
import android.media.MediaPlayer
import android.os.Bundle
import android.os.SystemClock
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Base64
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.core.view.WindowCompat
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.delay
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyStore
import java.time.LocalDate
import java.util.UUID
import java.util.Locale
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

private val categories = listOf("Waste accumulation", "Blocked drainage", "Facility maintenance", "Other")

class MainActivity : ComponentActivity() {
    private var recorder: MediaRecorder? = null
    private var player: MediaPlayer? = null
    private val model: EdgeModel = RuleBasedAdapter()
    private val desertAnt by lazy { DesertAntModels(applicationContext) }
    private var recognizer: SpeechRecognizer? = null
    private var regionalCapture: RegionalVoiceCapture? = null
    private val vault by lazy { DraftVault(filesDir) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.getInsetsController(window, window.decorView).isAppearanceLightStatusBars = true
        setContent {
            MaterialTheme(colorScheme = lightColorScheme(primary = Color(0xff0b6a65), secondary = Color(0xff23539a), background = Color(0xffedf2f8), surface = Color.White, onSurface = Color(0xff172946), primaryContainer = Color(0xffd8f2ee), onPrimaryContainer = Color(0xff06453f))) {
                FieldWorkspace()
            }
        }
    }

    @Composable
    private fun FieldWorkspace() {
        val scope = rememberCoroutineScope()
        val settings = remember { getSharedPreferences("fieldos-settings", Context.MODE_PRIVATE) }
        var interfaceLanguage by remember {
            mutableStateOf(RegionalLanguage.forTag(settings.getString("ui-language", "en").orEmpty()) ?: RegionalLanguage.English)
        }
        val localized = remember(interfaceLanguage) {
            createConfigurationContext(Configuration(resources.configuration).apply {
                setLocale(Locale.forLanguageTag(interfaceLanguage.tag))
            })
        }
        fun tr(id: Int, vararg args: Any) = localized.getString(id, *args)
        var interfaceMenu by remember { mutableStateOf(false) }
        var stored by remember { mutableStateOf(runCatching { vault.read() }.getOrDefault(JSONObject())) }
        val emulator = android.os.Build.MODEL.startsWith("sdk_gphone") || android.os.Build.HARDWARE == "ranchu"
        val usbUrl = "http://127.0.0.1:8787"
        var server by remember {
            val saved = stored.optString("server", if (emulator) "http://10.0.2.2:8787" else usbUrl)
            mutableStateOf(if (!emulator && saved == "http://10.0.2.2:8787") usbUrl else saved)
        }
        var page by remember { mutableIntStateOf(if (stored.optBoolean("queued")) 2 else 0) }
        var prepareBusy by remember { mutableStateOf(false) }
        val modelStatuses = remember { mutableStateMapOf<String, String>() }
        var email by remember { mutableStateOf(stored.optString("email")) }
        var token by remember { mutableStateOf(stored.optString("token")) }
        var draftOwner by remember { mutableStateOf(stored.optString("draftOwner")) }
        var draftServer by remember { mutableStateOf(stored.optString("draftServer")) }
        var password by remember { mutableStateOf("") }
        var id by remember { mutableStateOf(stored.optString("id", UUID.randomUUID().toString())) }
        var date by remember { mutableStateOf(stored.optString("date", LocalDate.now().toString())) }
        var location by remember { mutableStateOf(stored.optString("location")) }
        var transcript by remember { mutableStateOf(stored.optString("transcript")) }
        var observations by remember { mutableStateOf(stored.optString("observations")) }
        var category by remember { mutableStateOf(stored.optString("category", "Other")) }
        var photo by remember { mutableStateOf(stored.optString("photo")) }
        var version by remember { mutableIntStateOf(stored.optInt("version")) }
        var queued by remember { mutableStateOf(stored.optBoolean("queued")) }
        var recording by remember { mutableStateOf(false) }
        var audioSaved by remember { mutableStateOf(vault.hasAudio()) }
        var listening by remember { mutableStateOf(false) }
        var voiceLanguage by remember { mutableStateOf<RegionalLanguage?>(RegionalLanguage.English) }
        var voiceMenu by remember { mutableStateOf(false) }
        val hindiPack = remember { HindiSpeechPack(applicationContext) }
        var hindiPackReady by remember { mutableStateOf(hindiPack.isReady()) }
        var hindiPackBusy by remember { mutableStateOf(false) }
        var regionalBusy by remember { mutableStateOf(false) }
        var detectedVoice by remember { mutableStateOf(emptyList<RegionalLanguage>()) }
        var translationTarget by remember(interfaceLanguage) { mutableStateOf(interfaceLanguage) }
        var translationMenu by remember { mutableStateOf(false) }
        var translationBusy by remember { mutableStateOf(false) }
        var translation by remember(transcript, translationTarget) { mutableStateOf("") }
        var finishingSpeech by remember { mutableStateOf(false) }
        var partialSpeech by remember { mutableStateOf("") }
        var voiceStatus by remember { mutableStateOf("") }
        var busy by remember { mutableStateOf(false) }
        var statuses by remember { mutableStateOf(JSONArray()) }
        var message by remember { mutableStateOf("") }
        var draftSaveFailed by remember { mutableStateOf(false) }
        var execution by remember { mutableStateOf(stored.optString("execution")) }
        val audioTemp = remember { File(cacheDir, "capture.m4a") }
        fun payload() = JSONObject().put("id", id).put("date", date).put("location", location)
            .put("transcript", transcript).put("observations", observations).put("category", category)
            .put("photo", photo).put("version", version)
        fun save() {
            val state = payload().put("server", server).put("email", email).put("token", token)
                .put("queued", queued).put("execution", execution).put("draftOwner", draftOwner).put("draftServer", draftServer)
            vault.write(state)
            stored = state
            draftSaveFailed = false
        }
        val draftChanged = date != stored.optString("date", date) ||
            location != stored.optString("location") || transcript != stored.optString("transcript") ||
            observations != stored.optString("observations") || category != stored.optString("category", "Other")
        LaunchedEffect(token, date, location, transcript, observations, category) {
            if (token.isNotEmpty() && !queued && draftChanged) {
                delay(450)
                draftSaveFailed = runCatching { save() }.isFailure
            }
        }
        val validDate = remember(date) { runCatching { LocalDate.parse(date) }.isSuccess }
        val captureMissing = listOfNotNull(
            tr(R.string.inspection_date_short).takeUnless { validDate },
            tr(R.string.location_short).takeIf { location.isBlank() },
            tr(R.string.evidence_photo).takeIf { photo.isBlank() }
        )
        val inspectionMissing = captureMissing + listOfNotNull(tr(R.string.verified_observations_short).takeIf { observations.isBlank() })
        val keyboardOpen = WindowInsets.ime.getBottom(LocalDensity.current) > 0
        fun categoryLabel(value: String) = tr(when (value) {
            "Waste accumulation" -> R.string.category_waste
            "Blocked drainage" -> R.string.category_drain
            "Facility maintenance" -> R.string.category_facility
            else -> R.string.category_other
        })
        var categoryMenu by remember { mutableStateOf(false) }
        fun openPage(index: Int) {
            if (draftChanged && runCatching { save() }.isFailure) {
                draftSaveFailed = true
                message = tr(R.string.save_failure)
                return
            }
            page = index
            message = ""
        }
        fun network(action: suspend () -> Unit) {
            if (busy) return
            busy = true
            scope.launch {
                try { action() }
                catch (error: Exception) {
                    if (error is CancellationException) throw error
                    if (error is WorkspaceAuthenticationException) {
                        token = ""
                        save()
                    }
                    message = error.message ?: "Operation failed."
                }
                finally { busy = false }
            }
        }
        fun startAudio() {
            try {
                audioTemp.delete()
                @Suppress("DEPRECATION")
                val next = MediaRecorder()
                recorder = next
                next.setAudioSource(MediaRecorder.AudioSource.MIC)
                next.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                next.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                next.setOutputFile(audioTemp.absolutePath)
                next.prepare()
                next.start()
                recording = true
                voiceStatus = tr(R.string.memo_recording)
            } catch (error: Exception) {
                recorder?.release()
                recorder = null
                voiceStatus = error.message ?: "Could not start recording."
            }
        }
        fun prepareHindiVoice() {
            if (hindiPackBusy || hindiPackReady) return
            hindiPackBusy = true
            voiceStatus = tr(R.string.preparing_hindi)
            scope.launch {
                try {
                    withContext(Dispatchers.IO) { hindiPack.prepare() }
                    hindiPackReady = hindiPack.isReady()
                    voiceStatus = tr(R.string.hindi_ready)
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (_: Exception) {
                    voiceStatus = tr(R.string.hindi_download_failed)
                } finally {
                    hindiPackBusy = false
                }
            }
        }

        fun startRegionalDictation(language: RegionalLanguage?) {
            if (regionalCapture != null || recording || listening) return
            val capture = RegionalVoiceCapture()
            regionalCapture = capture
            player?.release()
            player = null
            partialSpeech = ""
            detectedVoice = emptyList()
            listening = true
            voiceStatus = tr(R.string.recording_clip)
            scope.launch {
                try {
                    val samples = withContext(Dispatchers.IO) { capture.record() }
                    regionalBusy = true
                    voiceStatus = tr(R.string.working_offline)
                    if (samples.isNotEmpty()) {
                        withContext(Dispatchers.IO) { vault.writeAudio(voiceWav(samples)) }
                        audioSaved = true
                    }
                    val start = SystemClock.elapsedRealtime()
                    val result = withContext(Dispatchers.Default) {
                        RegionalSpeech(assets, hindiPack).transcribe(samples, language)
                    }
                    val latency = SystemClock.elapsedRealtime() - start
                    detectedVoice = result.detectedLanguages
                    if (result.text.isBlank()) {
                        voiceStatus = tr(R.string.no_speech)
                    } else {
                        transcript = listOf(transcript.trim(), result.text).filter(String::isNotBlank).joinToString("\n")
                        execution = "Whisper tiny · on device · " + latency + " ms"
                        save()
                        voiceStatus = tr(R.string.speech_added) + " · " + latency + " ms"
                        if (language == null && detectedVoice.isEmpty()) voiceStatus += " · " + tr(R.string.detect_unknown)
                    }
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (error: Exception) {
                    voiceStatus = error.message ?: tr(R.string.voice_unavailable)
                } catch (error: LinkageError) {
                    voiceStatus = error.message ?: tr(R.string.voice_unavailable)
                } finally {
                    regionalCapture = null
                    listening = false
                    regionalBusy = false
                    finishingSpeech = false
                }
            }
        }
        fun startTranscription() {
            val language = voiceLanguage
            if (language != RegionalLanguage.English) {
                startRegionalDictation(language)
                return
            }
            val locale = language.speechTag
            if (android.os.Build.VERSION.SDK_INT < 31 || !SpeechRecognizer.isOnDeviceRecognitionAvailable(this)) {
                startRegionalDictation(language)
                return
            }
            player?.release()
            player = null
            detectedVoice = emptyList()
            if (recognizer == null) recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(this)
            val engine = checkNotNull(recognizer)
            val startedAt = SystemClock.elapsedRealtime()
            var speechEndedAt: Long? = null
            partialSpeech = ""
            finishingSpeech = false
            engine.setRecognitionListener(object : RecognitionListener {
                override fun onResults(results: Bundle?) {
                    listening = false
                    finishingSpeech = false
                    val best = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.trim()
                    if (best.isNullOrEmpty()) {
                        voiceStatus = tr(R.string.no_speech)
                        return
                    }
                    transcript = listOf(transcript.trim(), best).filter { it.isNotEmpty() }.joinToString("\n")
                    val elapsed = SystemClock.elapsedRealtime() - (speechEndedAt ?: startedAt)
                    val route = "Android on-device speech"
                    val timing = if (speechEndedAt != null) "after speech" else "from start"
                    execution = route + " · " + locale + " · " + elapsed + " ms " + timing
                    voiceStatus = tr(R.string.speech_added) + " · " + elapsed + " ms"
                    partialSpeech = ""
                    save()
                }

                override fun onError(error: Int) {
                    listening = false
                    finishingSpeech = false
                    voiceStatus = when (error) {
                        SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE -> "This offline language pack is missing. Try English offline or Android speech."
                        SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED -> "This speech service does not support the selected language."
                        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> tr(R.string.microphone_denied)
                        SpeechRecognizer.ERROR_SPEECH_TIMEOUT, SpeechRecognizer.ERROR_NO_MATCH -> tr(R.string.no_speech)
                        SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Android speech needs a working internet connection. Try English offline."
                        SpeechRecognizer.ERROR_AUDIO -> tr(R.string.voice_unavailable)
                        else -> "Speech service error " + error + ". Tap Dictate to retry or save a voice memo."
                    }
                }

                override fun onReadyForSpeech(params: Bundle?) { voiceStatus = tr(R.string.listening_ready) }
                override fun onBeginningOfSpeech() { voiceStatus = tr(R.string.listening) }
                override fun onEndOfSpeech() {
                    speechEndedAt = SystemClock.elapsedRealtime()
                    finishingSpeech = true
                    voiceStatus = tr(R.string.finishing_dictation)
                }

                override fun onPartialResults(results: Bundle?) {
                    val next = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
                    if (!next.isNullOrBlank()) partialSpeech = next
                }

                override fun onRmsChanged(rmsdB: Float) {}
                override fun onBufferReceived(buffer: ByteArray?) {}
                override fun onEvent(eventType: Int, params: Bundle?) {}
            })
            listening = true
            voiceStatus = tr(R.string.starting_mic)
            try {
                engine.startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                    .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    .putExtra(RecognizerIntent.EXTRA_LANGUAGE, locale)
                    .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                    .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
                    .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true))
            } catch (error: IllegalStateException) {
                listening = false
                voiceStatus = tr(R.string.retry_voice)
            }
        }

        LaunchedEffect(listening, finishingSpeech) {
            if (!listening || regionalCapture != null) return@LaunchedEffect
            delay(if (finishingSpeech) 12_000L else 45_000L)
            recognizer?.destroy()
            recognizer = null
            listening = false
            finishingSpeech = false
            voiceStatus = tr(R.string.voice_timeout)
        }
        fun captureLocation() {
            val manager = getSystemService(Context.LOCATION_SERVICE) as LocationManager
            val fix = runCatching {
                manager.getProviders(true).mapNotNull { manager.getLastKnownLocation(it) }.maxByOrNull { it.time }
            }.getOrNull()
            if (fix == null) message = tr(R.string.location_no_fix)
            else {
                location = "%.5f, %.5f".format(java.util.Locale.US, fix.latitude, fix.longitude)
                save()
                message = tr(R.string.location_added)
            }
        }
        var transcribeAfterPermission by remember { mutableStateOf(false) }
        val microphone = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) { if (transcribeAfterPermission) startTranscription() else startAudio() }
            else voiceStatus = tr(R.string.microphone_denied)
        }
        val geo = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
            if (it) captureLocation() else message = tr(R.string.location_denied)
        }
        val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicturePreview()) { bitmap ->
            if (bitmap != null) {
                val bytes = ByteArrayOutputStream()
                bitmap.compress(Bitmap.CompressFormat.JPEG, 88, bytes)
                photo = Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP)
                save()
                message = tr(R.string.photo_saved)
            }
        }
        fun prepareModels() {
            prepareBusy = true
            scope.launch {
                try {
                    desertAnt.prepare { result -> modelStatuses[result.substringBefore(" · ")] = result.substringAfter(" · ") }
                } finally {
                    prepareBusy = false
                }
            }
        }
        Surface(modifier = Modifier.fillMaxSize().safeDrawingPadding().imePadding(), color = MaterialTheme.colorScheme.background) {
            Column(Modifier.fillMaxSize()) {
                val scroll = rememberScrollState()
                LaunchedEffect(page) { scroll.scrollTo(0) }
                Column(Modifier.weight(1f).verticalScroll(scroll).padding(horizontal = 18.dp, vertical = 14.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Surface(color = Color(0xff112a48), shape = RoundedCornerShape(20.dp), modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Surface(color = Color(0xffd9f2ea), shape = RoundedCornerShape(10.dp)) {
                                Text("Δ", Modifier.padding(horizontal = 10.dp, vertical = 3.dp),
                                    style = MaterialTheme.typography.titleLarge, color = Color(0xff0b5d55), fontWeight = FontWeight.Bold)
                            }
                            Column {
                                Text("DELTAFORCE", color = Color.White, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                                Text(tr(R.string.organization), color = Color(0xffc5d6e9), style = MaterialTheme.typography.bodySmall)
                            }
                        }
                        if (token.isNotEmpty()) {
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                WorkspacePill(tr(R.string.sanitation), Color(0xff294762), Modifier.weight(1f))
                                WorkspacePill(tr(R.string.edge_ai), Color(0xff11534f), Modifier.weight(1f))
                            }
                        }
                    }
                }
                Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
                    OutlinedButton(enabled = !listening && !recording, onClick = { interfaceMenu = true }) {
                        Text(tr(R.string.workspace_language) + " · " + interfaceLanguage.label)
                    }
                    DropdownMenu(expanded = interfaceMenu, onDismissRequest = { interfaceMenu = false }) {
                        RegionalLanguage.entries.forEach { option ->
                            DropdownMenuItem(text = { Text(option.label) }, onClick = {
                                interfaceLanguage = option
                                settings.edit().putString("ui-language", option.tag).apply()
                                interfaceMenu = false
                                message = ""
                                voiceStatus = ""
                            })
                        }
                    }
                }
                if (message.isNotEmpty()) Surface(shape = RoundedCornerShape(10.dp), color = MaterialTheme.colorScheme.primaryContainer) {
                    Text(message, Modifier.padding(12.dp), color = MaterialTheme.colorScheme.onPrimaryContainer)
                }
                if (token.isEmpty()) {
                    Text(tr(R.string.officer_sign_in), style = MaterialTheme.typography.titleLarge)
                    OutlinedTextField(server, { server = it }, label = { Text(tr(R.string.workspace_url)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    if (!emulator) Text(tr(R.string.usb_help, usbUrl), style = MaterialTheme.typography.bodySmall)
                    OutlinedTextField(email, { email = it }, label = { Text(tr(R.string.officer_email)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(password, { password = it }, label = { Text(tr(R.string.password)) }, singleLine = true,
                        visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), modifier = Modifier.fillMaxWidth())
                    Button(enabled = !busy, modifier = Modifier.fillMaxWidth(), onClick = { network {
                        val login = request(server, "", "login", JSONObject().put("email", email).put("password", password))
                        check(login.getString("role") == "officer") { "Sign in with a field officer account." }
                        val normalizedServer = server.trim().trimEnd('/')
                        val normalizedEmail = email.trim().lowercase(java.util.Locale.ROOT)
                        if (draftOwner.isNotEmpty() && (draftOwner != normalizedEmail || draftServer != normalizedServer)) {
                            id = UUID.randomUUID().toString()
                            version = 0
                            date = LocalDate.now().toString()
                            location = ""
                            transcript = ""
                            observations = ""
                            category = "Other"
                            photo = ""
                            queued = false
                            execution = ""
                            statuses = JSONArray()
                            vault.clearAudio()
                            audioSaved = false
                        }
                        server = normalizedServer
                        draftOwner = normalizedEmail
                        draftServer = normalizedServer
                        token = login.getString("token")
                        password = ""
                        save()
                        message = tr(R.string.signed_in)
                    } }) { Text(tr(R.string.sign_in)) }
                } else {
                    if (page == 0) {
                        SectionCard(tr(R.string.voice_card), tr(R.string.voice_subtitle), Color(0xffe3f6f4)) {
                            Box {
                                OutlinedButton(enabled = !listening && !recording, modifier = Modifier.fillMaxWidth(),
                                    onClick = { voiceMenu = true }) {
                                    Text(tr(R.string.choose_voice) + " · " + (voiceLanguage?.label ?: tr(R.string.voice_mixed)))
                                }
                                DropdownMenu(expanded = voiceMenu, onDismissRequest = { voiceMenu = false }) {
                                    (RegionalLanguage.entries + listOf(null)).forEach { option ->
                                        DropdownMenuItem(text = { Text(option?.label ?: tr(R.string.voice_mixed)) }, onClick = {
                                            voiceLanguage = option
                                            voiceStatus = ""
                                            detectedVoice = emptyList()
                                            voiceMenu = false
                                        })
                                    }
                                }
                            }
                            if (!hindiPackReady && (voiceLanguage == null || voiceLanguage == RegionalLanguage.Hindi)) {
                                Text(tr(R.string.hindi_model_hint), style = MaterialTheme.typography.bodySmall)
                                OutlinedButton(enabled = !hindiPackBusy && !listening && !queued,
                                    onClick = { prepareHindiVoice() }) {
                                    Text(tr(if (hindiPackBusy) R.string.preparing_hindi else R.string.prepare_hindi))
                                }
                            }
                            if (voiceLanguage != RegionalLanguage.English) Text(tr(R.string.offline_clip_hint), style = MaterialTheme.typography.bodySmall)
                            Button(enabled = !queued && !recording && !finishingSpeech && !regionalBusy &&
                                (voiceLanguage != RegionalLanguage.Hindi || hindiPackReady),
                                modifier = Modifier.fillMaxWidth(), onClick = {
                                    if (listening) {
                                        finishingSpeech = true
                                        regionalCapture?.stop() ?: recognizer?.stopListening()
                                    } else {
                                        transcribeAfterPermission = true
                                        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) startTranscription()
                                        else microphone.launch(Manifest.permission.RECORD_AUDIO)
                                    }
                                }) {
                                Text(tr(when {
                                    finishingSpeech || regionalBusy -> R.string.finishing_dictation
                                    listening -> R.string.finish_dictation
                                    voiceLanguage == RegionalLanguage.Telugu -> R.string.dictate_te
                                    voiceLanguage == RegionalLanguage.Hindi -> R.string.dictate_hi
                                    voiceLanguage == null -> R.string.dictate_mixed
                                    else -> R.string.dictate_en
                                }))
                            }
                            if (listening && regionalCapture == null) TextButton(onClick = {
                                recognizer?.destroy()
                                recognizer = null
                                listening = false
                                finishingSpeech = false
                                partialSpeech = ""
                                voiceStatus = ""
                            }) { Text(tr(R.string.cancel_dictation)) }
                            if (detectedVoice.isNotEmpty()) {
                                Text(tr(R.string.spoken_languages, detectedVoice.joinToString { it.label }),
                                    color = MaterialTheme.colorScheme.primary)
                            }
                            if (voiceStatus.isNotEmpty()) Text(voiceStatus, style = MaterialTheme.typography.bodyMedium)
                            if (partialSpeech.isNotEmpty()) {
                                Text(partialSpeech, style = MaterialTheme.typography.bodyLarge)
                                if (!listening) TextButton(onClick = {
                                    transcript = listOf(transcript.trim(), partialSpeech).filter { it.isNotBlank() }.joinToString("\n")
                                    partialSpeech = ""
                                    save()
                                }) { Text(tr(R.string.save_partial)) }
                            }
                            OutlinedButton(enabled = !queued && !listening, onClick = {
                                if (recording) {
                                    try {
                                        recorder?.stop()
                                        vault.writeAudio(audioTemp.readBytes())
                                        audioSaved = true
                                        voiceStatus = tr(R.string.memo_saved)
                                    } catch (error: Exception) {
                                        voiceStatus = error.message ?: "Recording failed."
                                    } finally {
                                        recorder?.release()
                                        recorder = null
                                        recording = false
                                        audioTemp.delete()
                                    }
                                } else {
                                    transcribeAfterPermission = false
                                    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) startAudio()
                                    else microphone.launch(Manifest.permission.RECORD_AUDIO)
                                }
                            }) { Text(if (recording) tr(R.string.stop_memo) else tr(R.string.record_memo)) }
                        }
                        if (audioSaved) OutlinedButton(enabled = !recording && !listening && !busy, onClick = { network {
                            val bytes = withContext(Dispatchers.IO) { vault.readAudio() }
                            player?.release()
                            val next = MediaPlayer()
                            player = next
                            next.setDataSource(object : MediaDataSource() {
                                override fun readAt(position: Long, buffer: ByteArray, offset: Int, size: Int): Int {
                                    if (position >= bytes.size) return -1
                                    val length = minOf(size, bytes.size - position.toInt())
                                    bytes.copyInto(buffer, offset, position.toInt(), position.toInt() + length)
                                    return length
                                }
                                override fun getSize() = bytes.size.toLong()
                                override fun close() { bytes.fill(0) }
                            })
                            next.setOnCompletionListener { completed -> completed.release(); player = null }
                            next.setOnErrorListener { failed, _, _ ->
                                failed.release()
                                player = null
                                message = tr(R.string.memo_failed)
                                true
                            }
                            next.setOnPreparedListener { it.start() }
                            next.prepareAsync()
                            message = tr(R.string.memo_playing)
                        } }) { Text(tr(R.string.play_memo)) }
                        OutlinedTextField(transcript, { transcript = it }, label = { Text(tr(R.string.notes)) }, enabled = !queued, modifier = Modifier.fillMaxWidth(), minLines = 2)
                        SectionCard(tr(R.string.site_evidence), tr(R.string.inspection_subtitle), Color.White) {
                            OutlinedTextField(date, { date = it }, label = { Text(tr(R.string.inspection_date)) }, enabled = !queued, modifier = Modifier.fillMaxWidth())
                            OutlinedTextField(location, { location = it }, label = { Text(tr(R.string.location)) }, enabled = !queued, modifier = Modifier.fillMaxWidth())
                            OutlinedButton(enabled = !queued, onClick = {
                                if (checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED) captureLocation()
                                else geo.launch(Manifest.permission.ACCESS_COARSE_LOCATION)
                            }) { Text(tr(R.string.cached_location)) }
                            OutlinedButton(enabled = !queued, onClick = {
                                try { camera.launch(null) } catch (_: Exception) { message = tr(R.string.camera_unavailable) }
                            }) { Text(if (photo.isEmpty()) tr(R.string.capture_photo) else tr(R.string.replace_photo)) }
                            if (photo.isNotBlank()) {
                                val preview = remember(photo) {
                                    runCatching { Base64.decode(photo, Base64.DEFAULT).let { BitmapFactory.decodeByteArray(it, 0, it.size) } }.getOrNull()
                                }
                                if (preview != null) Image(preview.asImageBitmap(), contentDescription = tr(R.string.captured_evidence),
                                    modifier = Modifier.fillMaxWidth().height(124.dp).clip(RoundedCornerShape(12.dp)), contentScale = ContentScale.Crop)
                            }
                        }

                        if (queued) Text(tr(R.string.queued_capture))
                    }
                    if (page == 1) {
                        SectionCard(tr(R.string.review_inspection), tr(R.string.review_subtitle), Color.White) {
                            Text(location.ifBlank { tr(R.string.location_needed) }, style = MaterialTheme.typography.titleMedium)
                            Text(date + " · " + if (photo.isBlank()) tr(R.string.photo_needed) else tr(R.string.photo_attached))
                            if (inspectionMissing.isEmpty()) {
                                Text(tr(R.string.all_fields), color = MaterialTheme.colorScheme.primary)
                            } else {
                                Text(tr(R.string.missing_fields, inspectionMissing.joinToString()))
                            }
                            if (captureMissing.isNotEmpty()) TextButton(onClick = { openPage(0) }) { Text(tr(R.string.complete_site)) }
                        }
                        Button(enabled = !queued && !busy && transcript.isNotBlank(), modifier = Modifier.fillMaxWidth(), onClick = { network {
                            check(model.isAvailable() && model.initialize()) { "Local processing is unavailable." }
                            val result = withContext(Dispatchers.Default) { model.process(EdgeInput(transcript)) }
                            category = result.category
                            observations = result.observation
                            val speech = execution.takeIf { it.startsWith("Android on-device") }?.substringBefore(" · Local rules")
                            execution = listOfNotNull(speech, "Local rules · %.2f ms · no network".format(result.elapsedMs)).joinToString(" · ")
                            save()
                            message = tr(R.string.review_draft)
                        } }) { Text(tr(R.string.process_local)) }
                        Box {
                            OutlinedButton(enabled = !queued, modifier = Modifier.fillMaxWidth(),
                                onClick = { categoryMenu = true }) { Text(tr(R.string.category_display, categoryLabel(category))) }
                            DropdownMenu(expanded = categoryMenu, onDismissRequest = { categoryMenu = false }) {
                                categories.forEach { option ->
                                    DropdownMenuItem(text = { Text(categoryLabel(option)) }, onClick = {
                                        category = option
                                        categoryMenu = false
                                    })
                                }
                            }
                        }
                        OutlinedTextField(observations, { observations = it }, label = { Text(tr(R.string.verified_observations)) }, enabled = !queued, modifier = Modifier.fillMaxWidth())
                        OutlinedButton(enabled = !queued && !busy && transcript.isNotBlank(), onClick = { network {
                            val source = transcript
                            val analysis = withContext(Dispatchers.IO) {
                                val detected = desertAnt.language(source)
                                val topics = desertAnt.topics(source)
                                val masked = if (detected == "en") desertAnt.redact(source) else null
                                Triple(detected, topics, masked)
                            }
                            analysis.third?.let { observations = it }
                            val language = analysis.first ?: "uncertain"
                            val topics = analysis.second.joinToString().ifBlank { "none above threshold" }
                            execution = "On device · Tongue: " + language + " · Gist: " + topics +
                                if (analysis.third != null) " · Redact: applied to draft" else " · Redact: skipped for this language"
                            save()
                            message = tr(R.string.review_model)
                        } }) { Text(tr(R.string.desert_analysis)) }
                        if (transcript.isNotBlank()) SectionCard(tr(R.string.translation), tr(R.string.translate_help), Color.White) {
                            Box {
                                OutlinedButton(enabled = !translationBusy, onClick = { translationMenu = true }) {
                                    Text(tr(R.string.translation_target) + " · " + translationTarget.label)
                                }
                                DropdownMenu(expanded = translationMenu, onDismissRequest = { translationMenu = false }) {
                                    RegionalLanguage.entries.forEach { option ->
                                        DropdownMenuItem(text = { Text(option.label) }, onClick = {
                                            translationTarget = option
                                            translationMenu = false
                                        })
                                    }
                                }
                            }
                            Button(enabled = !translationBusy, onClick = {
                                val source = transcript
                                val target = translationTarget
                                translationBusy = true
                                scope.launch {
                                    try {
                                        val result = RegionalTranslation().translate(source, target)
                                        if (source == transcript && target == translationTarget) translation = result
                                    } catch (cancelled: CancellationException) {
                                        throw cancelled
                                    } catch (_: Exception) {
                                        message = tr(R.string.translation_failed)
                                    } finally {
                                        translationBusy = false
                                    }
                                }
                            }) { Text(tr(if (translationBusy) R.string.translate_loading else R.string.translate)) }
                            if (translation.isNotBlank()) {
                                Text(translation, style = MaterialTheme.typography.bodyLarge)
                                Text(tr(R.string.translated_review), style = MaterialTheme.typography.bodySmall)
                                Text("Translation by Google Translate", style = MaterialTheme.typography.labelSmall)
                                OutlinedButton(enabled = !queued && !busy, onClick = {
                                    observations = translation
                                    save()
                                }) { Text(tr(R.string.use_translation)) }
                            }
                        }
                        if (execution.isNotEmpty()) Text(execution)

                    }
                    if (page == 2) {
                        Text(tr(R.string.submissions), style = MaterialTheme.typography.titleLarge)
                        Text(if (queued) tr(R.string.queue_count) else tr(R.string.queue_empty))
                    }
                    if (page == 2 && queued) {
                        Button(enabled = !busy && !recording && !listening, modifier = Modifier.fillMaxWidth(), onClick = {
                            network {
                                val outgoing = payload().put("confirmed", true).put("device", android.os.Build.MODEL)
                                request(server, token, "inspections", outgoing)
                                id = UUID.randomUUID().toString()
                                version = 0
                                location = ""
                                transcript = ""
                                observations = ""
                                photo = ""
                                category = "Other"
                                execution = ""
                                queued = false
                                vault.clearAudio()
                                audioSaved = false
                                save()
                                message = tr(R.string.synced)
                            }
                        }) { Text(if (busy) tr(R.string.syncing) else tr(R.string.sync_queued)) }
                        if (queued) OutlinedButton(onClick = { queued = false; save(); page = 0; message = tr(R.string.draft_unlocked) }) { Text(tr(R.string.edit_draft)) }
                    }
                    if (page == 2) {
                        OutlinedButton(enabled = !busy, onClick = { network {
                            statuses = JSONArray(requestText(server, token, "inspections", null))
                            message = tr(R.string.refreshed)
                        } }) { Text(tr(R.string.refresh_decisions)) }
                        for (index in 0 until statuses.length()) {
                            val report = statuses.getJSONObject(index)
                            val content = report.getJSONObject("content")
                            val status = when (report.getString("status")) {
                                "submitted" -> tr(R.string.status_submitted)
                                "approved" -> tr(R.string.status_approved)
                                "rejected" -> tr(R.string.status_rejected)
                                "changes_requested" -> tr(R.string.status_changes)
                                else -> report.getString("status")
                            }
                            SectionCard(content.getString("location"), content.optString("date"), Color.White) {
                                Text(status, color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelLarge)
                            }
                            if (report.getString("status") == "changes_requested" && !queued) {
                                OutlinedButton(enabled = !busy && location.isBlank() && transcript.isBlank() && observations.isBlank() && photo.isBlank(), onClick = { network {
                                    val reportId = report.getString("id")
                                    val evidence = requestBytes(server, token, "inspections/" + reportId + "/evidence", null)
                                    id = reportId
                                    version = report.getInt("version")
                                    date = content.getString("date")
                                    location = content.getString("location")
                                    transcript = content.getString("transcript")
                                    observations = content.getString("observations")
                                    category = content.getString("category")
                                    photo = Base64.encodeToString(evidence, Base64.NO_WRAP)
                                    save()
                                    page = 1
                                    message = tr(R.string.revision_loaded)
                                } }) { Text(tr(R.string.load_revision)) }
                            }
                        }
                    }
                    if (page == 3) {
                        Text(tr(R.string.model_title), style = MaterialTheme.typography.titleLarge)
                        Text(tr(R.string.model_description))
                        for (name in listOf("Tongue", "Redact", "Gist", "Clear")) {
                            ElevatedCard(modifier = Modifier.fillMaxWidth()) {
                                Column(Modifier.padding(14.dp)) {
                                    Text(name, style = MaterialTheme.typography.titleMedium)
                                    Text(modelStatuses[name] ?: if (desertAnt.checked(name)) tr(R.string.test_passed) else tr(R.string.ready_to_check))
                                }
                            }
                        }
                        Button(enabled = !prepareBusy, modifier = Modifier.fillMaxWidth(), onClick = { prepareModels() }) {
                            Text(if (prepareBusy) tr(R.string.preparing_models) else tr(R.string.download_models))
                        }
                        OutlinedButton(enabled = !busy, onClick = { network {
                            request(server, token, "logout", JSONObject())
                            token = ""
                            save()
                            message = tr(R.string.signed_out)
                        } }) { Text(tr(R.string.sign_out)) }
                    }
                }
                }
                if (token.isNotEmpty() && !keyboardOpen && (page == 0 || page == 1)) {
                    Surface(color = Color.White, shadowElevation = 4.dp) {
                        Column(Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 8.dp),
                            verticalArrangement = Arrangement.spacedBy(3.dp)) {
                            val draftLabel = when {
                                queued -> tr(R.string.queued_for_sync)
                                draftSaveFailed -> tr(R.string.draft_error)
                                draftChanged -> tr(R.string.saving_draft)
                                location.isBlank() && transcript.isBlank() && observations.isBlank() && photo.isBlank() -> tr(R.string.new_inspection)
                                else -> tr(R.string.draft_saved)
                            }
                            Text(draftLabel, style = MaterialTheme.typography.labelMedium,
                                color = if (draftSaveFailed) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary)
                            val actionLabel = when {
                                queued -> tr(R.string.open_sync)
                                page == 0 -> tr(R.string.review_inspection)
                                else -> tr(R.string.confirm_queue)
                            }
                            Button(
                                enabled = !busy && !recording && !listening && (queued || page == 0 || inspectionMissing.isEmpty()),
                                modifier = Modifier.fillMaxWidth(),
                                onClick = {
                                    when {
                                        queued -> openPage(2)
                                        page == 0 -> openPage(1)
                                        else -> {
                                            queued = true
                                            if (runCatching { save() }.isSuccess) {
                                                page = 2
                                                message = tr(R.string.confirmed)
                                            } else {
                                                queued = false
                                                draftSaveFailed = true
                                                message = tr(R.string.queue_save_failed)
                                            }
                                        }
                                    }
                                }
                            ) { Text(actionLabel) }
                            if (page == 1 && !queued && inspectionMissing.isNotEmpty()) {
                                Text(tr(R.string.missing_footer, inspectionMissing.joinToString()),
                                    style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                }
                if (token.isNotEmpty() && !keyboardOpen) NavigationBar(containerColor = Color.White, tonalElevation = 0.dp) {
                    listOf(tr(R.string.capture), tr(R.string.review), tr(R.string.sync), tr(R.string.models)).forEachIndexed { index, label ->
                        NavigationBarItem(
                            selected = page == index,
                            onClick = { openPage(index) },
                            enabled = !recording && !listening,
                            icon = { Text(listOf("✦", "✓", "↻", "◇")[index], style = MaterialTheme.typography.titleMedium) },
                            label = { Text(label) },
                            colors = NavigationBarItemDefaults.colors(indicatorColor = Color(0xffd8f2ee))
                        )
                    }
                }
            }
        }
    }

    override fun onDestroy() {
        regionalCapture?.stop()
        recorder?.release()
        recognizer?.destroy()
        player?.release()
        File(cacheDir, "capture.m4a").delete()
        super.onDestroy()
    }
}

@Composable
private fun WorkspacePill(label: String, color: Color, modifier: Modifier = Modifier) {
    Surface(modifier = modifier, color = color, shape = RoundedCornerShape(8.dp)) {
        Text(label, Modifier.padding(horizontal = 10.dp, vertical = 7.dp), color = Color.White,
            style = MaterialTheme.typography.labelLarge)
    }
}

@Composable
private fun SectionCard(title: String, subtitle: String, color: Color, content: @Composable ColumnScope.() -> Unit) {
    Card(modifier = Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = color),
        shape = RoundedCornerShape(18.dp)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
            Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = Color(0xff425975))
            content()
        }
    }
}

private suspend fun request(server: String, token: String, path: String, payload: JSONObject) =
    JSONObject(requestText(server, token, path, payload))

private suspend fun requestText(server: String, token: String, path: String, payload: JSONObject?) =
    requestBytes(server, token, path, payload).toString(Charsets.UTF_8)

private suspend fun requestBytes(server: String, token: String, path: String, payload: JSONObject?): ByteArray =
    withContext(Dispatchers.IO) {
        val url = URL(server.trimEnd('/') + "/api/" + path)
        require(url.protocol == "https" || (url.protocol == "http" && url.host in listOf("10.0.2.2", "127.0.0.1", "localhost"))) {
            "Use HTTPS for a remote workspace."
        }
        val connection = url.openConnection() as HttpURLConnection
        connection.connectTimeout = 8000
        connection.readTimeout = 12000
        connection.instanceFollowRedirects = false
        if (token.isNotEmpty()) connection.setRequestProperty("Authorization", "Bearer " + token)
        try {
            if (payload != null) {
                connection.requestMethod = "POST"
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { it.write(payload.toString().toByteArray()) }
            }
            val code = connection.responseCode
            if (code !in 200..299) {
                if (code == 401 && token.isNotEmpty()) throw WorkspaceAuthenticationException()
                val error = connection.errorStream?.bufferedReader()?.use { it.readText() }
                throw IllegalStateException(runCatching { JSONObject(error ?: "").getString("error") }.getOrDefault("HTTP " + code))
            }
            connection.inputStream.use { it.readBytes() }
        } finally { connection.disconnect() }
    }

private class WorkspaceAuthenticationException : IllegalStateException("Session expired. Sign in again to continue with your draft.")

private class DraftVault(private val directory: File) {
    private val key by lazy {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val alias = "fieldos-draft"
        (store.getKey(alias, null) as? SecretKey) ?: KeyGenerator.getInstance("AES", "AndroidKeyStore").run {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
            generateKey()
        }
    }
    fun read(): JSONObject {
        val file = File(directory, "draft.enc")
        if (!file.exists()) return JSONObject()
        return JSONObject(decrypt(file).toString(Charsets.UTF_8))
    }
    fun hasAudio() = File(directory, "audio.enc").exists()
    fun readAudio() = decrypt(File(directory, "audio.enc"))
    private fun decrypt(file: File): ByteArray {
        val bytes = file.readBytes()
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
        return cipher.doFinal(bytes.copyOfRange(12, bytes.size))
    }
    fun write(document: JSONObject) = encrypt("draft.enc", document.toString().toByteArray())
    fun writeAudio(bytes: ByteArray) = encrypt("audio.enc", bytes)
    fun clearAudio() { File(directory, "audio.enc").delete() }
    private fun encrypt(name: String, bytes: ByteArray) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key)
        val file = android.util.AtomicFile(File(directory, name))
        val stream = file.startWrite()
        try {
            stream.write(cipher.iv)
            stream.write(cipher.doFinal(bytes))
            file.finishWrite(stream)
        } catch (error: Exception) {
            file.failWrite(stream)
            throw error
        }
    }
}