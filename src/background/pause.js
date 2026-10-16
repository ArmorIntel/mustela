import { getPauseState, savePauseState } from '../storage/storage.js';

export function pauseFailure(error) {
  return { ok: false, error: error.message || String(error), ...(error.code ? { code: error.code } : {}) };
}

// One authority per worker. A token cannot survive a confirmed OFF, even if
// ON is confirmed again before an outstanding provider response arrives.
export function createTransmissionGate() {
  let state;
  let loading;
  let generation = 0;
  let transition = Promise.resolve();

  async function getState() {
    if (!state) {
      loading ||= getPauseState().then((value) => { state = value; }).finally(() => { loading = null; });
      await loading;
    }
    return { ...state };
  }

  function assertAllowed(token) {
    if (!state || state.paused || token !== generation) {
      const error = new Error('Mustela is paused or this action was interrupted by a pause. Start a new action after resuming.');
      error.code = 'MUSTELA_PAUSED';
      throw error;
    }
  }

  return {
    getState,
    setState(paused) {
      const result = transition.then(async () => {
        if (typeof paused !== 'boolean') throw new Error('paused must be a boolean');
        await getState();
        try {
          await savePauseState(paused);
        } catch (error) {
          throw new Error(`Unable to save pause state: ${error.message || error}. Please retry.`);
        }
        if (paused) generation++;
        state = { paused };
        return { ...state };
      });
      transition = result.catch(() => undefined);
      return result;
    },
    async begin() {
      await getState();
      assertAllowed(generation);
      return generation;
    },
    // No await between checking authority and starting the side effect.
    run(token, operation) {
      assertAllowed(token);
      return operation();
    }
  };
}
