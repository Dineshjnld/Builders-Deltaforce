import rules from "./privacy_rules.json"

const patterns = rules.map(rule => ({pattern: new RegExp(rule[1]!, "gi"), label:rule[0]!}))

export function maskIdentifiers(text: string) {
    for (const {pattern, label} of patterns) text = text.replace(pattern, "[" + label + " removed]")
    return text
}
