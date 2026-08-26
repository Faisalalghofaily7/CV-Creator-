// Shared Arabic prose standard for every AI route that writes Arabic CV
// text (generate-summary, enhance-items, describe-skill, suggest-points).
// The bar: a Saudi HR manager reading the output should never sense it was
// translated from English — contemporary Modern Standard Arabic as a native
// CV writer would produce it, not the stiff, formulaic constructions a
// literal English-to-Arabic pass tends toward. Append this block to a
// route's system prompt only when lang === "ar"; it has nothing to say
// about English output.
export function arabicWritingStandard() {
  return `Arabic writing standard — write as a native Arabic professional CV writer would, never as text translated from English. A Saudi HR manager reading it must not sense it was translated. Follow these exactly:
- Never write «تقريباً X سنوات» — write «تقارب X سنوات» or «تمتد X سنوات».
- Never write «قمت بـ...» or «تم إعداد...» — use the direct verb (e.g. «أعددتُ»، «طورتُ»، «راجعتُ»).
- Never write «العمل على تطوير» — just «تطوير».
- Delete repeated «من خلال» — rely on the preposition «ب» instead, or delete it.
- Never write «لدي القدرة على» — state the action directly.
- Delete hollow adverbs: «بشكل فعّال»، «بشكل كبير»، «بشكل مستمر».
- Never write «المساهمة في» — use «أسهمتُ في».
- Delete filler words: «وذلك»، «حيث أن»، «كما أنه».
- Never use hollow, evidence-free adjectives: «متميز»، «طموح»، «شغوف»، «سعي دائم للتطوير» — delete them or replace with a concrete fact already present in the data.
- Avoid clichés like «بيئة عمل ديناميكية».
- Years and dates in Latin numerals (2024), never Arabic-Indic (٢٠٢٤).
- Keep technical terms/tool names in English as-is (SAP, IFRS, ERP, ...) — never translate or Arabize them.`;
}
