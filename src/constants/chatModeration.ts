/**
 * The words the chat regulation layer removes on sight.
 *
 * A study group is not the place for explicit or 18+ content, and the admin
 * should not have to see it to remove it. These are seeds, not policy: the
 * admin panel lists them, and the admin can add or remove any of them without
 * a deploy. They are matched case-insensitively, ignoring punctuation,
 * leetspeak and stretched letters (see `services/moderation/matcher.ts`), so
 * one entry covers the usual spellings a student types.
 *
 * English entries are exact words, not stems: "sex" must not catch
 * "Sussex", and "chut" must not catch "chutney". Add the variants you see
 * instead of a prefix, so an innocent word never gets removed.
 *
 * The list is English plus the Hindi terms this campus actually uses, both in
 * transliteration and in Devanagari. Abuse and plain profanity are not the
 * target unless the word is explicitly sexual; the admin can add more from
 * the panel.
 */
export const DEFAULT_BLOCKED_KEYWORDS: readonly string[] = [
  // English: explicit / 18+
  "porn",
  "porno",
  "pornography",
  "xxx",
  "nsfw",
  "onlyfans",
  "pornhub",
  "xnxx",
  "xvideos",
  "hentai",
  "nude",
  "nudes",
  "nudity",
  "nipple",
  "nipples",
  "sex",
  "sexy",
  "sexting",
  "sextape",
  "blowjob",
  "handjob",
  "cumshot",
  "orgasm",
  "orgasms",
  "masturbate",
  "masturbation",
  "dildo",
  "vibrator",
  "penis",
  "vagina",
  "pussy",
  "boob",
  "boobs",
  "tits",
  "asshole",
  "anal",
  "fuck",
  "fucking",
  "fucked",
  "fucker",
  "fuk",
  "fuking",
  "motherfucker",
  "slut",
  "sluts",
  "whore",
  "whores",
  "hooker",
  "prostitute",
  "rape",
  "raping",
  "rapist",
  "horny",
  "erotic",
  "bdsm",
  "orgy",
  "threesome",
  "milf",

  // Hindi, transliterated
  "chut",
  "chutiya",
  "chutiye",
  "chootiya",
  "chudai",
  "nangi",
  "gand",
  "gandu",
  "lund",
  "lauda",
  "loda",
  "randi",
  "bhosdi",
  "bhosdike",
  "bhosda",
  "madarchod",
  "behenchod",
  "bhenchod",

  // Hindi, Devanagari
  "सेक्स",
  "पोर्न",
  "अश्लील",
  "चूत",
  "चूतिया",
  "गांड",
  "लंड",
  "रंडी",
  "भोसड़ी",
  "मादरचोद",
  "बहनचोद",
];
