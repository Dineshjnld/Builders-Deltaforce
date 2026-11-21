# Public sources and deployment review

## District context

The local directory contains 28 districts in Andhra Pradesh and 33 in Telangana, with 1,309 subdistrict entries across the two states in the 22 November 2026 IST retrieval. Each record identifies the government source, retrieval date and district-specific listings. Identifiers belong to iGOD. A department requiring LGD codes should import the Ministry of Panchayati Raj resource and reconcile its identifiers explicitly. The NIC directory includes the newer Markapuram and Polavaram districts. [Andhra Pradesh directory](https://igod.gov.in/sg/AP/E042/organizations) · [Telangana directory](https://igod.gov.in/sg/TS/E042/organizations) · [OGD LGD catalog](https://data.gov.in/catalog/local-government-directory-lgd)

Run `node --use-system-ca scripts/refresh-districts.mjs` from the repository root to refresh the directory. It reads the two state listings, follows each district's subdistrict listing, checks pagination and record counts, and replaces the previous snapshot only after both states finish. Rebuild the API image or restart the Node process to load the new snapshot. Search stays local. Keep the snapshot timestamp with research and review decisions that depend on it.

The snapshot contains administrative facts and references only. iGOD requests prior permission for reproduction of website material. Retain attribution and check rights before redistributing bulk extracts, page text, maps or branding. The OGD platform publishes its dataset resources under the Government Open Data License–India and supplies a separately licensed LGD distribution. [iGOD website policies](https://igod.gov.in/website_policies) · [OGD platform](https://data.gov.in/)

## IndiaAI assets

Run `node --use-system-ca scripts/refresh-aikosh.mjs` to retrieve the public titles and license metadata of three IndiaAI AIKosh resources. All cards link to their original catalog entries. Refresh reads the three allowlisted pages and atomically replaces the local snapshot. An unavailable source or a missing license leaves the previous snapshot intact.

The resource catalog supports discovery. IndicVoices-R is an AI4Bharat TTS research dataset under CC BY-ND 4.0. The catalog labels IndicSynth as noncommercial and the Multilingual Table Detection dataset as CC0. Review upstream assets and restrictions for the intended distribution, training or evaluation activity. Each asset has its own terms. [IndicVoices-R](https://aikosh.indiaai.gov.in/home/datasets/details/indicvoices_r.html) · [IndicSynth](https://aikosh.indiaai.gov.in/home/datasets/details/indicsynth.html) · [Multilingual Table Detection](https://aikosh.indiaai.gov.in/home/datasets/details/multilingual_table_detection.html)

## Department deployment review

| Area | Decision and evidence for the department owner |
| --- | --- |
| Personal data | Map the lawful purpose, processing roles, notice, retention, erasure, grievance contact, and breach handling for each connector. The November 2025 DPDP Rules have staggered commencement. Rules 1, 2 and 17–21 commenced on publication, rule 4 at one year, and rules 3, 5–16, 22 and 23 at eighteen months. Check the corresponding statutory commencement and corrigenda for the deployment date. [MeitY Rules and notifications](https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa) |
| Cyber incidents | The CERT-In directions applicable to government organisations and other covered entities provide for reporting specified incidents within six hours. They also address clock synchronisation, a point of contact and retention of ICT logs for a rolling 180 days in Indian jurisdiction. Validate monitoring coverage and incident escalation with the department CISO. Raw citizen messages and voice recordings need a separately justified retention policy. [CERT-In directions](https://www.cert-in.org.in/PDF/CERT-In_Directions_70B_28.04.2022.pdf) · [CERT-In FAQ](https://www.cert-in.org.in/PDF/FAQs_on_CyberSecurityDirections_May2022.pdf) |
| Public-facing accessibility and security | GIGW 3.0 covers government websites and apps, includes WCAG 2.1 AA, and describes accessibility, quality and security assessment. Record keyboard, screen-reader and language testing results. Obtain the applicable audit and hosting clearance through the designated organisation. [GIGW scope](https://guidelines.india.gov.in/scope-and-objective/) · [GIGW features](https://guidelines.india.gov.in/new-features-of-gigw-3-0/) |
| Delegation and integrations | The owning department must establish which officer can approve each action, verify its current procedure and authorise each citizen-facing channel. Exercise recovery from duplicated messages, disconnected sessions and failed dispatch. Use the dedicated test account for the unofficial WhatsApp connector. [Connector operational guide](evolution-demo.md) |

These are deployment review inputs for the specific purpose, state, sector and contracting authority. Security evaluation, statutory review and certification require separate evidence from the deploying organisation.
