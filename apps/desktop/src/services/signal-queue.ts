/**
 * Applying WebRTC signals one at a time.
 *
 * Every negotiator here takes signals off a socket that does not wait for them:
 * the handler is `void`ed or launched, so two descriptions arriving close
 * together run *concurrently* and interleave at every `await` inside. That
 * breaks perfect negotiation at the root, because the decisions it makes -
 * "is this a collision", "is there still an offer outstanding" - are read from
 * `signalingState` and then acted on several awaits later, by which time
 * another run has moved the connection on.
 *
 * The symptom is an offer and a re-offer from the connection chaser landing
 * together: both pass the collision check while the state is still
 * `have-remote-offer`, the first drives the connection to `stable` with its
 * answer, and the second reaches `setLocalDescription('answer')` a moment later
 * and throws `Called in wrong state: stable` across a call that is otherwise
 * fine.
 *
 * One queue per peer, never one per mesh: separate connections share no state,
 * and queueing them behind each other would make the slowest peer's key re-read
 * everybody else's problem.
 */

/**
 * A queue that runs each task to completion before starting the next.
 *
 * Rejections are swallowed rather than propagated into the chain: one failed
 * signal must not stop every signal after it, which is a call that goes quiet
 * for good. Callers that care about the outcome handle it inside the task, as
 * both negotiators do.
 */
export function serialize(): (task: () => Promise<void>) => Promise<void> {
  let tail: Promise<void> = Promise.resolve();
  return (task) => {
    tail = tail.then(task).catch(() => undefined);
    return tail;
  };
}
