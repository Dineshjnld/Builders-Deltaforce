// Bounded local rules. Photographs are attached as evidence and are never interpreted.
export const categories = ['Waste accumulation','Blocked drainage','Facility maintenance','Other'];
const signals = [/చెత్త|garbage|waste|rubbish/iu,/డ్రైనేజీ|డ్రెయిన్|drain|sewer/iu,/facility|equipment|toilet|మరుగుదొడ్డి/iu];
export function processObservation(input) {
  const start = performance.now();
  const observations = String(input.observations ?? '').trim();
  const matches = signals.flatMap((signal,index) => signal.test(observations) ? [categories[index]] : []);
  const category = matches[0] ?? 'Other';
  const redacted = observations.replace(/\b[6-9]\d{9}\b/g,'[phone]').replace(/\b[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}\b/g,'[possible identifier]').replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi,'[email]');
  return {
    category, matches, observations: redacted,
    missing: ['date','location','observations','photo'].filter(field => !input[field]),
    execution: { target:'private-server', runtime:'Municipal bilingual rules v1', milliseconds:performance.now()-start, input:'Observation text and field-presence flags' }
  };
}