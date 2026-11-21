# Deployment

## Local service

Run from the repository root with Node 24. The server creates the SQLite database and applies the schema at startup. Default bind is 127.0.0.1:8787 and default database is var/fieldos.sqlite. To reset a demo without losing records, set DB_PATH to a new filename and restart.

## Android

Open apps/android as an Android Studio project with JDK 21, Android SDK 36 and Gradle 8.13. Build with `gradle -p apps/android assembleDebug`. The debug output is apps/android/app/build/outputs/apk/debug/app-debug.apk. Install on an emulator with `adb install -r apps/android/app/build/outputs/apk/debug/app-debug.apk`.

Use http://10.0.2.2:8787 for the standard Android emulator and the demo officer account. Use HTTPS with a trusted certificate and a reachable host for a physical device. The release manifest blocks cleartext. Debug accepts HTTP for local development, with the client limiting HTTP workspace URLs to loopback and the Android emulator host alias.

## Container

```sh
docker compose up --build
```

Compose starts a loopback-only synthetic demo with a persistent volume. For a remote deployment, use a Node-capable host with durable storage, put a TLS reverse proxy in front of the app, and set DELTA_HTTPS=1 for secure web cookies. Leave DELTA_DEMO unset and enable DELTA_ALLOW_SIGNUP only when provisioning the first organizations. Restrict direct access to the backend port. The current build uses one SQLite writer process.

The local workspace is runnable through Node. Docker and remote TLS deployment require a host and independent verification.
## Regional Android workflow

Choose English, Telugu or Hindi from App language. In Capture, choose a dictation language or Mixed. Mix languages in short phrases and pause briefly at a language change. Prepare the downloadable Hindi voice pack once before dictating Hindi. Telugu and the multilingual recognizer ship in the 64-bit APK. Translation packs download when first used, then notes are translated locally. Open Review to preview a translation and use it as a separate observation draft. The original transcript stays attached to the inspection.