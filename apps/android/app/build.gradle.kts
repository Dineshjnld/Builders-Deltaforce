plugins {
    id("com.android.application") version "8.13.1"
    id("org.jetbrains.kotlin.android") version "2.0.21"
    id("org.jetbrains.kotlin.plugin.compose") version "2.0.21"
}
android {
    namespace = "org.deltaforce.fieldos"
    compileSdk = 36
    defaultConfig { applicationId = "org.deltaforce.fieldos"; minSdk = 26; targetSdk = 35; versionCode = 5; versionName = "0.5"; ndk { abiFilters += listOf("arm64-v8a", "x86_64") } }
    buildFeatures { compose = true }
    packaging { jniLibs.useLegacyPackaging = true }
}
dependencies {
    implementation(files("libs/sherpa-onnx-2.0.2.aar"))
    implementation("com.google.mlkit:translate:17.0.3")
    implementation("ai.desertant:tongue:4.3.0")
    implementation("ai.desertant:redact:4.3.0")
    implementation("ai.desertant:gist:4.3.0")
    implementation("ai.desertant:clear:4.3.0")
    implementation("androidx.activity:activity-compose:1.8.2")
    implementation("androidx.compose.material3:material3:1.3.0")
}
kotlin {
    compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_1_8) }
}
