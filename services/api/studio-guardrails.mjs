const identifierPatterns=[
 ['email',/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi],
 ['12-digit identifier',/\b\d{4}[ -]?\d{4}[ -]?\d{4}\b/g],
 ['phone',/(?<!\d)(?:\+91[ -]?)?[6-9]\d{9}(?!\d)/g]
];
export function inspectEvidence(text){
 const flags=[];
 let modelInput=text;
 for(const [label,pattern] of identifierPatterns){
  modelInput=modelInput.replace(pattern,()=>{if(!flags.includes(label))flags.push(label);return '[redacted]';});
 }
 const suspicious=/ignore (?:all |previous |prior )*(?:instructions|rules)|override (?:the )?(?:supervisor|approval)|bypass approval/i.test(text);
 if(suspicious)flags.push('Instruction-like evidence');
 return {modelInput,flags,suspicious};
}
