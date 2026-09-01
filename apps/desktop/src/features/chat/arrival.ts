/**
 * What "somebody joined" says, picked rather than stored.
 *
 * The row a server writes for an arrival carries no body: `kind` says what
 * happened and `author` says who it happened to, and that is all. A sentence
 * written into the row by the service would be in whatever language that
 * service was written in, for every reader on the deployment, forever - so the
 * wording is the client's.
 *
 * Which leaves the question of *which* wording, and the answer has to be the
 * same on every device and across every reload, or a phone and a laptop looking
 * at the same conversation disagree about what happened in it. So it is derived
 * from the message id: no column, no randomness, same answer everywhere.
 *
 * The Android port is `arrivalLine` in
 * `apps/android/app/src/main/java/com/aatech/betweenus/feature/chat/ArrivalRow.kt`
 * and the two must stay in step - both the hash and the list, in this order.
 */
export const ARRIVAL_LINES = [
  'is here.',
  'just landed.',
  'just slid into the server.',
  'joined the party.',
  'hopped into the server.',
  'has arrived.',
] as const;

export function arrivalLine(messageId: string): string {
  // The ordinary 31-multiplier string hash, kept to 32 unsigned bits so Kotlin's
  // Int - which overflows the same way - lands on the same number.
  let hash = 0;
  for (const character of messageId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return ARRIVAL_LINES[hash % ARRIVAL_LINES.length] as string;
}
