package org.deltaforce.fieldos

data class EdgeInput(val observation: String)
data class EdgeResult(val category: String, val observation: String, val elapsedMs: Double)

interface EdgeModel {
    suspend fun initialize(): Boolean
    suspend fun process(input: EdgeInput): EdgeResult
    fun isAvailable(): Boolean
}

class RuleBasedAdapter : EdgeModel {
    private val signals = listOf(
        "Waste accumulation" to Regex("చెత్త|garbage|waste|rubbish", RegexOption.IGNORE_CASE),
        "Blocked drainage" to Regex("డ్రైనేజీ|డ్రెయిన్|drain|sewer", RegexOption.IGNORE_CASE),
        "Facility maintenance" to Regex("facility|equipment|toilet|మరుగుదొడ్డి", RegexOption.IGNORE_CASE)
    )
    private val identifiers = listOf(
        Regex("\\b[6-9]\\d{9}\\b") to "[phone]",
        Regex("\\b[2-9]\\d{3}[ -]?\\d{4}[ -]?\\d{4}\\b") to "[possible identifier]",
        Regex("[\\w.+-]+@[\\w.-]+\\.[a-z]{2,}", RegexOption.IGNORE_CASE) to "[email]"
    )

    override suspend fun initialize() = true
    override fun isAvailable() = true
    override suspend fun process(input: EdgeInput): EdgeResult {
        val start = System.nanoTime()
        val category = signals.firstOrNull { (_, pattern) -> pattern.containsMatchIn(input.observation) }?.first ?: "Other"
        val redacted = identifiers.fold(input.observation) { text, (pattern, replacement) -> pattern.replace(text, replacement) }
        return EdgeResult(category, redacted, (System.nanoTime() - start) / 1_000_000.0)
    }
}