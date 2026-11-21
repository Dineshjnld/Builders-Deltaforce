# Evaluation

Ran on Windows x64 with Node v24.22.3.

| Check | Observed result |
| --- | --- |
| Curated text categories | 20 of 20 matched English, Telugu and code-mixed fixtures |
| Missing fields | All 20 fixtures flagged absent date, location and photograph |
| API workflow | Submission, duplicate retry, correction request, resubmission and approval passed |
| Access | Anonymous reads, cross-tenant record and evidence access, invalid evidence, unconfirmed writes, disallowed roles, stale decisions and revoked sessions were denied in tests |
| Rules runtime | 2,000 runs, 0.0014 ms median, 0.0036 ms p95 |
| Memory | About 49.8 MB RSS for the full Node benchmark process at sampling |

The keyword fixtures exercise the rules and are not a field accuracy estimate. The microbenchmark excludes authentication, network, database, camera and voice transcription. The dataset does not establish a productivity gain. Recorded audio ASR accuracy, power use, device-model benchmarks and paired manual completion time remain unmeasured.
## Android emulator smoke test

On API 36, the debug APK signed into the local backend, recorded an audio memo, attached a camera JPEG, processed typed observations and retained a queued report through an app restart with Wi-Fi and mobile data disabled. After reconnecting, the app synced the report. A supervisor approved it through the API, and a subsequent Android refresh displayed the approved decision. The emulator recording exercised audio capture and storage. Voice recognition accuracy requires a speech-enabled device and a labeled audio set.

The API suite also verified that an uploaded SOP proposal is inactive before publication, another tenant cannot publish it, and a published transcript requirement is enforced on new submissions.
## Moto G45 voice check

The installed on-device recognizer reported en-IN installed, and Telugu was absent from its offline download list. The debug audio-input test fed a synthetic 16 kHz English sentence to the phone’s on-device recognizer. It returned the expected keywords in 2,124 ms from recognizer start to completion. This single fixture measures the injected-audio path. Live microphone transcript accuracy and Telugu service latency still need spoken tests.
## Regional Android check

The Moto G45 ran a combined audio fixture containing an English synthetic clip and Telugu and Hindi FLEURS clips separated by short pauses. The model detected all three spoken languages and returned all three writing scripts in 9.52 seconds from recognizer initialization through result. The standalone Telugu fixture returned Telugu script in 2.90 seconds. Mixed-note translation to English and English translation to Telugu and Hindi passed in 1.71 seconds total with cached language models. The Hindi voice pack downloaded and passed integrity checks in 14.99 seconds on this connection.

These are functional smoke tests. They do not establish word error rate, translation accuracy, or within-sentence code-switch accuracy in field conditions. See the debug FLEURS notice for the fixture source and CC BY 4.0 attribution.